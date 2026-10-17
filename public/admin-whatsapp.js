const accessCard = document.getElementById("access-card");
const accessForm = document.getElementById("access-form");
const accessMessage = document.getElementById("access-message");
const tokenInput = document.getElementById("admin-token");
const workspace = document.getElementById("workspace");
const connectionPill = document.getElementById("connection-pill");
const connectionCopy = document.getElementById("connection-copy");
const qrImage = document.getElementById("qr-image");
const qrPlaceholder = document.getElementById("qr-placeholder");
const connectButton = document.getElementById("connect-button");
const disconnectButton = document.getElementById("disconnect-button");
const refreshButton = document.getElementById("refresh-button");
const readyCount = document.getElementById("ready-count");
const sentCount = document.getElementById("sent-count");
const issueCount = document.getElementById("issue-count");
const issuesList = document.getElementById("issues-list");
const messagePreview = document.getElementById("message-preview");
const sendLimit = document.getElementById("send-limit");
const sendCadence = document.getElementById("send-cadence");
const reviewCheck = document.getElementById("review-check");
const sendButton = document.getElementById("send-button");
const stopButton = document.getElementById("stop-button");
const sendMessage = document.getElementById("send-message");
const progressWrap = document.getElementById("progress-wrap");
const progressLabel = document.getElementById("progress-label");
const progressBar = document.getElementById("progress-bar");

const TOKEN_KEY = "fv-whatsapp-admin-token";
let adminToken = sessionStorage.getItem(TOKEN_KEY) || "";
let pollTimer = null;
let latestStatus = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": adminToken,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Não foi possível concluir a operação.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function connectionLabel(state) {
  return ({
    disconnected: "Desconectado",
    connecting: "Conectando",
    qr: "Aguardando leitura",
    connected: "Conectado",
    logged_out: "Sessão encerrada",
    error: "Erro",
  })[state] || "Desconectado";
}

function renderStatus(data) {
  latestStatus = data;
  const whatsapp = data.whatsapp || {};
  const dispatch = data.dispatch || {};
  const progress = dispatch.progress || { selected: 0, processed: 0, sent: 0, failed: 0 };
  connectionPill.textContent = connectionLabel(whatsapp.state);
  connectionPill.className = "status-pill" + (whatsapp.state === "connected" ? " connected" : (["qr", "connecting"].includes(whatsapp.state) ? " waiting" : ""));

  if (whatsapp.qrDataUrl) {
    qrImage.src = whatsapp.qrDataUrl;
    qrImage.hidden = false;
    qrPlaceholder.hidden = true;
  } else {
    qrImage.removeAttribute("src");
    qrImage.hidden = true;
    qrPlaceholder.hidden = false;
  }

  if (whatsapp.state === "connected") {
    connectionCopy.textContent = whatsapp.connectedAccount || "WhatsApp conectado e pronto.";
  } else if (whatsapp.state === "qr") {
    connectionCopy.textContent = "Escaneie o QR Code no celular dos noivos. Ele expira e será renovado automaticamente.";
  } else if (whatsapp.lastError) {
    connectionCopy.textContent = whatsapp.lastError;
  } else {
    connectionCopy.textContent = "No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.";
  }

  connectButton.disabled = ["connecting", "qr", "connected"].includes(whatsapp.state);
  disconnectButton.disabled = whatsapp.state === "disconnected";
  sendLimit.max = String(data.settings?.maxPerRun || 20);
  if (Number(sendLimit.value) > Number(sendLimit.max)) sendLimit.value = sendLimit.max;
  sendCadence.textContent = `Até ${sendLimit.max} por lote, com ${data.settings?.intervalSeconds || 8}s entre mensagens.`;

  const canSend = whatsapp.state === "connected" && !dispatch.running && reviewCheck.checked;
  sendButton.disabled = !canSend;
  stopButton.disabled = !dispatch.running;
  reviewCheck.disabled = dispatch.running;
  sendLimit.disabled = dispatch.running;

  progressWrap.hidden = progress.selected === 0;
  progressLabel.textContent = `${progress.processed} / ${progress.selected}`;
  const percent = progress.selected ? Math.round((progress.processed / progress.selected) * 100) : 0;
  progressBar.style.width = `${percent}%`;
  if (dispatch.running) {
    sendMessage.textContent = `Envio em andamento: ${progress.sent} enviados, ${progress.failed} com erro.`;
  } else if (progress.processed > 0) {
    sendMessage.textContent = `Lote finalizado: ${progress.sent} enviados, ${progress.failed} com erro.`;
  } else if (dispatch.lastError) {
    sendMessage.textContent = dispatch.lastError;
  }
}

