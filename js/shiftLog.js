import { loadShiftLogs, saveShiftLog, deleteShiftLog, onShiftLogsChanged, loadPreparations } from "./storage.js";
import { TYP_LABELS } from "./preparations.js";
import { isAdmin, getCurrentUser, getCurrentProfile } from "./auth.js";
import { escapeHtml } from "./utils.js";

// Schichtübergabe / Barbuch: was ist leer, was muss angesetzt werden, was ist
// offen geblieben. Statt Zettel steht das hier mit Autor und Zeitstempel.
//
// Der Kern ist die Übernahme: offene Punkte der letzten Schicht und Ansätze,
// die bald ablaufen, werden beim Anlegen einer neuen Übergabe vorgeschlagen.
// Vorgeschlagen heißt vorgeschlagen – abwählbar, und gespeichert wird erst
// auf Knopfdruck.

export const SHIFT_LABELS = {
  frueh: "Frühschicht",
  spaet: "Spätschicht",
  nacht: "Nachtschicht",
};

// Wie weit die Liste zurückreicht.
const SICHTBARE_TAGE = 14;

// Ansätze, die innerhalb dieser Frist ablaufen, kommen als Vorschlag mit.
const ANSATZ_VORWARNUNG_TAGE = 2;

// ---------------------------------------------------------------------
// Logik – bewusst ohne DOM-Zugriff, damit sie für sich prüfbar bleibt
// ---------------------------------------------------------------------

function tagesbeginn(datum) {
  const d = new Date(datum);
  d.setHours(0, 0, 0, 0);
  return d;
}

function tageBis(datumIso, jetzt = new Date()) {
  if (!datumIso) return null;
  const diff = tagesbeginn(datumIso) - tagesbeginn(jetzt);
  return Math.round(diff / 86400000);
}

