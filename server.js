import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildPublicInvitePayload,
  prepareSheets,
  saveRsvpToSheet,
  validateToken,
} from "./googleSheets.js";
import {
  InviteDispatchManager,
  buildInviteMessage,
} from "./inviteDispatch.js";
import {
  ensureInviteDispatchTracking,
  getInviteDispatchPlan,
  recordInviteDispatchStatus,
} from "./inviteSheetStore.js";
import {
  isAdminTokenValid,
  requirePublicWeddingUrl,
  resolveWeddingSiteUrl,
} from "./adminSecurity.js";
import { whatsappService } from "./whatsappService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const publicDir = path.join(__dirname, "public");
const SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const SEND_INTERVAL_MS = Math.max(
  5000,
  Number(process.env.WHATSAPP_SEND_INTERVAL_MS) || 8000
);
const MAX_INVITES_PER_RUN = Math.max(
  1,
  Math.min(50, Number(process.env.WHATSAPP_MAX_PER_RUN) || 20)
);

function inviteTemplate() {
  return process.env.WHATSAPP_INVITE_TEMPLATE?.replace(/\\n/g, "\n");
}

function weddingSiteUrl() {
  return requirePublicWeddingUrl(resolveWeddingSiteUrl());
}

const inviteDispatchManager = new InviteDispatchManager({
  getPlan: getInviteDispatchPlan,
  ensureTracking: ensureInviteDispatchTracking,
  recordStatus: recordInviteDispatchStatus,
  sendMessage: (number, message) => whatsappService.sendText(number, message),
  buildMessage: (invite) =>
    buildInviteMessage({
      familia: invite.familia,
      token: invite.token,
      siteUrl: weddingSiteUrl(),
      template: inviteTemplate(),
    }),
  intervalMs: SEND_INTERVAL_MS,
  maxPerRun: MAX_INVITES_PER_RUN,
});

function sheetsErrorPayload(err) {
  const status = err?.status || err?.code || err?.cause?.code;
  const denied =
    status === 403 ||
    err?.cause?.status === "PERMISSION_DENIED" ||
    /permission/i.test(err?.message || "");

  if (denied) {
    return {
      status: 403,
      error:
        `A planilha ainda não está compartilhada com o site. Abra o Google Sheets, clique em Compartilhar e adicione ${SERVICE_ACCOUNT} como Editor.`,
    };
  }

  return { status: 500, error: "Erro ao validar convite" };
}

app.use(express.json());
app.use(express.static(publicDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});
app.get("/admin/whatsapp", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin-whatsapp.html"));
});

function adminOnly(req, res, next) {
  res.set("Cache-Control", "no-store");
  const expected = process.env.WHATSAPP_ADMIN_TOKEN;
  if (!expected) {
    return res.status(503).json({
      error: "Configure WHATSAPP_ADMIN_TOKEN no ambiente do servidor.",
    });
  }
  if (!isAdminTokenValid(req.get("x-admin-token"), expected)) {
    return res.status(401).json({ error: "Token administrativo inválido" });
  }
  next();
}

function adminError(res, error, fallback) {
  console.error(fallback, error?.message || error);
  return res.status(500).json({ error: error?.message || fallback });
}

app.get("/api/admin/whatsapp/status", adminOnly, (_req, res) => {
  res.json({
    whatsapp: whatsappService.getStatus(),
    dispatch: inviteDispatchManager.getStatus(),
    settings: {
      maxPerRun: MAX_INVITES_PER_RUN,
      intervalSeconds: Math.round(SEND_INTERVAL_MS / 1000),
      siteUrlConfigured: Boolean(resolveWeddingSiteUrl()),
    },
  });
});

app.post("/api/admin/whatsapp/connect", adminOnly, async (_req, res) => {
  try {
    const status = await whatsappService.connect();
    res.status(202).json({ whatsapp: status });
  } catch (error) {
    adminError(res, error, "Erro ao iniciar a conexão com o WhatsApp");
  }
});

app.post("/api/admin/whatsapp/disconnect", adminOnly, (_req, res) => {
  inviteDispatchManager.stop();
  res.json({ whatsapp: whatsappService.disconnect() });
});

