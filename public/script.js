// Navegação, vídeo, ideias de presentes e confirmação por convite.
const paginas = document.querySelectorAll(".page");
const homeVideo = document.getElementById("home-video");
const videoToggle = document.getElementById("video-toggle");
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
let videoPausedByUser = false;

function syncVideoButton() {
  const playing = !homeVideo.paused;
  videoToggle.setAttribute("aria-label", playing ? "Pausar vídeo" : "Reproduzir vídeo");
  videoToggle.setAttribute("aria-pressed", String(playing));
  videoToggle.querySelector(".video-toggle-icon").textContent = playing ? "Ⅱ" : "▶";
  videoToggle.querySelector(".video-toggle-label").textContent = playing ? "Pausar" : "Reproduzir";
}

function syncVideo() {
  if (document.getElementById("page-home").hidden || document.hidden || motionPreference.matches || videoPausedByUser) {
    homeVideo.pause();
  } else {
    homeVideo.play().catch(syncVideoButton);
  }
}

function irPara(nome, { updateHistory = true, focus = true } = {}) {
  const target = document.getElementById("page-" + nome);
  if (!target?.classList.contains("page")) return;
  paginas.forEach((page) => {
    const active = page === target;
    page.classList.toggle("active", active);
    page.hidden = !active;
  });
  document.querySelectorAll(".site-header [data-goto]").forEach((link) => {
    if (link.dataset.goto === nome) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (updateHistory && location.hash !== "#" + nome) history.pushState(null, "", "#" + nome);
  if (focus) {
    target.querySelector("h1, h2")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  syncVideo();
}

document.querySelectorAll("[data-goto]").forEach((link) => {
  link.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    irPara(link.dataset.goto);
  });
});
function readRoute(focus = true) {
  const name = location.hash.slice(1);
  const valid = ["home", "info", "presentes", "confirmar"].includes(name);
  if (name === "app") return;
  irPara(valid ? name : "home", { updateHistory: false, focus });
}
window.addEventListener("hashchange", () => readRoute());
readRoute(false);
homeVideo.addEventListener("play", syncVideoButton);
homeVideo.addEventListener("pause", syncVideoButton);
videoToggle.addEventListener("click", () => {
  videoPausedByUser = !homeVideo.paused;
  if (videoPausedByUser) homeVideo.pause();
  else homeVideo.play().catch(syncVideoButton);
});
motionPreference.addEventListener("change", syncVideo);
document.addEventListener("visibilitychange", syncVideo);
syncVideoButton();

// 16h de São Paulo, mesma data e fuso do arquivo de calendário.
const weddingTime = new Date("2026-11-14T16:00:00-03:00").getTime();
function updateCountdown() {
  const seconds = Math.max(0, Math.floor((weddingTime - Date.now()) / 1000));
  const values = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
  ["days", "hours", "minutes", "seconds"].forEach((unit, index) => {
    document.getElementById("count-" + unit).textContent = String(values[index]).padStart(2, "0");
  });
  if (seconds === 0) {
    document.getElementById("countdown-eyebrow").textContent = "O NOSSO PARA SEMPRE";
    document.getElementById("countdown-heading").textContent = "Chegou o dia do nosso sim.";
  }
}
updateCountdown();
setInterval(updateCountdown, 1000);

// A seleção é uma lista de favoritos local, sem pagamento ou envio aos noivos.
const PRESENTES_EMOCIONAIS = [
  { id: 1, nome: "Brinde dos noivos", desc: "Uma taça especial para o primeiro brinde da festa." },
  { id: 2, nome: "Cota lua de mel", desc: "Um carinho para a nossa primeira viagem de casados." },
  { id: 3, nome: "Jantar romântico", desc: "Um jantar à luz de velas durante a lua de mel." },
  { id: 4, nome: "Sessão de fotos", desc: "Registros dos primeiros dias da nossa vida a dois." },
  { id: 5, nome: "Passeio ao pôr do sol", desc: "Um passeio inesquecível para dois." },
  { id: 6, nome: "Carta para o futuro", desc: "Uma carta para abrir no primeiro aniversário de casamento." },
  { id: 7, nome: "Uma música na festa", desc: "Aquela música que vai fazer a gente dançar." },
  { id: 8, nome: "Plante uma árvore", desc: "Um gesto simbólico que cresce junto com a gente." },
];
const STORAGE_KEY = "presentesEmocionais";
const presenteados = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (Array.isArray(saved)) saved.filter((id) => PRESENTES_EMOCIONAIS.some((gift) => gift.id === id)).forEach((id) => presenteados.add(id));
} catch { /* A navegação deve funcionar mesmo com armazenamento bloqueado. */ }

