import {
  columnIndexToLetter,
  getConvitesTab,
  getSheetsClient,
  mapInviteHeaders,
  sheetRange,
} from "./googleSheets.js";
import { planInviteDispatch } from "./inviteDispatch.js";

const TRACKING_HEADERS = [
  { field: "envioStatus", label: "Envio WhatsApp" },
  { field: "envioData", label: "Data do envio" },
  { field: "mensagemId", label: "ID da mensagem" },
  { field: "envioErro", label: "Erro do envio" },
];

export function ensureTrackingHeaderRow(currentHeaders) {
  const headers = [...currentHeaders];
  let columns = mapInviteHeaders(headers);
  let changed = false;

  for (const { field, label } of TRACKING_HEADERS) {
    if (columns[field] !== undefined) continue;
    headers.push(`${columnIndexToLetter(headers.length)} — ${label}`);
    changed = true;
    columns = mapInviteHeaders(headers);
  }

  return { headers, columns, changed };
}

async function readInviteValues(sheets, tab, range = "A:Z") {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: sheetRange(tab, range),
  });
  return result.data.values || [];
}

export async function ensureInviteDispatchTracking() {
  const sheets = await getSheetsClient();
  const tab = getConvitesTab();
  const values = await readInviteValues(sheets, tab, "A1:Z1");
  const currentHeaders = values[0] || [];
  const result = ensureTrackingHeaderRow(currentHeaders);

  if (result.changed) {
    const lastColumn = columnIndexToLetter(result.headers.length - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: sheetRange(tab, `A1:${lastColumn}1`),
      valueInputOption: "RAW",
      requestBody: { values: [result.headers] },
    });
  }

  return result;
}

export async function getInviteDispatchPlan() {
  const sheets = await getSheetsClient();
  const tab = getConvitesTab();
  const values = await readInviteValues(sheets, tab);
  return planInviteDispatch(values);
}

export async function recordInviteDispatchStatus(
  rowIndex,
  { status, timestamp, messageId, error }
) {
  if (!Number.isInteger(rowIndex) || rowIndex < 2) {
    throw new TypeError("Linha de convite inválida");
  }

  const sheets = await getSheetsClient();
  const tab = getConvitesTab();
  const values = await readInviteValues(sheets, tab, "A1:Z1");
  const columns = mapInviteHeaders(values[0] || []);
  const entries = [
    ["envioStatus", status],
    ["envioData", timestamp],
    ["mensagemId", messageId],
    ["envioErro", error],
  ];

  for (const [field] of entries) {
    if (columns[field] === undefined) {
      throw new Error("As colunas de acompanhamento do WhatsApp não foram preparadas");
    }
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: entries.map(([field, value]) => ({
        range: sheetRange(
          tab,
          `${columnIndexToLetter(columns[field])}${rowIndex}`
        ),
        values: [[String(value ?? "")]],
      })),
    },
  });
}
