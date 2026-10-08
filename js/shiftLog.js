import {
  loadShiftLogs,
  saveShiftLog,
  deleteShiftLog,
  onShiftLogsChanged,
  loadPreparations,
  onDepartmentsChanged,
} from "./storage.js";
import {
  createDepartmentPicker,
  departmentBadge,
  canChangeVisibility,
  matchesDepartment,
  fillDepartmentFilter,
} from "./departmentPicker.js";
import { typLabel } from "./preparations.js";
import { can, getCurrentUser, getCurrentProfile } from "./auth.js";
import { escapeHtml } from "./utils.js";
import { formatDate, onLanguageChanged, t } from "./i18n.js";

// Schichtübergabe / Barbuch: was ist leer, was muss angesetzt werden, was ist
// offen geblieben. Statt Zettel steht das hier mit Autor und Zeitstempel.
//
// Der Kern ist die Übernahme: offene Punkte der letzten Schicht und Ansätze,
// die bald ablaufen, werden beim Anlegen einer neuen Übergabe vorgeschlagen.
// Vorgeschlagen heißt vorgeschlagen – abwählbar, und gespeichert wird erst
// auf Knopfdruck.

const SHIFT_LABEL_KEYS = {
  frueh: "ui.fruehschicht",
  spaet: "ui.spaetschicht",
  nacht: "ui.nachtschicht",
};

// Erst beim Rendern übersetzt, damit ein Sprachwechsel ohne Neuladen wirkt.
export function shiftLabel(shift) {
  return SHIFT_LABEL_KEYS[shift] ? t(SHIFT_LABEL_KEYS[shift]) : shift;
}

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
  const zeit = iso ? new Date(iso).getTime() : 0;
  return Number.isFinite(zeit) ? zeit : 0;
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
  const art = typLabel(prep.prepType);
  const frist =
    tage < 0
      ? t(tage === -1 ? "ui.seit_einem_tag_abgelaufen" : "ui.seit_tagen_abgelaufen", { tage: Math.abs(tage) })
      : tage === 0
        ? t("ui.laeuft_heute_ab")
        : t(tage === 1 ? "ui.laeuft_in_einem_tag_ab" : "ui.laeuft_in_tagen_ab", { tage });
  return `${prep.label} (${art}) – ${frist}`;
}

