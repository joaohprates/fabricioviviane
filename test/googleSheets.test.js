import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPublicInvitePayload,
  buildRsvpRow,
  columnIndexToLetter,
  findInviteByToken,
  mapInviteHeaders,
  normalizeWhatsAppNumber,
} from "../googleSheets.js";

const headers = [
  "A - Token",
  "B — Família",
  "C — Número",
  "D — Padrinho",
  "E — Adultos",
  "F — Confirmado",
];

test("mapeia os novos cabeçalhos independentemente de acentos e prefixos", () => {
  assert.deepEqual(mapInviteHeaders(headers), {
    token: 0,
    familia: 1,
    numero: 2,
    padrinho: 3,
    confirmado: 5,
  });
});

test("encontra o convite sem expor quantidade de adultos", () => {
  const values = [
    headers,
    ["familia-silva", "Família Silva", "44999999999", "", "3", ""],
  ];

  assert.deepEqual(findInviteByToken(values, "FAMÍLIA-SILVA"), {
    valid: true,
    familia: "Família Silva",
    phone: "44999999999",
    whatsappNumber: "5544999999999",
    padrinho: false,
    sheetRowIndex: 2,
    confirmedColumnIndex: 5,
  });
});

test("não interpreta Padrinho como confirmação", () => {
  const values = [
    headers,
    ["padrinhos", "Casal Padrinho", "44999999999", "Sim", "2", ""],
  ];

  const result = findInviteByToken(values, "padrinhos");
  assert.equal(result.valid, true);
  assert.equal(result.padrinho, true);
});

test("interpreta explicitamente Não como convite comum", () => {
  const values = [
    headers,
    ["convidados", "Família Convidada", "44999999999", "Não", "2", ""],
  ];

  const result = findInviteByToken(values, "convidados");
  assert.equal(result.valid, true);
  assert.equal(result.padrinho, false);
});

test("expõe somente os dados públicos necessários para personalizar o convite", () => {
  assert.deepEqual(
    buildPublicInvitePayload({
      familia: "Casal Padrinho",
      padrinho: true,
      phone: "44999999999",
      whatsappNumber: "5544999999999",
      sheetRowIndex: 3,
      confirmedColumnIndex: 5,
    }),
    {
      familia: "Casal Padrinho",
      padrinho: true,
    }
  );
});

test("considera confirmado apenas quando a coluna Confirmado está preenchida", () => {
  const values = [
    headers,
    ["usado", "Família", "44999999999", "", "2", "17/10/2026 15:00"],
  ];

  assert.deepEqual(findInviteByToken(values, "usado"), {
    valid: false,
    reason: "already_used",
  });
});

test("a coluna Adultos não é obrigatória", () => {
  const values = [
    ["Token", "Família", "Número", "Padrinho", "Confirmado"],
    ["sem-adultos", "Família", "44999999999", "", ""],
  ];

  const result = findInviteByToken(values, "sem-adultos");
  assert.equal(result.valid, true);
  assert.equal("adultos" in result, false);
});

test("rejeita token duplicado para não confirmar a família errada", () => {
  const values = [
    headers,
    ["repetido", "Família A", "44999999991", "", "2", ""],
    ["repetido", "Família B", "44999999992", "", "2", ""],
  ];

  assert.deepEqual(findInviteByToken(values, "repetido"), {
    valid: false,
    reason: "duplicate_token",
  });
});

test("falha claramente quando uma coluna obrigatória não existe", () => {
  assert.throws(
    () => mapInviteHeaders(["Token", "Família"]),
    /Confirmado/
  );
});

test("salva a confirmação sem quantidade liberada de adultos", () => {
  assert.deepEqual(
    buildRsvpRow({
      token: "familia-silva",
      name: "Pessoa",
      phone: "44999999999",
      timestamp: "17/10/2026 16:00:00",
      criancas: 2,
    }),
    [
      "familia-silva",
      "Pessoa",
      "44999999999",
      "17/10/2026 16:00:00",
      "",
      "2",
    ]
  );
});

test("converte índice de coluna para notação A1", () => {
  assert.equal(columnIndexToLetter(0), "A");
  assert.equal(columnIndexToLetter(5), "F");
  assert.equal(columnIndexToLetter(26), "AA");
});

test("normaliza números brasileiros para o formato internacional do WhatsApp", () => {
  assert.equal(normalizeWhatsAppNumber("(44) 99999-9999"), "5544999999999");
  assert.equal(normalizeWhatsAppNumber("55 44 99999-9999"), "5544999999999");
  assert.equal(normalizeWhatsAppNumber(""), null);
  assert.equal(normalizeWhatsAppNumber("9999-9999"), null);
});
