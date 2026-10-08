import { getSupabaseClient } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";
import { formatDateTime, onLanguageChanged, t } from "./i18n.js";

// Feedback (Paket 64): allgemeines Feedback aus dem Konto-Menü und Änderungs-
// vorschläge zu Wissensartikeln. Eintragen darf jedes angemeldete Konto, lesen
// und bearbeiten nur feedback.review (RLS, Tabelle "feedback").

const MAX_LENGTH = 2000;

const overlayEl = document.getElementById("feedback-modal-overlay");
const formEl = document.getElementById("feedback-modal-form");
const headingEl = document.getElementById("feedback-modal-heading");
const refEl = document.getElementById("feedback-modal-ref");
const messageEl = document.getElementById("feedback-modal-message");
const counterEl = document.getElementById("feedback-modal-counter");
const errorEl = document.getElementById("feedback-modal-error");
const submitEl = document.getElementById("feedback-modal-submit");
const toastEl = document.getElementById("feedback-toast");

let context = { kind: "general", refId: null, refTitle: null };
let returnFocusEl = null;
let toastTimer = null;

function showToast(text) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 4000);
}

function updateCounter() {
  counterEl.textContent = `${messageEl.value.length} / ${MAX_LENGTH}`;
}

function showError(text) {
  errorEl.textContent = text;
  errorEl.hidden = !text;
}

function closeModal() {
  overlayEl.hidden = true;
  returnFocusEl?.focus?.();
  returnFocusEl = null;
}

// kind "knowledge" braucht refId + refTitle des Artikels.
export function openFeedback({ kind = "general", refId = null, refTitle = null } = {}) {
  context = { kind, refId, refTitle };
  returnFocusEl = document.activeElement;
  const isKnowledge = kind === "knowledge";
  headingEl.textContent = t(isKnowledge ? "ui.feedback_aenderung_vorschlagen" : "ui.feedback_geben");
  messageEl.placeholder = t(isKnowledge ? "ui.feedback_placeholder_wissen" : "ui.feedback_placeholder_allgemein");
  refEl.textContent = isKnowledge ? `${t("ui.feedback_artikel")}: ${refTitle ?? ""}` : "";
  refEl.hidden = !isKnowledge;
  messageEl.value = "";
  updateCounter();
  showError("");
  submitEl.disabled = false;
  overlayEl.hidden = false;
  messageEl.focus();
}

async function submit(event) {
  event.preventDefault();
  const message = messageEl.value.trim();
  if (message.length < 3) {
    showError(t("ui.feedback_zu_kurz"));
    return;
  }
  const user = getCurrentUser();
  if (!user) return;
  submitEl.disabled = true;
  const { error } = await getSupabaseClient()
    .from("feedback")
    .insert({
      kind: context.kind,
      ref_id: context.refId,
      ref_title: context.refTitle,
      message,
      created_by: user.id,
    });
  if (error) {
    showError(t("ui.feedback_fehler") + error.message);
    submitEl.disabled = false;
    return;
  }
  closeModal();
  showToast(t("ui.feedback_danke"));
}

export function initFeedback() {
  if (!overlayEl || !formEl) return;
  messageEl.maxLength = MAX_LENGTH;
  messageEl.addEventListener("input", updateCounter);
  formEl.addEventListener("submit", submit);
  document.getElementById("feedback-modal-cancel").addEventListener("click", closeModal);
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlayEl.hidden) closeModal();
  });
  document.getElementById("feedback-nav-btn")?.addEventListener("click", () => openFeedback());
}

// ---------------------------------------------------------------------
// Admin-Ansicht (Sub-Tab "Feedback", Recht feedback.review)
// ---------------------------------------------------------------------

const listEl = document.getElementById("feedback-list");
const filterEl = document.getElementById("feedback-filter");

