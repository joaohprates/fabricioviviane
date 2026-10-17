import { google } from "googleapis";

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function getConfirmacoesTab(sheets) {
  if (process.env.GOOGLE_SHEET_TAB_NAME) {
    return process.env.GOOGLE_SHEET_TAB_NAME;
  }
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    fields: "sheets.properties.title",
  });
  const title = spreadsheet.data.sheets?.[0]?.properties?.title;
  if (!title) throw new Error("Nenhuma aba encontrada na planilha");
  return title;
}

function getConvitesTab() {
  return process.env.GOOGLE_CONVITES_TAB_NAME || "Convites";
}

function normalizeToken(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function ensureTab(sheets, tab) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    fields: "sheets.properties.title",
  });
  const exists = spreadsheet.data.sheets?.some(
    (s) => s.properties?.title === tab
  );
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tab } } }],
    },
  });
}

async function ensureHeaders(sheets, tab, headers) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${tab}!A1:F1`,
  });
  const first = result.data.values?.[0] || [];
  if (first.length > 0) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${tab}!A1:${String.fromCharCode(64 + headers.length)}1`,
    valueInputOption: "RAW",
    requestBody: { values: [headers] },
  });
}

export async function prepareSheets() {
  const sheets = await getSheetsClient();
  const confirmacoes = await getConfirmacoesTab(sheets);
  const convites = getConvitesTab();
  await ensureTab(sheets, convites);
  await ensureTab(sheets, confirmacoes);
  await ensureHeaders(sheets, convites, [
    "Token",
    "Familia",
    "Adultos",
    "Confirmado",
  ]);
  await ensureHeaders(sheets, confirmacoes, [
    "Token",
    "Nome",
    "Telefone",
    "Data",
    "Adultos",
    "Crianças",
  ]);
}

export async function validateToken(token) {
  const sheets = await getSheetsClient();
  const tab = getConvitesTab();

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${tab}!A:D`,
  });

  const rows = result.data.values || [];
  const target = normalizeToken(token);

  for (let i = 1; i < rows.length; i++) {
    const [rowToken, familia, adultos, confirmado] = rows[i];
    if (normalizeToken(rowToken) === target) {
      if (confirmado) {
        return { valid: false, reason: "already_used" };
      }
      return {
        valid: true,
        familia: familia || "",
        adultos: parseInt(adultos, 10) || 1,
        sheetRowIndex: i + 1,
      };
    }
  }

  return { valid: false, reason: "not_found" };
}

async function markTokenAsUsed(token, timestamp) {
  const sheets = await getSheetsClient();
  const tab = getConvitesTab();

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${tab}!A:A`,
  });

  const rows = result.data.values || [];
  const target = normalizeToken(token);
  for (let i = 1; i < rows.length; i++) {
    if (normalizeToken(rows[i][0]) === target) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${tab}!D${i + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [[timestamp]] },
      });
      return;
    }
  }
}

export async function saveRsvpToSheet({ token, name, phone, adultos, criancas }) {
  const sheets = await getSheetsClient();
  const sheetTitle = await getConfirmacoesTab(sheets);

  const timestamp = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  const row = [
    token,
    name.trim(),
    String(phone).trim(),
    timestamp,
    String(adultos),
    String(criancas),
  ];

  const appendResult = await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetTitle}!A:F`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  await markTokenAsUsed(token, timestamp);

  return {
    row,
    sheetTitle,
    updatedRange: appendResult.data.updates?.updatedRange ?? "",
  };
}