function renderPreview(data) {
  readyCount.textContent = data.counts.ready;
  sentCount.textContent = data.counts.sent;
  issueCount.textContent = data.counts.issues;
  messagePreview.textContent = data.messagePreview || "Não há convite pronto para pré-visualizar.";
  const labels = {
    duplicate_token: "Tokens repetidos",
    invalid_phone: "Números ausentes ou inválidos",
    missing_token: "Linhas sem token",
  };
  const entries = Object.entries(data.issueCounts || {}).filter(([, count]) => count > 0);
  issuesList.replaceChildren();
  if (entries.length === 0) {
    const item = document.createElement("p");
    item.textContent = "Nenhuma pendência encontrada na fila.";
    issuesList.appendChild(item);
    return;
  }
  const list = document.createElement("ul");
  for (const [reason, count] of entries) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = labels[reason] || reason;
    value.textContent = count;
    item.append(label, value);
    list.appendChild(item);
  }
  issuesList.appendChild(list);
}

async function refreshStatus() {
  try {
    renderStatus(await api("/api/admin/whatsapp/status"));
  } catch (error) {
    if (error.status === 401) showAccess("Token administrativo inválido.");
    else sendMessage.textContent = error.message;
  }
}

async function refreshPreview() {
  refreshButton.disabled = true;
  try {
    renderPreview(await api("/api/admin/whatsapp/preview"));
  } catch (error) {
    issuesList.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

function showWorkspace() {
  accessCard.hidden = true;
  workspace.hidden = false;
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshStatus, 2000);
}

function showAccess(message = "") {
  clearInterval(pollTimer);
  pollTimer = null;
  sessionStorage.removeItem(TOKEN_KEY);
  adminToken = "";
  accessCard.hidden = false;
  workspace.hidden = true;
  accessMessage.textContent = message;
}

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  adminToken = tokenInput.value.trim();
  accessMessage.textContent = "Verificando…";
  try {
    const status = await api("/api/admin/whatsapp/status");
    sessionStorage.setItem(TOKEN_KEY, adminToken);
    accessMessage.textContent = "";
    showWorkspace();
    renderStatus(status);
    await refreshPreview();
  } catch (error) {
    accessMessage.textContent = error.message;
  }
});

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;
  connectionCopy.textContent = "Preparando uma sessão segura…";
  try {
    await api("/api/admin/whatsapp/connect", { method: "POST", body: "{}" });
    await refreshStatus();
  } catch (error) {
    connectionCopy.textContent = error.message;
  }
});

disconnectButton.addEventListener("click", async () => {
  try {
    await api("/api/admin/whatsapp/disconnect", { method: "POST", body: "{}" });
    await refreshStatus();
  } catch (error) {
    connectionCopy.textContent = error.message;
  }
});

refreshButton.addEventListener("click", refreshPreview);
reviewCheck.addEventListener("change", () => latestStatus && renderStatus(latestStatus));

sendButton.addEventListener("click", async () => {
  if (!reviewCheck.checked) return;
  sendButton.disabled = true;
  sendMessage.textContent = "Iniciando o lote…";
  try {
    await api("/api/admin/whatsapp/send", {
      method: "POST",
      body: JSON.stringify({
        confirmation: "ENVIAR_CONVITES",
        limit: Number(sendLimit.value),
      }),
    });
    await refreshStatus();
  } catch (error) {
    sendMessage.textContent = error.message;
    await refreshStatus();
  }
});

stopButton.addEventListener("click", async () => {
  try {
    await api("/api/admin/whatsapp/stop", { method: "POST", body: "{}" });
    sendMessage.textContent = "Parada solicitada. A mensagem atual será concluída.";
    await refreshStatus();
  } catch (error) {
    sendMessage.textContent = error.message;
  }
});

if (adminToken) {
  api("/api/admin/whatsapp/status")
    .then(async (status) => {
      showWorkspace();
      renderStatus(status);
      await refreshPreview();
    })
    .catch(() => showAccess());
}
