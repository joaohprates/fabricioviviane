import test from "node:test";
import assert from "node:assert/strict";

import {
  isAdminTokenValid,
  requirePublicWeddingUrl,
} from "../adminSecurity.js";

test("valida o token administrativo sem aceitar valores ausentes ou parciais", () => {
  assert.equal(isAdminTokenValid("segredo-forte", "segredo-forte"), true);
  assert.equal(isAdminTokenValid("segredo", "segredo-forte"), false);
  assert.equal(isAdminTokenValid("", "segredo-forte"), false);
  assert.equal(isAdminTokenValid("segredo-forte", ""), false);
});

test("exige URL pública HTTPS para mensagens reais", () => {
  assert.equal(
    requirePublicWeddingUrl("https://casamento.exemplo.com"),
    "https://casamento.exemplo.com/"
  );
  assert.throws(() => requirePublicWeddingUrl("http://casamento.exemplo.com"), /HTTPS/);
  assert.throws(() => requirePublicWeddingUrl("http://localhost:3000"), /pública/);
});
