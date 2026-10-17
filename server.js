import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { prepareSheets, saveRsvpToSheet, validateToken } from "./googleSheets.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const publicDir = path.join(__dirname, "public");
const SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

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
      return res.status(404).json({ error: "Convite não encontrado" });
    }

    res.json({ familia: result.familia, adultos: result.adultos });
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
      return res.status(404).json({ error: "Convite não encontrado" });
    }

    const saved = await saveRsvpToSheet({
      token,
      name,
      phone: phoneDigits,
      adultos: tokenResult.adultos,
      criancas: Math.max(0, parseInt(criancas, 10) || 0),
    });

    res.json({
      success: true,
      familia: tokenResult.familia,
      adultos: tokenResult.adultos,
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
