import {
  mapInviteHeaders,
  normalizeToken,
  normalizeWhatsAppNumber,
} from "./googleSheets.js";

export const DEFAULT_INVITE_TEMPLATE = `Olá, {familia}! 💍

Com muita alegria, queremos convidar vocês para celebrar o nosso casamento.

Confira o convite e confirme a presença neste link:
{link}

Código do convite: {codigo}

Com carinho,
Fabricio & Viviane`;

export function buildInviteLink(siteUrl, token) {
  const url = new URL(siteUrl);
  url.searchParams.set("convite", String(token));
  url.hash = "confirmar";
  return url.toString();
}

export function buildInviteMessage({
  familia,
  token,
  siteUrl,
  template = DEFAULT_INVITE_TEMPLATE,
}) {
  const replacements = {
    "{familia}": familia,
    "{codigo}": token,
    "{link}": buildInviteLink(siteUrl, token),
  };

  return Object.entries(replacements).reduce(
    (message, [placeholder, value]) =>
      message.split(placeholder).join(String(value ?? "")),
    template
  );
}

function hasValue(value) {
  return String(value ?? "").trim() !== "";
}

export function planInviteDispatch(values) {
  const headers = values[0] || [];
  const columns = mapInviteHeaders(headers);
  const rows = values
    .slice(1)
    .map((row, index) => ({ row: row || [], rowIndex: index + 2 }))
    .filter(({ row }) => row.some(hasValue));

  const tokenCounts = new Map();
  for (const { row } of rows) {
    const token = normalizeToken(row[columns.token]);
    if (token) tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
  }

  const ready = [];
  const issues = [];
  const sent = [];

  for (const { row, rowIndex } of rows) {
    const token = String(row[columns.token] ?? "").trim();
    const familia = String(row[columns.familia] ?? "").trim();
    const normalizedToken = normalizeToken(token);
    const status =
      columns.envioStatus === undefined
        ? ""
        : String(row[columns.envioStatus] ?? "").trim();

    if (normalizeToken(status) === "enviado") {
      sent.push({ rowIndex, token, familia });
      continue;
    }
    if (!normalizedToken) {
      issues.push({ rowIndex, reason: "missing_token" });
      continue;
    }
    if ((tokenCounts.get(normalizedToken) || 0) > 1) {
      issues.push({ rowIndex, reason: "duplicate_token" });
      continue;
    }

    const phone =
      columns.numero === undefined ? "" : row[columns.numero];
    const whatsappNumber = normalizeWhatsAppNumber(phone);
    if (!whatsappNumber) {
      issues.push({ rowIndex, reason: "invalid_phone" });
      continue;
    }

    ready.push({
      rowIndex,
      token,
      familia,
      whatsappNumber,
      padrinho:
        columns.padrinho === undefined
          ? false
          : hasValue(row[columns.padrinho]),
    });
  }

  return {
    ready,
    sent,
    issues,
    counts: {
      total: rows.length,
      ready: ready.length,
      sent: sent.length,
      issues: issues.length,
    },
  };
}

function formatTimestamp(date) {
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export class InviteDispatchManager {
  constructor({
    getPlan,
    ensureTracking,
    recordStatus,
    sendMessage,
    buildMessage,
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now = () => new Date(),
    intervalMs = 8000,
    maxPerRun = 20,
  }) {
    this.getPlan = getPlan;
    this.ensureTracking = ensureTracking;
    this.recordStatus = recordStatus;
    this.sendMessage = sendMessage;
    this.buildMessage = buildMessage;
    this.sleep = sleep;
    this.now = now;
    this.intervalMs = Math.max(5000, Number(intervalMs) || 8000);
    this.maxPerRun = Math.max(1, Number(maxPerRun) || 20);
    this.running = false;
    this.stopRequested = false;
    this.lastError = "";
    this.startedAt = null;
    this.finishedAt = null;
    this.progress = { selected: 0, processed: 0, sent: 0, failed: 0 };
  }

  getStatus() {
    return {
      running: this.running,
      stopRequested: this.stopRequested,
      lastError: this.lastError,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      progress: { ...this.progress },
    };
  }

  stop() {
    this.stopRequested = true;
    return this.getStatus();
  }

  async start({ limit } = {}) {
    if (this.running) {
      throw new Error("Já existe um envio em andamento");
    }

    this.running = true;
    this.stopRequested = false;
    this.lastError = "";
    this.startedAt = this.now().toISOString();
    this.finishedAt = null;
    this.progress = { selected: 0, processed: 0, sent: 0, failed: 0 };

    try {
      await this.ensureTracking();
      const plan = await this.getPlan();
      const requested = Math.max(1, Number(limit) || this.maxPerRun);
      const selected = plan.ready.slice(0, Math.min(requested, this.maxPerRun));
      this.progress.selected = selected.length;

      for (let index = 0; index < selected.length; index++) {
        if (this.stopRequested) break;
        const invite = selected[index];
        const timestamp = formatTimestamp(this.now());

        try {
          const result = await this.sendMessage(
            invite.whatsappNumber,
            this.buildMessage(invite)
          );
          await this.recordStatus(invite.rowIndex, {
            status: "Enviado",
            timestamp,
            messageId: result?.messageId || "",
            error: "",
          });
          this.progress.sent += 1;
        } catch (error) {
          const message = String(error?.message || error || "Erro desconhecido").slice(0, 500);
          await this.recordStatus(invite.rowIndex, {
            status: "Erro",
            timestamp,
            messageId: "",
            error: message,
          });
          this.progress.failed += 1;
        }

        this.progress.processed += 1;
        if (index < selected.length - 1 && !this.stopRequested) {
          await this.sleep(this.intervalMs);
        }
      }
    } catch (error) {
      this.lastError = String(error?.message || error || "Erro desconhecido");
      throw error;
    } finally {
      this.running = false;
      this.finishedAt = this.now().toISOString();
    }

    return this.getStatus();
  }
}
