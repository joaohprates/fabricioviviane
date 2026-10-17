import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { WhatsAppService } from "../whatsappService.js";

function createHarness({ exists = true } = {}) {
  const ev = new EventEmitter();
  const sent = [];
  const socket = {
    ev,
    user: { id: "5544999999999:1@s.whatsapp.net", name: "Noivos" },
    onWhatsApp: async () => [{ exists, jid: "5544999999999@s.whatsapp.net" }],
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: "message-123" } };
    },
    end: () => {},
  };
  const service = new WhatsAppService({
    authDir: "C:\\temp\\whatsapp-test",
    makeSocket: () => socket,
    useAuthState: async () => ({ state: { creds: {} }, saveCreds: async () => {} }),
    qrToDataUrl: async (value) => `data:image/png;base64,${value}`,
    logger: { trace() {}, debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
    disconnectReason: { loggedOut: 401, restartRequired: 515 },
  });
  return { service, socket, sent };
}

test("expõe o QR e muda para conectado após o pareamento", async () => {
  const { service, socket } = createHarness();
  await service.connect();

  socket.ev.emit("connection.update", { qr: "qr-seguro" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getStatus().state, "qr");
  assert.equal(service.getStatus().qrDataUrl, "data:image/png;base64,qr-seguro");

  socket.ev.emit("connection.update", { connection: "open" });
  assert.equal(service.getStatus().state, "connected");
  assert.equal(service.getStatus().qrDataUrl, null);
});

test("envia somente para número registrado no WhatsApp", async () => {
  const { service, socket, sent } = createHarness();
  await service.connect();
  socket.ev.emit("connection.update", { connection: "open" });

  const result = await service.sendText("5544999999999", "Convite");
  assert.deepEqual(result, { messageId: "message-123" });
  assert.deepEqual(sent, [{
    jid: "5544999999999@s.whatsapp.net",
    content: { text: "Convite" },
  }]);
});

test("recusa número que não está registrado no WhatsApp", async () => {
  const { service, socket } = createHarness({ exists: false });
  await service.connect();
  socket.ev.emit("connection.update", { connection: "open" });

  await assert.rejects(
    () => service.sendText("5544999999999", "Convite"),
    /não está registrado/
  );
});