// Alles, was beim Anlegen einer neuen Übergabe zur Auswahl steht.
export function vorschlaege(logs, preparations, jetzt = new Date()) {
  const ausSchicht = offeneAusLetzterSchicht(logs).map((p) => ({
    text: p.text,
    herkunft: t("ui.letzte_schicht"),
  }));
  const ausAnsaetzen = ablaufendeAnsaetze(preparations, jetzt).map((e) => ({
    text: ansatzText(e),
    herkunft: t("ui.mise_en_place"),
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
const deptEl = document.getElementById("shift-log-departments");
const deptFilterEl = document.getElementById("shift-log-dept-filter");
const deptFilterWrapEl = document.getElementById("shift-log-dept-filter-wrap");

// Abteilungsauswahl im Formular „Neue Übergabe".
let deptPicker = null;

function renderDeptPicker(value = null) {
  deptPicker = createDepartmentPicker({ moduleKey: "shift-log", value });
  deptEl.replaceChildren(deptPicker.element);
}

// Übergaben haben kein Bearbeiten-Formular; die Freigabe ändert die
// Eigentümer-Abteilung direkt am Eintrag. Offen ist höchstens einer.
let freigabeId = null;
let freigabePicker = null;

function heuteInput(jetzt = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${jetzt.getFullYear()}-${p(jetzt.getMonth() + 1)}-${p(jetzt.getDate())}`;
}

function formatDatum(iso) {
  if (!iso) return t("ui.ohne_datum");
  return formatDate(iso);
}

function formatZeitpunkt(iso) {
  if (!iso) return "";
  return formatDate(iso, {
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
    <input type="text" class="shift-item-text" placeholder="${t("ui.z_b_tonic_nachschub_bestellen")}" />
    <button type="button" class="remove-btn" aria-label="${t("ui.punkt_entfernen")}">×</button>`;
  row.querySelector(".shift-item-text").value = text;
  itemsEl.appendChild(row);
}

function gewaehltePunkte() {
  const ausVorschlag = [...suggestEl.querySelectorAll(".shift-suggest")]
    .filter((cb) => cb.checked)
    .map((cb) => cb.value);
  const eigene = [...itemsEl.querySelectorAll(".shift-item-text")].map((el) => el.value.trim()).filter(Boolean);
  const gesehen = new Set();
  return [...ausVorschlag, ...eigene].filter((text) => {
    if (gesehen.has(text)) return false;
    gesehen.add(text);
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
  renderDeptPicker();
  dateEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function schliesseFormular() {
  formEl.hidden = true;
  newBtn.hidden = false;
  formEl.reset();
  itemsEl.innerHTML = "";
  suggestEl.innerHTML = "";
  deptEl.replaceChildren();
  deptPicker = null;
}

async function handleSubmit(e) {
  e.preventDefault();
  const punkte = gewaehltePunkte();
  const zusammenfassung = summaryEl.value.trim();
  if (!zusammenfassung && punkte.length === 0) {
    alert(t("ui.bitte_eine_notiz_schreiben_oder_mindestens_dd28"));
    return;
  }
  const log = {
    shiftDate: dateEl.value || heuteInput(),
    shift: shiftEl.value,
    summary: zusammenfassung,
    openItems: punkte.map((text) => ({ text, done: false, doneBy: null, doneAt: null })),
  };
  if (deptPicker) log.visibleTo = deptPicker.getValue();
  const nutzer = getCurrentUser();
  if (nutzer) log.createdBy = nutzer.id;
  try {
    await saveShiftLog(log);
    schliesseFormular();
  } catch (err) {
    alert(t("ui.speichern_fehlgeschlagen") + err.message);
  }
}

// ── Liste ─────────────────────────────────────────────────────────────

function punktHtml(log, index, punkt) {
  const erledigt = Boolean(punkt.done);
  const nachweis = erledigt
    ? `${t("ui.erledigt_von")} ${punkt.doneBy || t("ui.unbekannt_klein")}${
        punkt.doneAt ? ` ${t("ui.um")} ${formatZeitpunkt(punkt.doneAt)}` : ""
      }`
    : t("ui.offen_klein");
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
  const kopf = `${formatDatum(log.shiftDate)} · ${escapeHtml(shiftLabel(log.shift))}`;
  const status = offen > 0 ? `${offen} ${t("ui.offen_klein")}` : t("ui.alles_erledigt");
  const punkte = (log.openItems ?? []).map((p, i) => punktHtml(log, i, p)).join("");
  const aktionen = [
    canChangeVisibility(log)
      ? `<button type="button" class="btn-secondary shift-log-visibility">${t("ui.freigabe_aendern")}</button>`
      : "",
    can("shiftlog.manage")
      ? `<button type="button" class="btn-secondary shift-log-delete">${t("ui.loeschen")}</button>`
      : "",
  ].join("");

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
          : `<p class="prep-meta">${t("ui.keine_offenen_punkte_notiert")}</p>`
      }
      <p class="prep-meta">${t("ui.angelegt")} ${escapeHtml(formatZeitpunkt(log.createdAt)) || "–"}</p>
      ${departmentBadge(log).outerHTML}
      <div class="dept-edit" hidden></div>
      ${aktionen ? `<div class="actions no-print">${aktionen}</div>` : ""}
    </div>`;
}

function renderList() {
  const filter = deptFilterEl.value;
  const logs = sichtbareLogs(loadShiftLogs()).filter((log) => matchesDepartment(log, filter));
  listEl.innerHTML = logs.length
    ? logs.map(logHtml).join("")
    : `<p class="empty-state">${t("ui.noch_keine_uebergabe_geschrieben")}</p>`;
  renderFreigabe();
}

// Hängt die offene Freigabe-Auswahl wieder an ihren Eintrag (nach jedem
// Neu-Rendern der Liste), mit der bis dahin getroffenen Auswahl.
function renderFreigabe() {
  if (!freigabeId) return;
  const log = loadShiftLogs().find((l) => l.id === freigabeId);
  const karte = [...listEl.querySelectorAll(".prep-item")].find((el) => el.dataset.id === freigabeId);
  if (!log || !karte || !canChangeVisibility(log)) {
    freigabeId = null;
    freigabePicker = null;
    return;
  }
  const value = { ...log, visibleTo: freigabePicker ? freigabePicker.getValue() : log.visibleTo };
  freigabePicker = createDepartmentPicker({ moduleKey: "shift-log", value });
  const speichern = document.createElement("button");
  speichern.type = "button";
  speichern.className = "btn-primary shift-log-visibility-save";
  speichern.textContent = t("ui.speichern");
  const abbrechen = document.createElement("button");
  abbrechen.type = "button";
  abbrechen.className = "btn-secondary shift-log-visibility-cancel";
  abbrechen.textContent = t("ui.abbrechen");
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(speichern, abbrechen);
  const box = karte.querySelector(".dept-edit");
  box.replaceChildren(freigabePicker.element, actions);
  box.hidden = false;
  const knopf = karte.querySelector(".shift-log-visibility");
  if (knopf) knopf.hidden = true;
}

function schliesseFreigabe() {
  freigabeId = null;
  freigabePicker = null;
  renderList();
}

async function speichereFreigabe() {
  const log = loadShiftLogs().find((l) => l.id === freigabeId);
  if (!log || !freigabePicker) return schliesseFreigabe();
  const visibleTo = freigabePicker.getValue();
  try {
    await saveShiftLog({ ...log, visibleTo });
    schliesseFreigabe();
  } catch (err) {
    alert(t("ui.speichern_fehlgeschlagen") + err.message);
  }
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
    alert(t("ui.speichern_fehlgeschlagen") + err.message);
    renderList();
  }
}

export function initShiftLog() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    fillDepartmentFilter(deptFilterEl, deptFilterWrapEl);
    renderList();
    if (!formEl.hidden) {
      renderVorschlaege();
      renderDeptPicker(deptPicker ? { visibleTo: deptPicker.getValue() } : null);
    }
  });

  fillDepartmentFilter(deptFilterEl, deptFilterWrapEl);
  schliesseFormular();
  renderList();
  onShiftLogsChanged(renderList);
  onDepartmentsChanged(() => {
    fillDepartmentFilter(deptFilterEl, deptFilterWrapEl);
    renderList();
    if (!formEl.hidden) renderDeptPicker(deptPicker ? { visibleTo: deptPicker.getValue() } : null);
  });
  deptFilterEl.addEventListener("change", renderList);

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
    if (e.target.closest(".shift-log-visibility")) {
      freigabeId = e.target.closest(".prep-item")?.dataset.id ?? null;
      freigabePicker = null;
      renderFreigabe();
      return;
    }
    if (e.target.closest(".shift-log-visibility-save")) return speichereFreigabe();
    if (e.target.closest(".shift-log-visibility-cancel")) return schliesseFreigabe();
    if (!e.target.closest(".shift-log-delete")) return;
    const karte = e.target.closest(".prep-item");
    const log = loadShiftLogs().find((l) => l.id === karte?.dataset.id);
    if (!log) return;
    if (!confirm(`${t("ui.uebergabe_vom")} ${formatDatum(log.shiftDate)} ${t("ui.wirklich_loeschen")}`)) return;
    try {
      await deleteShiftLog(log.id);
    } catch (err) {
      alert(t("ui.loeschen_fehlgeschlagen") + err.message);
    }
  });
}