// Neueste zuerst: erst nach Schichtdatum, bei gleichem Datum nach dem
// Zeitpunkt des Anlegens. Damit steht die zuletzt geschriebene Übergabe oben.
function zeitwert(iso) {
  const t = iso ? new Date(iso).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

export function sortiereLogs(logs) {
  return [...logs].sort(
    (a, b) =>
      zeitwert(b.shiftDate) - zeitwert(a.shiftDate) || zeitwert(b.createdAt) - zeitwert(a.createdAt)
  );
}

export function offenePunkte(log) {
  return (log?.openItems ?? []).filter((p) => !p.done);
}

// Die jüngste Übergabe – die, von der die nächste Schicht übernimmt.
export function letzteUebergabe(logs) {
  return sortiereLogs(logs)[0] ?? null;
}

export function offeneAusLetzterSchicht(logs) {
  return offenePunkte(letzteUebergabe(logs));
}

// Ansätze, die schon abgelaufen sind oder es in den nächsten zwei Tagen sind.
// Verbrauchtes und Ansätze ohne Datum bleiben draußen – für die gibt es
// nichts zu übergeben.
export function ablaufendeAnsaetze(preparations, jetzt = new Date()) {
  return preparations
    .filter((p) => p.status !== "verbraucht" && p.expiresAt)
    .map((p) => ({ prep: p, tage: tageBis(p.expiresAt, jetzt) }))
    .filter((e) => e.tage !== null && e.tage <= ANSATZ_VORWARNUNG_TAGE)
    .sort((a, b) => a.tage - b.tage);
}

function ansatzText({ prep, tage }) {
  const art = TYP_LABELS[prep.prepType] ?? prep.prepType;
  const frist =
    tage < 0
      ? `seit ${Math.abs(tage)} Tag(en) abgelaufen`
      : tage === 0
        ? "läuft heute ab"
        : `läuft in ${tage} Tag(en) ab`;
  return `${prep.label} (${art}) – ${frist}`;
}

// Alles, was beim Anlegen einer neuen Übergabe zur Auswahl steht.
export function vorschlaege(logs, preparations, jetzt = new Date()) {
  const ausSchicht = offeneAusLetzterSchicht(logs).map((p) => ({
    text: p.text,
    herkunft: "letzte Schicht",
  }));
  const ausAnsaetzen = ablaufendeAnsaetze(preparations, jetzt).map((e) => ({
    text: ansatzText(e),
    herkunft: "Mise en Place",
  }));
  // Doppelte Texte (ein Ansatz, der schon letzte Schicht notiert wurde)
  // nur einmal anbieten.
  const gesehen = new Set();
  return [...ausSchicht, ...ausAnsaetzen].filter((v) => {
    if (gesehen.has(v.text)) return false;
    gesehen.add(v.text);
    return true;
  });
}

// Vorbelegung der Schicht nach Uhrzeit – nur ein Startwert, im Formular
// jederzeit änderbar.
export function schichtNachUhrzeit(jetzt = new Date()) {
  const stunde = jetzt.getHours();
  if (stunde < 11) return "frueh";
  if (stunde < 20) return "spaet";
  return "nacht";
}

// Sichtbar sind die letzten 14 Tage. Ältere Übergaben mit noch offenen
// Punkten bleiben trotzdem stehen – sonst verschwände etwas Unerledigtes
// still aus der Ansicht.
export function sichtbareLogs(logs, jetzt = new Date()) {
  const grenze = tagesbeginn(jetzt).getTime() - SICHTBARE_TAGE * 86400000;
  return sortiereLogs(logs).filter(
    (log) =>
      (log.shiftDate && tagesbeginn(log.shiftDate).getTime() >= grenze) || offenePunkte(log).length > 0
  );
}

// ---------------------------------------------------------------------
// Oberfläche
// ---------------------------------------------------------------------

const newBtn = document.getElementById("shift-log-new");
const formEl = document.getElementById("shift-log-form");
const dateEl = document.getElementById("shift-log-date");
const shiftEl = document.getElementById("shift-log-shift");
const summaryEl = document.getElementById("shift-log-summary");
const suggestEl = document.getElementById("shift-log-suggestions");
const suggestWrapEl = document.getElementById("shift-log-suggestions-wrap");
const itemsEl = document.getElementById("shift-log-items");
const addItemBtn = document.getElementById("shift-log-add-item");
const cancelBtn = document.getElementById("shift-log-cancel");
const listEl = document.getElementById("shift-log-list");

function heuteInput(jetzt = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${jetzt.getFullYear()}-${p(jetzt.getMonth() + 1)}-${p(jetzt.getDate())}`;
}

function formatDatum(iso) {
  if (!iso) return "ohne Datum";
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatZeitpunkt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eigenerName() {
  const profil = getCurrentProfile();
  const nutzer = getCurrentUser();
  return profil?.display_name || profil?.username || nutzer?.email?.split("@")[0] || "unbekannt";
}

// ── Formular ──────────────────────────────────────────────────────────

function renderVorschlaege() {
  const liste = vorschlaege(loadShiftLogs(), loadPreparations());
  suggestWrapEl.hidden = liste.length === 0;
  suggestEl.innerHTML = liste
    .map(
      (v) => `
      <label class="menu-pick">
        <input type="checkbox" class="shift-suggest" value="${escapeHtml(v.text)}" checked />
        <span>${escapeHtml(v.text)}</span>
        <span class="menu-pick-price">${escapeHtml(v.herkunft)}</span>
      </label>`
    )
    .join("");
}

function addItemRow(text = "") {
  const row = document.createElement("div");
  row.className = "menu-pick shift-item-row";
  row.innerHTML = `
    <input type="text" class="shift-item-text" placeholder="z. B. Tonic-Nachschub bestellen" />
    <button type="button" class="remove-btn" aria-label="Punkt entfernen">×</button>`;
  row.querySelector(".shift-item-text").value = text;
  itemsEl.appendChild(row);
}

function gewaehltePunkte() {
  const ausVorschlag = [...suggestEl.querySelectorAll(".shift-suggest")]
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
  const eigene = [...itemsEl.querySelectorAll(".shift-item-text")].map((el) => el.value.trim()).filter(Boolean);
  const gesehen = new Set();
  return [...ausVorschlag, ...eigene].filter((t) => {
    if (gesehen.has(t)) return false;
    gesehen.add(t);
    return true;
  });
}

function oeffneFormular() {
  formEl.hidden = false;
  newBtn.hidden = true;
  formEl.reset();
  dateEl.value = heuteInput();
  shiftEl.value = schichtNachUhrzeit();
  itemsEl.innerHTML = "";
  addItemRow();
  renderVorschlaege();
  dateEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function schliesseFormular() {
  formEl.hidden = true;
  newBtn.hidden = false;
  formEl.reset();
  itemsEl.innerHTML = "";
  suggestEl.innerHTML = "";
}

async function handleSubmit(e) {
  e.preventDefault();
  const punkte = gewaehltePunkte();
  const zusammenfassung = summaryEl.value.trim();
  if (!zusammenfassung && punkte.length === 0) {
    alert("Bitte eine Notiz schreiben oder mindestens einen offenen Punkt eintragen.");
    return;
  }
  const log = {
    shiftDate: dateEl.value || heuteInput(),
    shift: shiftEl.value,
    summary: zusammenfassung,
    openItems: punkte.map((text) => ({ text, done: false, doneBy: null, doneAt: null })),
  };
  const nutzer = getCurrentUser();
  if (nutzer) log.createdBy = nutzer.id;
  try {
    await saveShiftLog(log);
    schliesseFormular();
  } catch (err) {
    alert("Speichern fehlgeschlagen: " + err.message);
  }
}

// ── Liste ─────────────────────────────────────────────────────────────

function punktHtml(log, index, punkt) {
  const erledigt = Boolean(punkt.done);
  const nachweis = erledigt
    ? `erledigt von ${punkt.doneBy || "unbekannt"}${punkt.doneAt ? ` um ${formatZeitpunkt(punkt.doneAt)}` : ""}`
    : "offen";
  return `
    <label class="menu-pick">
      <input type="checkbox" class="shift-item-done" data-id="${escapeHtml(log.id)}" data-index="${index}" ${
        erledigt ? "checked" : ""
      } />
      <span${erledigt ? ' style="text-decoration: line-through; color: var(--text-muted)"' : ""}>${escapeHtml(
        punkt.text
      )}</span>
      <span class="menu-pick-price">${escapeHtml(nachweis)}</span>
    </label>`;
}

function logHtml(log) {
  const offen = offenePunkte(log).length;
  const kopf = `${formatDatum(log.shiftDate)} · ${escapeHtml(SHIFT_LABELS[log.shift] ?? log.shift)}`;
  const status = offen > 0 ? `${offen} offen` : "alles erledigt";
  const punkte = (log.openItems ?? []).map((p, i) => punktHtml(log, i, p)).join("");

  return `
    <div class="prep-item${offen > 0 ? " prep-expired" : ""}" data-id="${escapeHtml(log.id)}">
      <div class="prep-item-head">
        <strong>${kopf}</strong>
        <span class="prep-status">${escapeHtml(status)}</span>
      </div>
      ${log.summary ? `<p class="prep-meta">${escapeHtml(log.summary)}</p>` : ""}
      ${
        punkte
          ? `<div class="menu-pick-list">${punkte}</div>`
          : '<p class="prep-meta">Keine offenen Punkte notiert.</p>'
      }
      <p class="prep-meta">Angelegt ${escapeHtml(formatZeitpunkt(log.createdAt)) || "–"}</p>
      ${
        isAdmin()
          ? '<div class="actions no-print"><button type="button" class="btn-secondary shift-log-delete">Löschen</button></div>'
          : ""
      }
    </div>`;
}

function renderList() {
  const logs = sichtbareLogs(loadShiftLogs());
  listEl.innerHTML = logs.length
    ? logs.map(logHtml).join("")
    : '<p class="empty-note">Noch keine Übergabe geschrieben.</p>';
}

// Abhaken schreibt Name und Zeitpunkt mit – ohne die anderen Punkte
// anzufassen, damit parallele Schichten sich nicht gegenseitig überschreiben.
async function setzePunktStatus(logId, index, done) {
  const log = loadShiftLogs().find((l) => l.id === logId);
  if (!log) return;
  const punkte = (log.openItems ?? []).map((p, i) =>
    i === index
      ? done
        ? { ...p, done: true, doneBy: eigenerName(), doneAt: new Date().toISOString() }
        : { ...p, done: false, doneBy: null, doneAt: null }
      : p
  );
  try {
    await saveShiftLog({ ...log, openItems: punkte });
  } catch (err) {
    alert("Speichern fehlgeschlagen: " + err.message);
    renderList();
  }
}

export function initShiftLog() {
  schliesseFormular();
  renderList();
  onShiftLogsChanged(renderList);

  newBtn.addEventListener("click", oeffneFormular);
  cancelBtn.addEventListener("click", schliesseFormular);
  formEl.addEventListener("submit", handleSubmit);
  addItemBtn.addEventListener("click", () => addItemRow());

  itemsEl.addEventListener("click", (e) => {
    if (!e.target.closest(".remove-btn")) return;
    const zeilen = itemsEl.querySelectorAll(".shift-item-row");
    if (zeilen.length > 1) e.target.closest(".shift-item-row").remove();
    else zeilen[0].querySelector(".shift-item-text").value = "";
  });

  listEl.addEventListener("change", (e) => {
    const box = e.target.closest(".shift-item-done");
    if (!box) return;
    setzePunktStatus(box.dataset.id, Number(box.dataset.index), box.checked);
  });

  listEl.addEventListener("click", async (e) => {
    if (!e.target.closest(".shift-log-delete")) return;
    const karte = e.target.closest(".prep-item");
    const log = loadShiftLogs().find((l) => l.id === karte?.dataset.id);
    if (!log) return;
    if (!confirm(`Übergabe vom ${formatDatum(log.shiftDate)} wirklich löschen?`)) return;
    try {
      await deleteShiftLog(log.id);
    } catch (err) {
      alert("Löschen fehlgeschlagen: " + err.message);
    }
  });
}