const STATUS_LABEL_KEYS = { open: "ui.feedback_status_offen", done: "ui.feedback_status_erledigt", rejected: "ui.abgelehnt" };
const KIND_LABEL_KEYS = { general: "ui.feedback_art_allgemein", knowledge: "ui.feedback_art_wissen" };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function actionButton(className, text, handler) {
  const button = el("button", className, text);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

async function updateEntry(entry, fields) {
  const { error } = await getSupabaseClient()
    .from("feedback")
    .update({ ...fields, handled_by: getCurrentUser().id, handled_at: new Date().toISOString() })
    .eq("id", entry.id);
  if (error) {
    alert(t("ui.feedback_fehler") + error.message);
    return;
  }
  await loadAdmin();
}

async function setStatus(entry, status) {
  let comment = entry.admin_comment ?? null;
  if (status === "rejected") {
    const answer = prompt(t("ui.kommentar_zur_ablehnung_optional"), "");
    if (answer === null) return;
    comment = answer || null;
  }
  await updateEntry(entry, { status, admin_comment: comment });
}

async function removeEntry(entry) {
  if (!confirm(t("ui.feedback_loeschen_bestaetigen"))) return;
  const { error } = await getSupabaseClient().from("feedback").delete().eq("id", entry.id);
  if (error) {
    alert(t("ui.feedback_fehler") + error.message);
    return;
  }
  await loadAdmin();
}

async function openArticle(entry) {
  const { focusKnowledge } = await import("./knowledge.js");
  focusKnowledge(entry.ref_id);
}

function renderAdmin(entries) {
  listEl.textContent = "";
  if (entries.length === 0) {
    listEl.appendChild(el("p", "empty-note", t("ui.feedback_leer")));
    return;
  }
  entries.forEach((entry) => {
    const who = entry.author?.display_name || entry.author?.username || t("ui.feedback_unbekannt");
    const kind = KIND_LABEL_KEYS[entry.kind] ? t(KIND_LABEL_KEYS[entry.kind]) : entry.kind;
    const status = STATUS_LABEL_KEYS[entry.status] ? t(STATUS_LABEL_KEYS[entry.status]) : entry.status;
    const title = entry.kind === "knowledge" && entry.ref_title ? ` · ${entry.ref_title}` : "";

    const item = el("details", "audit-entry");
    if (entry.status === "open") item.open = true;
    item.appendChild(el("summary", null, `${formatDateTime(entry.created_at)} · ${kind}${title} · ${who} · ${status}`));

    const body = el("div", "recipe-item-body");
    const message = el("p", null, entry.message);
    message.style.whiteSpace = "pre-wrap";
    body.appendChild(message);
    if (entry.admin_comment) body.appendChild(el("p", "hint", `${t("ui.feedback_kommentar")}: ${entry.admin_comment}`));
    item.appendChild(body);

    const actions = el("div", "actions");
    if (entry.kind === "knowledge" && entry.ref_id) {
      actions.appendChild(actionButton("btn-secondary", t("ui.feedback_artikel_oeffnen"), () => openArticle(entry)));
    }
    if (entry.status === "open") {
      actions.appendChild(actionButton("btn-primary", t("ui.feedback_erledigt"), () => setStatus(entry, "done")));
      actions.appendChild(actionButton("btn-secondary", t("ui.ablehnen"), () => setStatus(entry, "rejected")));
    } else {
      actions.appendChild(actionButton("btn-secondary", t("ui.feedback_wieder_oeffnen"), () => setStatus(entry, "open")));
    }
    actions.appendChild(actionButton("btn-secondary", t("ui.loeschen"), () => removeEntry(entry)));
    item.appendChild(actions);
    listEl.appendChild(item);
  });
}

async function loadAdmin() {
  let query = getSupabaseClient()
    .from("feedback")
    .select("*, author:profiles!feedback_created_by_fkey(username, display_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filterEl.value !== "all") query = query.eq("status", filterEl.value);
  const { data, error } = await query;
  if (error) {
    listEl.textContent = "";
    listEl.appendChild(el("p", "empty-note", `${t("ui.feedback_laden_fehler")} ${error.message}`));
    return;
  }
  renderAdmin(data ?? []);
}

export function initFeedbackAdmin() {
  if (!listEl || !filterEl) return;
  filterEl.addEventListener("change", loadAdmin);
  onLanguageChanged(loadAdmin);
  loadAdmin();
}