app.get("/api/admin/whatsapp/preview", adminOnly, async (_req, res) => {
  try {
    const plan = await getInviteDispatchPlan();
    const issueCounts = plan.issues.reduce((counts, issue) => {
      counts[issue.reason] = (counts[issue.reason] || 0) + 1;
      return counts;
    }, {});
    const first = plan.ready[0];
    const messagePreview = first
      ? buildInviteMessage({
          familia: first.familia,
          token: first.token,
          siteUrl: weddingSiteUrl(),
          template: inviteTemplate(),
        })
      : "";

    res.json({
      counts: plan.counts,
      issueCounts,
      messagePreview,
      maxPerRun: MAX_INVITES_PER_RUN,
    });
  } catch (error) {
    adminError(res, error, "Erro ao preparar a prévia dos convites");
  }
});

app.post("/api/admin/whatsapp/send", adminOnly, (req, res) => {
  if (req.body?.confirmation !== "ENVIAR_CONVITES") {
    return res.status(400).json({ error: "Confirmação explícita obrigatória" });
  }
  if (whatsappService.getStatus().state !== "connected") {
    return res.status(409).json({ error: "Conecte o WhatsApp antes de enviar" });
  }
  if (inviteDispatchManager.getStatus().running) {
    return res.status(409).json({ error: "Já existe um envio em andamento" });
  }

  try {
    weddingSiteUrl();
    const limit = Math.max(
      1,
      Math.min(MAX_INVITES_PER_RUN, Number(req.body?.limit) || MAX_INVITES_PER_RUN)
    );
    void inviteDispatchManager.start({ limit }).catch((error) => {
      console.error("Falha na fila de convites:", error?.message || error);
    });
    res.status(202).json({ dispatch: inviteDispatchManager.getStatus() });
  } catch (error) {
    adminError(res, error, "Erro ao iniciar o envio dos convites");
  }
});

app.post("/api/admin/whatsapp/stop", adminOnly, (_req, res) => {
  res.json({ dispatch: inviteDispatchManager.stop() });
});

app.get("/api/validate-token", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: "O código do convite é obrigatório" });
  }

  try {
    const result = await validateToken(token);

    if (!result.valid) {
      if (result.reason === "already_used") {
        return res.status(409).json({ error: "Este convite já foi confirmado" });
      }
      if (result.reason === "duplicate_token") {
        return res.status(409).json({
          error: "Este código aparece mais de uma vez na lista. Fale com os noivos.",
        });
      }
      return res.status(404).json({ error: "Convite não encontrado" });
    }

    res.json(buildPublicInvitePayload(result));
  } catch (err) {
    console.error("Validate token error:", err.message || err);
    const payload = sheetsErrorPayload(err);
    res.status(payload.status).json({ error: payload.error });
  }
});

app.post("/api/rsvp", async (req, res) => {
  const { token, name, phone, criancas } = req.body;

  if (!token || !name || !phone) {
    return res.status(400).json({ error: "Código, nome e celular são obrigatórios" });
  }

  const phoneDigits = String(phone).replace(/\D/g, "");
  if (phoneDigits.length < 10 || phoneDigits.length > 11) {
    return res.status(400).json({ error: "Celular inválido" });
  }

  try {
    const tokenResult = await validateToken(token);

    if (!tokenResult.valid) {
      if (tokenResult.reason === "already_used") {
        return res.status(409).json({ error: "Este convite já foi confirmado" });
      }
      if (tokenResult.reason === "duplicate_token") {
        return res.status(409).json({
          error: "Este código aparece mais de uma vez na lista. Fale com os noivos.",
        });
      }
      return res.status(404).json({ error: "Convite não encontrado" });
    }

    const saved = await saveRsvpToSheet({
      token,
      name,
      phone: phoneDigits,
      criancas: Math.max(0, parseInt(criancas, 10) || 0),
      inviteRowIndex: tokenResult.sheetRowIndex,
      confirmedColumnIndex: tokenResult.confirmedColumnIndex,
    });

    res.json({
      success: true,
      familia: tokenResult.familia,
      saved,
    });
  } catch (err) {
    console.error("RSVP error:", err.message || err);
    const payload = sheetsErrorPayload(err);
    res.status(payload.status).json({
      error:
        payload.status === 403
          ? payload.error
          : "Erro ao salvar confirmação",
    });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Site no ar: http://localhost:${PORT}`);
  console.log("Arquivos estáticos:", publicDir);
});

prepareSheets()
  .then(() => console.log("Planilha pronta (abas Convites e confirmações)."))
  .catch((err) => {
    console.error(
      "Não foi possível preparar a planilha:",
      err.message,
      "\nCompartilhe a planilha com",
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      "como Editor."
    );
  });
