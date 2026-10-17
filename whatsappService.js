import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveWhatsAppAuthDir({
  env = process.env,
  baseDir = __dirname,
  tempDir = os.tmpdir(),
} = {}) {
  const configured = env.WHATSAPP_AUTH_DIR?.trim();
  const isServerless = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME);

  if (isServerless) {
    if (configured && path.isAbsolute(configured) && configured.startsWith(tempDir)) {
      return configured;
    }
    return path.join(tempDir, path.basename(configured || "whatsapp-auth"));
  }
  if (configured) return path.resolve(configured);
  return path.join(baseDir, ".whatsapp-auth");
}

function disconnectStatusCode(lastDisconnect) {
  return (
    lastDisconnect?.error?.output?.statusCode ??
    lastDisconnect?.error?.statusCode ??
    lastDisconnect?.error?.data?.statusCode ??
    null
  );
}

function accountLabel(user) {
  if (!user) return null;
  const digits = String(user.id || "").split(":")[0].replace(/\D/g, "");
  const suffix = digits ? `•••• ${digits.slice(-4)}` : "Conta conectada";
  return user.name ? `${user.name} · ${suffix}` : suffix;
}

export class WhatsAppService {
  constructor({
    authDir = resolveWhatsAppAuthDir(),
    makeSocket = makeWASocket,
    useAuthState = useMultiFileAuthState,
    qrToDataUrl = (value) => QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 360,
    }),
    logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || "silent" }),
    disconnectReason = DisconnectReason,
    reconnectDelayMs = 2500,
    scheduleReconnect = (callback, delay) => setTimeout(callback, delay),
  } = {}) {
    this.authDir = authDir;
    this.makeSocket = makeSocket;
    this.useAuthState = useAuthState;
    this.qrToDataUrl = qrToDataUrl;
    this.logger = logger;
    this.disconnectReason = disconnectReason;
    this.reconnectDelayMs = reconnectDelayMs;
    this.scheduleReconnect = scheduleReconnect;
    this.socket = null;
    this.connectPromise = null;
    this.state = "disconnected";
    this.qrDataUrl = null;
    this.lastError = "";
    this.connectedAccount = null;
    this.manualDisconnect = false;
    this.qrGeneration = 0;
  }

  getStatus() {
    return {
      state: this.state,
      qrDataUrl: this.qrDataUrl,
      lastError: this.lastError,
      connectedAccount: this.connectedAccount,
    };
  }

  async connect() {
    if (this.state === "connected" || this.state === "qr") {
      return this.getStatus();
    }
    if (this.connectPromise) return this.connectPromise;

    this.manualDisconnect = false;
    this.state = "connecting";
    this.lastError = "";
    this.connectPromise = this.createSocket();

    try {
      await this.connectPromise;
      return this.getStatus();
    } catch (error) {
      this.state = "error";
      this.lastError = String(error?.message || error || "Erro ao conectar");
      throw error;
    } finally {
      this.connectPromise = null;
    }
  }

  async createSocket() {
    const { state, saveCreds } = await this.useAuthState(this.authDir);
    const socket = this.makeSocket({
      auth: state,
      browser: Browsers.ubuntu("Convites F&V"),
      logger: this.logger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.socket = socket;

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("connection.update", (update) => {
      void this.handleConnectionUpdate(socket, update);
    });
  }

  async handleConnectionUpdate(socket, { connection, lastDisconnect, qr }) {
    if (socket !== this.socket) return;

    if (qr) {
      const generation = ++this.qrGeneration;
      const dataUrl = await this.qrToDataUrl(qr);
      if (socket === this.socket && generation === this.qrGeneration) {
        this.qrDataUrl = dataUrl;
        this.state = "qr";
      }
    }

    if (connection === "open") {
      this.qrGeneration += 1;
      this.qrDataUrl = null;
      this.state = "connected";
      this.lastError = "";
      this.connectedAccount = accountLabel(socket.user);
      return;
    }

    if (connection !== "close") return;

    this.qrGeneration += 1;
    this.qrDataUrl = null;
    this.connectedAccount = null;
    this.socket = null;
    const statusCode = disconnectStatusCode(lastDisconnect);

    if (statusCode === this.disconnectReason.loggedOut) {
      this.state = "logged_out";
      this.lastError = "A sessão foi desconectada pelo WhatsApp. Gere um novo QR Code.";
      return;
    }

    this.state = "disconnected";
    if (!this.manualDisconnect) {
      this.scheduleReconnect(() => {
        void this.connect().catch(() => {});
      }, statusCode === this.disconnectReason.restartRequired ? 250 : this.reconnectDelayMs);
    }
  }

  async sendText(number, text) {
    if (this.state !== "connected" || !this.socket) {
      throw new Error("WhatsApp não está conectado");
    }

    const digits = String(number ?? "").replace(/\D/g, "");
    if (!/^55\d{10,11}$/.test(digits)) {
      throw new Error("Número de WhatsApp inválido");
    }

    const requestedJid = `${digits}@s.whatsapp.net`;
    const registration = await this.socket.onWhatsApp(requestedJid);
    const registered = registration?.find((item) => item?.exists);
    if (!registered) {
      throw new Error("O número não está registrado no WhatsApp");
    }

    const response = await this.socket.sendMessage(
      registered.jid || requestedJid,
      { text: String(text) }
    );
    return { messageId: response?.key?.id || "" };
  }

  disconnect() {
    this.manualDisconnect = true;
    this.qrGeneration += 1;
    this.qrDataUrl = null;
    this.connectedAccount = null;
    if (this.socket?.end) {
      this.socket.end(new Error("Desconexão solicitada pelo administrador"));
    }
    this.socket = null;
    this.state = "disconnected";
    return this.getStatus();
  }
}

export const whatsappService = new WhatsAppService();
