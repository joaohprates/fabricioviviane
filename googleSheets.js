import { google } from "googleapis";

export async function getSheetsClient() {
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

export function getConvitesTab() {
  return process.env.GOOGLE_CONVITES_TAB_NAME || "Convites";
}

export function normalizeToken(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizeHeader(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]\s*[-—–]\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const INVITE_HEADER_ALIASES = {
  token: ["token", "codigo", "codigo do convite"],
  familia: ["familia", "nome da familia"],
  numero: ["numero", "telefone", "celular", "whatsapp"],
  padrinho: ["padrinho", "padrinhos"],
  confirmado: ["confirmado", "confirmacao", "data da confirmacao"],
  envioStatus: ["envio whatsapp", "status do envio", "enviado"],
  envioData: ["data do envio"],
  mensagemId: ["id da mensagem", "message id"],
  envioErro: ["erro do envio"],
};

export function mapInviteHeaders(headers) {
  const normalized = headers.map(normalizeHeader);
  const mapped = {};

  for (const [field, aliases] of Object.entries(INVITE_HEADER_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) mapped[field] = index;
  }

  const required = {
    token: "Token",
    familia: "Família",
    confirmado: "Confirmado",
  };
  const missing = Object.entries(required)
    .filter(([field]) => mapped[field] === undefined)
    .map(([, label]) => label);

  if (missing.length > 0) {
    throw new Error(`Colunas obrigatórias ausentes na aba de convites: ${missing.join(", ")}`);
  }

  return mapped;
}

export function normalizeWhatsAppNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    return digits;
  }
  return null;
}

function isAffirmative(value) {
  return ["sim", "s", "yes", "true", "1", "x"].includes(
    normalizeToken(value)
  );
}

export function buildPublicInvitePayload(invite) {
  return {
    familia: invite.familia,
    padrinho: invite.padrinho === true,
  };
}

export function findInviteByToken(values, token) {
  const headers = values[0] || [];
  const columns = mapInviteHeaders(headers);
  const target = normalizeToken(token);
  const matches = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    if (normalizeToken(row[columns.token]) === target) {
      matches.push({ row, sheetRowIndex: i + 1 });
    }
  }

  if (matches.length === 0) {
    return { valid: false, reason: "not_found" };
  }
  if (matches.length > 1) {
    return { valid: false, reason: "duplicate_token" };
  }

  const { row, sheetRowIndex } = matches[0];
  if (String(row[columns.confirmado] ?? "").trim()) {
    return { valid: false, reason: "already_used" };
  }

  const phone =
    columns.numero === undefined
      ? ""
      : String(row[columns.numero] ?? "").trim();
  return {
    valid: true,
    familia: String(row[columns.familia] ?? "").trim(),
    phone,
    whatsappNumber: normalizeWhatsAppNumber(phone),
    padrinho:
      columns.padrinho === undefined
        ? false
        : isAffirmative(row[columns.padrinho]),
    sheetRowIndex,
    confirmedColumnIndex: columns.confirmado,
  };
}

export function columnIndexToLetter(index) {
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError("O índice da coluna deve ser um inteiro não negativo");
  }

  let value = index + 1;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

export function sheetRange(tab, range) {
  return `'${String(tab).replace(/'/g, "''")}'!${range}`;
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
    "Família",
    "Número",
    "Padrinho",
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
    range: sheetRange(tab, "A:Z"),
  });

  return findInviteByToken(result.data.values || [], token);
}

export function buildRsvpRow({ token, name, phone, timestamp, criancas }) {
  return [
    token,
    name.trim(),
    String(phone).trim(),
    timestamp,
    "",
    String(criancas),
  ];
}

async function markInviteAsUsed({ rowIndex, columnIndex, timestamp }) {
  const sheets = await getSheetsClient();
  const tab = getConvitesTab();
  const column = columnIndexToLetter(columnIndex);

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: sheetRange(tab, `${column}${rowIndex}`),
    valueInputOption: "RAW",
    requestBody: { values: [[timestamp]] },
  });
}

export async function saveRsvpToSheet({
  token,
  name,
  phone,
  criancas,
  inviteRowIndex,
  confirmedColumnIndex,
}) {
  const sheets = await getSheetsClient();
  const sheetTitle = await getConfirmacoesTab(sheets);

  const timestamp = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  const row = buildRsvpRow({
    token,
    name,
    phone,
    timestamp,
    criancas,
  });

  const appendResult = await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetTitle}!A:F`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  await markInviteAsUsed({
    rowIndex: inviteRowIndex,
    columnIndex: confirmedColumnIndex,
    timestamp,
  });

  return {
    row,
    sheetTitle,
    updatedRange: appendResult.data.updates?.updatedRange ?? "",
  };
}
