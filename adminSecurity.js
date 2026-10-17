import crypto from "node:crypto";

export function isAdminTokenValid(provided, expected) {
  const received = Buffer.from(String(provided || ""));
  const configured = Buffer.from(String(expected || ""));
  if (received.length === 0 || received.length !== configured.length) {
    return false;
  }
  return crypto.timingSafeEqual(received, configured);
}

function isPrivateHostname(hostname) {
  const value = hostname.toLowerCase();
  return (
    value === "localhost" ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value.endsWith(".local") ||
    /^10\./.test(value) ||
    /^192\.168\./.test(value) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(value)
  );
}

export function requirePublicWeddingUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("Configure uma URL pública válida para o site do casamento");
  }

  if (isPrivateHostname(url.hostname)) {
    throw new Error("Configure uma URL pública para o site do casamento");
  }
  if (url.protocol !== "https:") {
    throw new Error("A URL pública do casamento precisa usar HTTPS");
  }
  return url.toString();
}

export function resolveWeddingSiteUrl(env = process.env) {
  if (env.WEDDING_SITE_URL?.trim()) return env.WEDDING_SITE_URL.trim();

  const vercelHost = (
    env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || ""
  ).trim();
  if (vercelHost) return `https://${vercelHost}`;

  return "https://fabricioviviane.vercel.app";
}
