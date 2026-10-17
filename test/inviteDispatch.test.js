import test from "node:test";
import assert from "node:assert/strict";

import {
  InviteDispatchManager,
  buildInviteLink,
  buildInviteMessage,
  planInviteDispatch,
} from "../inviteDispatch.js";
import { ensureTrackingHeaderRow } from "../inviteSheetStore.js";

const headers = [
  "A - Token",
  "B — Família",
  "C — Número",
  "D — Padrinho",
  "E — Adultos",
  "F — Confirmado",
  "G — Envio WhatsApp",
  "H — Data do envio",
  "I — ID da mensagem",
  "J — Erro do envio",
];

test("monta link individual e mensagem predefinida", () => {
  assert.equal(
    buildInviteLink("https://casamento.exemplo.com", "Família Silva"),
    "https://casamento.exemplo.com/?convite=Fam%C3%ADlia+Silva#confirmar"
  );

  const message = buildInviteMessage({
    familia: "Família Silva",
    token: "Família Silva",
    siteUrl: "https://casamento.exemplo.com",
    template: "Olá, {familia}! Acesse {link} usando {codigo}.",
  });
  assert.match(message, /^Olá, Família Silva!/);
  assert.match(message, /convite=Fam%C3%ADlia\+Silva#confirmar/);
  assert.match(message, /usando Família Silva\.$/);
});

test("prepara apenas convites seguros e ainda não enviados", () => {
  const values = [
    headers,
    ["unico", "Família Única", "44999999999", "", "", "", "", "", "", ""],
    ["repetido", "Família A", "44999999991", "", "", "", "", "", "", ""],
    ["repetido", "Família B", "44999999992", "", "", "", "", "", "", ""],
    ["sem-numero", "Família C", "", "", "", "", "", "", "", ""],
    ["enviado", "Família D", "44999999993", "", "", "", "Enviado", "", "", ""],
  ];

  const plan = planInviteDispatch(values);

  assert.deepEqual(plan.counts, {
    total: 5,
    ready: 1,
    sent: 1,
    issues: 3,
  });
  assert.deepEqual(plan.ready[0], {
    rowIndex: 2,
    token: "unico",
    familia: "Família Única",
    whatsappNumber: "5544999999999",
    padrinho: false,
  });
  assert.equal(plan.issues.filter((item) => item.reason === "duplicate_token").length, 2);
  assert.equal(plan.issues.some((item) => item.reason === "invalid_phone"), true);
});

test("acrescenta colunas de rastreamento sem deslocar a planilha existente", () => {
  const result = ensureTrackingHeaderRow(headers.slice(0, 6));
  assert.equal(result.changed, true);
  assert.deepEqual(result.headers, headers);

  const unchanged = ensureTrackingHeaderRow(headers);
  assert.equal(unchanged.changed, false);
  assert.deepEqual(unchanged.headers, headers);
});

test("o gerenciador envia sequencialmente e registra sucesso e erro", async () => {
  const records = [];
  const sentTo = [];
  const manager = new InviteDispatchManager({
    getPlan: async () => ({
      ready: [
        { rowIndex: 2, token: "um", familia: "Família Um", whatsappNumber: "5544999999991" },
        { rowIndex: 3, token: "dois", familia: "Família Dois", whatsappNumber: "5544999999992" },
      ],
      counts: { total: 2, ready: 2, sent: 0, issues: 0 },
      issues: [],
    }),
    ensureTracking: async () => {},
    recordStatus: async (rowIndex, status) => records.push({ rowIndex, ...status }),
    sendMessage: async (number) => {
      sentTo.push(number);
      if (number.endsWith("2")) throw new Error("falha simulada");
      return { messageId: "msg-1" };
    },
    buildMessage: (invite) => `Convite ${invite.token}`,
    sleep: async () => {},
    now: () => new Date("2026-10-17T18:00:00-03:00"),
    intervalMs: 5000,
    maxPerRun: 20,
  });

  await manager.start({ limit: 2 });

  assert.deepEqual(sentTo, ["5544999999991", "5544999999992"]);
  assert.equal(records[0].status, "Enviado");
  assert.equal(records[0].messageId, "msg-1");
  assert.equal(records[1].status, "Erro");
  assert.match(records[1].error, /falha simulada/);
  assert.deepEqual(manager.getStatus().progress, {
    selected: 2,
    processed: 2,
    sent: 1,
    failed: 1,
  });
});

test("impede duas execuções simultâneas", async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const manager = new InviteDispatchManager({
    getPlan: async () => ({
      ready: [{ rowIndex: 2, token: "um", familia: "Família", whatsappNumber: "5544999999991" }],
      counts: { total: 1, ready: 1, sent: 0, issues: 0 },
      issues: [],
    }),
    ensureTracking: async () => {},
    recordStatus: async () => {},
    sendMessage: async () => waiting.then(() => ({ messageId: "msg" })),
    buildMessage: () => "Convite",
    sleep: async () => {},
    intervalMs: 5000,
    maxPerRun: 20,
  });

  const firstRun = manager.start({ limit: 1 });
  await assert.rejects(() => manager.start({ limit: 1 }), /andamento/);
  release();
  await firstRun;
});
