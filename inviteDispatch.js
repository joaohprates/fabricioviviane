import {
  mapInviteHeaders,
  normalizeToken,
  normalizeWhatsAppNumber,
} from "./googleSheets.js";

export const DEFAULT_WEDDING_DETAILS = Object.freeze({
  noivos: "Fabricio & Viviane",
  data: "6 de março de 2027",
  horario: "00h00",
  local: "Av. Cristóvão Colombo, 87 — Jardim Jaguaruna, Marialva/PR",
});

export const RELIGIOUS_BLESSING =
  "Que Deus abençoe este encontro e a nossa união. 🙏";

export const DEFAULT_INVITE_TEMPLATE = `Olá, {nome}! 💍🙏

Com a bênção de Deus, nós, {noivos}, queremos convidar vocês para celebrar conosco o nosso casamento.

📅 Data: {data}
🕛 Horário: {horario}
📍 Local: {local}

Convite personalizado para: {familia}
Código de confirmação: {codigo}

Confirme sua presença pelo link:
{link}

“Assim, eles já não são dois, mas sim uma só carne.” — Mateus 19:6

Com carinho,
{noivos}

{bencao}`;

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
  details = DEFAULT_WEDDING_DETAILS,
}) {
  const event = { ...DEFAULT_WEDDING_DETAILS, ...(details || {}) };
  const selectedTemplate = String(template || DEFAULT_INVITE_TEMPLATE);
  const hasBlessingPlaceholder = selectedTemplate.includes("{bencao}");
  const confirmationLink = buildInviteLink(siteUrl, token);
  const replacements = {
    "{familia}": familia,
    "{nome}": familia,
    "{codigo}": token,
    "{link}": confirmationLink,
    "{noivos}": event.noivos,
    "{data}": event.data,
    "{horario}": event.horario,
    "{local}": event.local,
    "{bencao}": RELIGIOUS_BLESSING,
  };

  let message = Object.entries(replacements).reduce(
    (message, [placeholder, value]) =>
      message.split(placeholder).join(String(value ?? "")),
    selectedTemplate
  ).trim();

  const requiredDetails = [];
  if (!message.includes(String(event.noivos))) {
    requiredDetails.push(`Noivos: ${event.noivos}`);
  }
  if (!message.includes(String(event.data))) {
    requiredDetails.push(`📅 Data: ${event.data}`);
  }
  if (!message.includes(String(event.horario))) {
    requiredDetails.push(`🕛 Horário: ${event.horario}`);
  }
  if (!message.includes(String(event.local))) {
    requiredDetails.push(`📍 Local: ${event.local}`);
  }
  if (!message.includes(String(familia))) {
    requiredDetails.push(`Convite personalizado para: ${familia}`);
  }
  if (!message.includes(String(token))) {
    requiredDetails.push(`Código de confirmação: ${token}`);
  }
  if (!message.includes(confirmationLink)) {
    requiredDetails.push(`Confirme sua presença: ${confirmationLink}`);
  }
  if (requiredDetails.length > 0) {
    message += `\n\n${requiredDetails.join("\n")}`;
  }

  return hasBlessingPlaceholder
    ? message
    : `${message}\n\n${RELIGIOUS_BLESSING}`;
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