const giftList = document.getElementById("gift-list");
function updateGiftButton(button, gift) {
  const saved = presenteados.has(gift.id);
  button.textContent = saved ? "Salvo ✓" : "Salvar ideia";
  button.setAttribute("aria-pressed", String(saved));
  button.setAttribute("aria-label", (saved ? "Remover ideia: " : "Salvar ideia: ") + gift.nome);
}
PRESENTES_EMOCIONAIS.forEach((gift) => {
  const item = document.createElement("li");
  item.className = "gift-item";
  item.innerHTML = '<span class="gift-number" aria-hidden="true">' + String(gift.id).padStart(2, "0") + '</span><div class="gift-info"><h4 class="gift-nome"></h4><p class="gift-desc"></p></div><button type="button" class="gift-btn"></button>';
  item.querySelector(".gift-nome").textContent = gift.nome;
  item.querySelector(".gift-desc").textContent = gift.desc;
  const button = item.querySelector("button");
  updateGiftButton(button, gift);
  button.addEventListener("click", () => {
    if (presenteados.has(gift.id)) presenteados.delete(gift.id);
    else presenteados.add(gift.id);
    let persisted = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...presenteados])); }
    catch { persisted = false; }
    updateGiftButton(button, gift);
    document.getElementById("gift-feedback").textContent = persisted
      ? (presenteados.has(gift.id) ? "Ideia salva neste dispositivo: " : "Ideia removida: ") + gift.nome + "."
      : "A seleção ficará disponível apenas enquanto esta página estiver aberta.";
  });
  giftList.appendChild(item);
});
const btnEmocionais = document.getElementById("btn-emocionais");
const listaEmocionais = document.getElementById("lista-emocionais");
btnEmocionais.addEventListener("click", () => {
  const opening = listaEmocionais.hidden;
  listaEmocionais.hidden = !opening;
  btnEmocionais.setAttribute("aria-expanded", String(opening));
  btnEmocionais.querySelector(".opcao-cta").textContent = opening ? "Recolher as ideias ↑" : "Explorar as ideias ↓";
  if (opening) listaEmocionais.scrollIntoView({ behavior: motionPreference.matches ? "instant" : "smooth", block: "start" });
});

// O contrato das APIs existentes permanece o mesmo.
const form = document.getElementById("rsvp-form");
const passoCodigo = document.getElementById("rsvp-passo-codigo");
const passoDados = document.getElementById("rsvp-passo-dados");
const inputCodigo = document.getElementById("codigo");
const inputNome = document.getElementById("nome");
const inputTelefone = document.getElementById("telefone");
const inputCriancas = document.getElementById("criancas");
const blocoFamilia = document.getElementById("rsvp-familia");
const btnValidar = document.getElementById("rsvp-btn-validar");
const btnConfirmar = document.getElementById("rsvp-btn-confirmar");
const btnTrocar = document.getElementById("rsvp-trocar");
const msg = document.getElementById("rsvp-msg");
const blocoSucesso = document.getElementById("rsvp-sucesso");
const btnVoltarConfirmar = document.getElementById("voltar-confirmar");
const validateLabel = btnValidar.innerHTML;
let conviteAtual = null;

