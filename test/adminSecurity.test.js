import test from "node:test";
import assert from "node:assert/strict";

import {
  isAdminTokenValid,
  requirePublicWeddingUrl,
  resolveWeddingSiteUrl,
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

test("resolve a URL do convite pelo ambiente da Vercel", () => {
  assert.equal(
    resolveWeddingSiteUrl({
      VERCEL_PROJECT_PRODUCTION_URL: "fabricioviviane.vercel.app",
    }),
    "https://fabricioviviane.vercel.app"
  );
  assert.equal(
    resolveWeddingSiteUrl({
      WEDDING_SITE_URL: "https://casamento.exemplo.com",
      VERCEL_PROJECT_PRODUCTION_URL: "fabricioviviane.vercel.app",
    }),
    "https://casamento.exemplo.com"
  );
});

test("usa o domínio público do casamento como fallback", () => {
  assert.equal(
    resolveWeddingSiteUrl({}),
    "https://fabricioviviane.vercel.app"
  );
});