function setStep(details) {
  document.getElementById("step-code").classList.toggle("is-current", !details);
  document.getElementById("step-details").classList.toggle("is-current", details);
}
function setMsg(tipo, texto, input) {
  msg.className = "rsvp-msg" + (tipo ? " " + tipo : "");
  msg.textContent = texto;
  form.querySelectorAll("[aria-invalid]").forEach((field) => field.removeAttribute("aria-invalid"));
  if (input) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
}
function resetRsvp() {
  conviteAtual = null;
  passoCodigo.hidden = false;
  passoDados.hidden = true;
  form.hidden = false;
  btnVoltarConfirmar.hidden = false;
  blocoSucesso.hidden = true;
  form.reset();
  blocoFamilia.textContent = "";
  setStep(false);
  setMsg("", "");
}
function mostrarDados(token, familia, adultos) {
  conviteAtual = { token, familia, adultos };
  passoCodigo.hidden = true;
  passoDados.hidden = false;
  const lugares = adultos > 1 ? adultos + " lugares reservados" : "1 lugar reservado";
  blocoFamilia.textContent = (familia ? "Convite de " + familia : "Convite válido") + " · " + lugares;
  setStep(true);
  if (!document.getElementById("page-confirmar").hidden) inputNome.focus();
}
function apiError(res, data, fallback) {
  // Mensagens de infraestrutura não pertencem ao convite dos convidados.
  return res.status >= 500 || res.status === 403
    ? "Não conseguimos acessar seu convite agora. Tente novamente em instantes ou fale com os noivos."
    : data.error || fallback;
}
async function validarCodigo() {
  if (btnValidar.disabled) return;
  const codigo = inputCodigo.value.trim();
  setMsg("", "");
  if (!codigo) {
    setMsg("erro", "Por favor, digite o código do convite.", inputCodigo);
    return;
  }
  btnValidar.disabled = true;
  inputCodigo.readOnly = true;
  btnValidar.textContent = "Encontrando seu convite…";
  form.setAttribute("aria-busy", "true");
  try {
    const res = await fetch("/api/validate-token?token=" + encodeURIComponent(codigo));
    const data = await res.json();
    if (!res.ok) {
      setMsg("erro", apiError(res, data, "Não foi possível validar o convite."), inputCodigo);
      return;
    }
    mostrarDados(codigo, data.familia, data.adultos);
  } catch {
    setMsg("erro", "Sem conexão com o servidor. Tente novamente.");
  } finally {
    btnValidar.disabled = false;
    inputCodigo.readOnly = false;
    btnValidar.innerHTML = validateLabel;
    form.removeAttribute("aria-busy");
  }
}
btnValidar.addEventListener("click", validarCodigo);
inputCodigo.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); validarCodigo(); }
});
btnTrocar.addEventListener("click", () => {
  if (btnConfirmar.disabled) return;
  conviteAtual = null;
  passoDados.hidden = true;
  passoCodigo.hidden = false;
  setStep(false);
  setMsg("", "");
  inputCodigo.focus();
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (btnConfirmar.disabled || btnValidar.disabled) return;
  if (!conviteAtual) { validarCodigo(); return; }
  const nome = inputNome.value.trim();
  const digits = inputTelefone.value.replace(/\D/g, "");
  const criancas = inputCriancas.value === "" ? 0 : Number(inputCriancas.value);
  setMsg("", "");
  if (!nome) { setMsg("erro", "Digite o nome de quem confirma.", inputNome); return; }
  if (digits.length < 10 || digits.length > 11) { setMsg("erro", "Digite um celular válido com DDD.", inputTelefone); return; }
  if (!Number.isInteger(criancas) || criancas < 0 || criancas > 10) { setMsg("erro", "Informe uma quantidade de crianças entre 0 e 10.", inputCriancas); return; }
  btnConfirmar.disabled = true;
  btnTrocar.disabled = true;
  btnConfirmar.textContent = "Confirmando…";
  form.setAttribute("aria-busy", "true");
  try {
    const res = await fetch("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: conviteAtual.token, name: nome, phone: digits, criancas }),
    });
    const data = await res.json();
    if (!res.ok) { setMsg("erro", apiError(res, data, "Não foi possível confirmar a presença.")); return; }
    const familia = data.familia || conviteAtual.familia || nome;
    const adultos = data.adultos || conviteAtual.adultos || 1;
    document.getElementById("sucesso-nome").textContent = "Presença confirmada, " + familia + "!";
    document.getElementById("sucesso-detalhe").textContent = adultos > 1
      ? adultos + " lugares reservados. Mal podemos esperar para celebrar com vocês!"
      : "Seu lugar está reservado. Mal podemos esperar para celebrar com você!";
    form.hidden = true;
    btnVoltarConfirmar.hidden = true;
    blocoSucesso.hidden = false;
    if (!document.getElementById("page-confirmar").hidden) blocoSucesso.focus();
  } catch {
    setMsg("erro", "Sem conexão com o servidor. Tente novamente.");
  } finally {
    btnConfirmar.disabled = false;
    btnTrocar.disabled = false;
    btnConfirmar.textContent = "Confirmar presença";
    form.removeAttribute("aria-busy");
  }
});
blocoSucesso.querySelector("[data-goto]").addEventListener("click", resetRsvp);
inputCodigo.addEventListener("input", () => { inputCodigo.value = inputCodigo.value.toUpperCase(); });
inputTelefone.addEventListener("input", () => {
  const d = inputTelefone.value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) inputTelefone.value = d;
  else if (d.length <= 6) inputTelefone.value = "(" + d.slice(0, 2) + ") " + d.slice(2);
  else if (d.length <= 10) inputTelefone.value = "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
  else inputTelefone.value = "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
});

