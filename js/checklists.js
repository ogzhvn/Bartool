import {
  loadChecklistTemplates,
  saveChecklistTemplate,
  deleteChecklistTemplate,
  onChecklistTemplatesChanged,
  loadChecklistRuns,
  saveChecklistRun,
  deleteChecklistRun,
  onChecklistRunsChanged,
} from "./storage.js";
import { isAdmin, getCurrentUser, getCurrentProfile } from "./auth.js";
import { escapeHtml, formatNumberLocal } from "./utils.js";
import { printChecklistRuns } from "./printView.js";
import {
  formatDate,
  germanOnlyNote,
  getLocale,
  localizedContent,
  localizedText,
  onLanguageChanged,
  t,
} from "./i18n.js";

// Checklisten für wiederkehrende Abläufe: Opening, Closing, Reinigung,
// Kühltemperaturen. Eine Vorlage sagt, was zu prüfen ist; ein Lauf ist der
// ausgefüllte Nachweis eines Tages.
//
// Der Punkt an der Sache ist die Nachweisdokumentation: jeder Haken und
// jeder Messwert speichert Name und Uhrzeit. Ein Messwert außerhalb der
// in der Vorlage hinterlegten Grenzen wird rot und verlangt eine Notiz,
// bevor der Lauf abgeschlossen werden kann.
//
// Grenzwerte legt ausschließlich der Nutzer in der Vorlage fest – hier
// steht bewusst keine einzige vorgegebene Temperatur.

const KIND_LABEL_KEYS = {
  opening: "ui.opening",
  closing: "ui.closing",
  reinigung: "ui.reinigung",
  temperatur: "ui.temperatur",
  sonstiges: "ui.sonstiges",
};

// Erst beim Rendern übersetzt, damit ein Sprachwechsel ohne Neuladen wirkt.
export function kindLabel(kind) {
  return KIND_LABEL_KEYS[kind] ? t(KIND_LABEL_KEYS[kind]) : kind;
}

// Wie viele Läufe der Verlauf zeigt (und druckt).
const VERLAUF_LAEUFE = 30;

// ---------------------------------------------------------------------
// Logik – bewusst ohne DOM-Zugriff, damit sie für sich prüfbar bleibt
// ---------------------------------------------------------------------

export function neueItemId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `item-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// Messwerte kommen von Hand: mal mit Komma, mal mit Punkt, mal leer.
// Alles, was keine Zahl ergibt, ist "nicht eingetragen".
export function parseWert(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(",", ".");
  if (text === "") return null;
  const zahl = Number(text);
  return Number.isFinite(zahl) ? zahl : null;
}

export function istAusserhalb(item, wert) {
  if (wert === null) return false;
  const min = parseWert(item?.min);
  const max = parseWert(item?.max);
  if (min !== null && wert < min) return true;
  if (max !== null && wert > max) return true;
  return false;
}

// "2–8 °C", "max. 8 °C", "min. 2 °C" oder leer, wenn nichts hinterlegt ist.
export function grenzText(item) {
  const min = parseWert(item?.min);
  const max = parseWert(item?.max);
  const einheit = item?.unit ? ` ${item.unit}` : "";
  if (min !== null && max !== null) return `${formatNumberLocal(min)}–${formatNumberLocal(max)}${einheit}`;
  if (min !== null) return `min. ${formatNumberLocal(min)}${einheit}`;
  if (max !== null) return `max. ${formatNumberLocal(max)}${einheit}`;
  return "";
}

export function eintragZu(run, itemId) {
  return (run?.entries ?? []).find((e) => e.itemId === itemId) ?? null;
}

// Zusammenfassung eines Laufs: wie viel ist erledigt, wo weicht ein Wert ab
// und wo fehlt zu einer Abweichung noch die Notiz.
export function laufStatus(template, run) {
  const items = template?.items ?? [];
  let erledigt = 0;
  const abweichungen = [];
  const fehlendeNotizen = [];

  items.forEach((item) => {
    const eintrag = eintragZu(run, item.id);
    if (item.type === "wert") {
      const wert = parseWert(eintrag?.value);
      if (wert !== null) erledigt += 1;
      if (istAusserhalb(item, wert)) {
        abweichungen.push(item);
        if (!String(eintrag?.note ?? "").trim()) fehlendeNotizen.push(item);
      }
    } else if (eintrag?.done) {
      erledigt += 1;
    }
  });

  return {
    gesamt: items.length,
    erledigt,
    offen: items.length - erledigt,
    abweichungen,
    fehlendeNotizen,
  };
}

function zeitwert(iso) {
  const zeit = iso ? new Date(iso).getTime() : 0;
  return Number.isFinite(zeit) ? zeit : 0;
}

// Neueste zuerst: erst nach Lauf-Datum, bei gleichem Datum nach dem
// Zeitpunkt des Anlegens.
export function sortiereRuns(runs) {
  return [...runs].sort(
    (a, b) => zeitwert(b.runDate) - zeitwert(a.runDate) || zeitwert(b.createdAt) - zeitwert(a.createdAt)
  );
}

export function letzteLaeufe(runs, anzahl = VERLAUF_LAEUFE) {
  return sortiereRuns(runs).slice(0, anzahl);
}

export function aktiveVorlagen(templates) {
  return templates.filter((v) => v.active !== false).sort((a, b) => a.name.localeCompare(b.name, getLocale()));
}

// ---------------------------------------------------------------------
// Oberfläche
// ---------------------------------------------------------------------

const pickEl = document.getElementById("checklist-template-pick");
const dateEl = document.getElementById("checklist-run-date");
const openBtn = document.getElementById("checklist-open-run");
const runEl = document.getElementById("checklist-run");
const historyEl = document.getElementById("checklist-history");
const printHistoryBtn = document.getElementById("checklist-print-history");

const newTemplateBtn = document.getElementById("checklist-template-new");
const templateFormEl = document.getElementById("checklist-template-form");
const templateNameEl = document.getElementById("checklist-template-name");
const templateNameEnEl = document.getElementById("checklist-template-name-en");
const templateKindEl = document.getElementById("checklist-template-kind");
const templateActiveEl = document.getElementById("checklist-template-active");
const templateItemsEl = document.getElementById("checklist-template-items");
const addTemplateItemBtn = document.getElementById("checklist-template-add-item");
const cancelTemplateBtn = document.getElementById("checklist-template-cancel");
const templateListEl = document.getElementById("checklist-template-list");

// Welcher Lauf gerade offen ist: Vorlage + Datum, nicht die Lauf-id – der
// Lauf kann von einem anderen Gerät angelegt worden sein.
let offenerLauf = null;
// Vorlage, die gerade im Admin-Formular bearbeitet wird (null = neu).
let bearbeiteteVorlage = null;
// Merker, damit ein Neuzeichnen (eigene Eingabe oder Realtime von einem
// anderen Gerät) nicht den Cursor aus dem Feld wirft.
let fokusMerker = null;

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

function formatUhrzeit(iso) {
  if (!iso) return "";
  return formatDate(iso, { hour: "2-digit", minute: "2-digit" });
}

function eigenerName() {
  const profil = getCurrentProfile();
  const nutzer = getCurrentUser();
  return profil?.display_name || profil?.username || nutzer?.email?.split("@")[0] || "unbekannt";
}

function vorlageZu(id) {
  return loadChecklistTemplates().find((v) => v.id === id) ?? null;
}

function findeLauf(templateId, datum) {
  return loadChecklistRuns().find((r) => r.templateId === templateId && r.runDate === datum) ?? null;
}

// ── Team-Ansicht: Vorlage wählen, Lauf öffnen ─────────────────────────

function renderVorlagenAuswahl() {
  const vorlagen = aktiveVorlagen(loadChecklistTemplates());
  const vorher = pickEl.value;
  pickEl.innerHTML = vorlagen.length
    ? vorlagen
        .map(
          (v) =>
            `<option value="${escapeHtml(v.id)}">${escapeHtml(localizedText(v, "name"))} · ${escapeHtml(
              kindLabel(v.kind)
            )}</option>`
        )
        .join("")
    : `<option value="">${escapeHtml(t("ui.noch_keine_aktive_vorlage"))}</option>`;
  if (vorher && vorlagen.some((v) => v.id === vorher)) pickEl.value = vorher;
  openBtn.disabled = vorlagen.length === 0;
}

// Hinweis hinter Inhalten, die es nur auf Deutsch gibt (siehe js/i18n.js).
function langHinweis(isGermanOnly) {
  return isGermanOnly ? ` <span class="lang-note">(${escapeHtml(germanOnlyNote())})</span>` : "";
}

// Bezeichnung eines Checklistenpunkts als HTML, inklusive Hinweis, wenn der
// Punkt nur auf Deutsch gepflegt ist.
function itemLabelHtml(item) {
  const { text, isGermanOnly } = localizedContent(item, "label");
  return `${escapeHtml(text)}${langHinweis(isGermanOnly)}`;
}

function itemZusatz(item) {
  const teile = [];
  if (item.type === "wert") {
    const grenzen = grenzText(item);
    if (grenzen) teile.push(`${t("ui.sollbereich")} ${grenzen}`);
  }
  const hinweis = localizedText(item, "hint");
  if (hinweis) teile.push(hinweis);
  if (teile.length === 0) return "";
  return `<br /><span class="prep-status">${escapeHtml(teile.join(" · "))}</span>`;
}

function nachweisText(eintrag) {
  if (!eintrag?.by) return "";
  return eintrag.at ? `${eintrag.by} · ${formatUhrzeit(eintrag.at)}` : eintrag.by;
}

function notizZeile(item, notiz, gesperrt, pflicht) {
  return `
    <div class="menu-pick">
      <input
        type="text"
        class="checklist-note"
        data-field="note"
        data-item="${escapeHtml(item.id)}"
        placeholder="${pflicht ? t("ui.notiz_zur_abweichung_pflicht") : t("ui.notiz")}"
        value="${escapeHtml(notiz)}"
        style="flex: 1 1 auto; width: auto;"
        ${gesperrt ? "disabled" : ""}
      />
    </div>`;
}

function itemZeileHtml(item, eintrag, gesperrt) {
  const nachweis = nachweisText(eintrag);

  if (item.type === "wert") {
    const wert = parseWert(eintrag?.value);
    const ausserhalb = istAusserhalb(item, wert);
    const notiz = String(eintrag?.note ?? "");
    const zeigeNotiz = ausserhalb || notiz.trim() !== "";
    return `
      <div class="menu-pick${ausserhalb ? " menu-pick-missing" : ""}" style="flex-wrap: wrap">
        <span style="flex: 1 1 11rem; min-width: 11rem">${itemLabelHtml(item)}${itemZusatz(item)}</span>
        <input
          type="text"
          inputmode="decimal"
          class="checklist-value"
          data-field="value"
          data-item="${escapeHtml(item.id)}"
          value="${wert === null ? "" : escapeHtml(formatNumberLocal(wert))}"
          style="flex: none; width: 6.5rem;"
          ${gesperrt ? "disabled" : ""}
        />
        <span class="menu-pick-price">${escapeHtml(item.unit ?? "")}</span>
        <span class="menu-pick-price">${escapeHtml(nachweis)}</span>
      </div>
      ${zeigeNotiz ? notizZeile(item, notiz, gesperrt, ausserhalb && notiz.trim() === "") : ""}`;
  }

  const erledigt = Boolean(eintrag?.done);
  return `
    <label class="menu-pick" style="flex-wrap: wrap">
      <input
        type="checkbox"
        class="checklist-done"
        data-field="done"
        data-item="${escapeHtml(item.id)}"
        ${erledigt ? "checked" : ""}
        ${gesperrt ? "disabled" : ""}
      />
      <span style="flex: 1 1 11rem; min-width: 11rem${
        erledigt ? "; text-decoration: line-through; color: var(--text-muted)" : ""
      }">${itemLabelHtml(item)}${itemZusatz(item)}</span>
      <span class="menu-pick-price">${escapeHtml(nachweis)}</span>
    </label>`;
}

function laufHtml(template, run) {
  const status = laufStatus(template, run);
  const gesperrt = Boolean(run.finishedAt);
  const zeilen = (template.items ?? [])
    .map((item) => itemZeileHtml(item, eintragZu(run, item.id), gesperrt))
    .join("");

  const kacheln = `
    <div class="home-stats">
      <div class="stat-tile">
        <span class="stat-value">${status.erledigt}/${status.gesamt}</span>
        <span class="stat-label">${t("ui.erledigt_klein")}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">${status.abweichungen.length}</span>
        <span class="stat-label">${t("ui.abweichungen")}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">${gesperrt ? t("ui.ja") : t("ui.nein_klein")}</span>
        <span class="stat-label">${t("ui.abgeschlossen_klein")}</span>
      </div>
    </div>`;

  const hinweis =
    status.fehlendeNotizen.length > 0
      ? `<p class="empty-note">${status.fehlendeNotizen.length} ${t("ui.wert_e_ausserhalb_des_sollbereichs_ohne_67b3")}</p>`
      : "";

  const abschluss = gesperrt
    ? `<p class="prep-meta">${t("ui.abgeschlossen")} ${escapeHtml(formatZeitpunkt(run.finishedAt))}</p>`
    : "";

  return `
    <div class="prep-item${status.abweichungen.length > 0 ? " prep-expired" : ""}" data-run-id="${escapeHtml(
      run.id
    )}">
      <div class="prep-item-head">
        <strong>${escapeHtml(localizedText(template, "name"))} · ${escapeHtml(
          formatDatum(run.runDate)
        )}</strong>
        <span class="prep-status">${escapeHtml(kindLabel(template.kind))}</span>
      </div>
      ${kacheln}
      ${zeilen || `<p class="prep-meta">${t("ui.diese_vorlage_hat_noch_keine_punkte")}</p>`}
      ${hinweis}
      ${abschluss}
      <div class="actions no-print">
        ${
          gesperrt
            ? isAdmin()
              ? `<button type="button" class="btn-secondary" id="checklist-reopen">${t("ui.wieder_oeffnen")}</button>`
              : ""
            : `<button type="button" class="btn-primary" id="checklist-finish">${t("ui.liste_abschliessen")}</button>`
        }
        <button type="button" class="btn-secondary" id="checklist-print-run">${t("ui.drucken")}</button>
        ${
          isAdmin()
            ? `<button type="button" class="btn-secondary" id="checklist-delete-run">${t("ui.loeschen")}</button>`
            : ""
        }
      </div>
    </div>`;
}

function merkeFokus() {
  const el = document.activeElement;
  if (el && runEl.contains(el) && (el.dataset?.field === "value" || el.dataset?.field === "note")) {
    fokusMerker = { field: el.dataset.field, item: el.dataset.item };
  } else {
    fokusMerker = null;
  }
}

function stelleFokusHer() {
  if (!fokusMerker) return;
  const el = runEl.querySelector(`[data-field="${fokusMerker.field}"][data-item="${fokusMerker.item}"]`);
  fokusMerker = null;
  if (!el) return;
  el.focus();
  const ende = el.value.length;
  try {
    el.setSelectionRange(ende, ende);
  } catch {
    // Manche Browser erlauben setSelectionRange nicht auf jedem Feldtyp –
    // dann steht der Cursor eben am Anfang.
  }
}

function renderLauf() {
  if (!offenerLauf) {
    runEl.innerHTML = "";
    return;
  }
  const template = vorlageZu(offenerLauf.templateId);
  if (!template) {
    offenerLauf = null;
    runEl.innerHTML = "";
    return;
  }
  const run = findeLauf(offenerLauf.templateId, offenerLauf.datum);
  if (!run) {
    runEl.innerHTML = `<p class="empty-note">${escapeHtml(
      t("ui.fuer_am_ist_noch_nichts_eingetragen", {
        name: localizedText(template, "name"),
        datum: formatDatum(offenerLauf.datum),
      })
    )}</p>`;
    return;
  }
  merkeFokus();
  runEl.innerHTML = laufHtml(template, run);
  stelleFokusHer();
}

async function oeffneLauf() {
  const templateId = pickEl.value;
  if (!templateId) return;
  const datum = dateEl.value || heuteInput();
  offenerLauf = { templateId, datum };

  if (!findeLauf(templateId, datum)) {
    const neu = { templateId, runDate: datum, entries: [] };
    const nutzer = getCurrentUser();
    if (nutzer) neu.createdBy = nutzer.id;
    try {
      await saveChecklistRun(neu);
    } catch (err) {
      // 23505 = zwei Geräte haben gleichzeitig geöffnet. Der Lauf gibt es
      // dann bereits; er kommt über Realtime herein, nichts zu tun.
      if (err?.code !== "23505") {
        alert(t("ui.liste_konnte_nicht_geoeffnet_werden") + err.message);
        offenerLauf = null;
      }
    }
  }
  renderLauf();
  runEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Schreibt genau einen Eintrag zurück und lässt die anderen unangetastet,
// damit zwei Leute gleichzeitig an derselben Liste arbeiten können.
async function setzeEintrag(itemId, patch, mitNachweis = true) {
  if (!offenerLauf) return;
  const run = findeLauf(offenerLauf.templateId, offenerLauf.datum);
  if (!run || run.finishedAt) return;

  const alt = eintragZu(run, itemId) ?? { itemId };
  const neu = { ...alt, ...patch };
  if (mitNachweis) {
    neu.by = eigenerName();
    neu.at = new Date().toISOString();
  }
  const entries = [...(run.entries ?? []).filter((e) => e.itemId !== itemId), neu];

  try {
    await saveChecklistRun({ ...run, entries });
  } catch (err) {
    alert(t("ui.speichern_fehlgeschlagen") + err.message);
    renderLauf();
  }
}

async function schliesseLaufAb() {
  const template = vorlageZu(offenerLauf?.templateId);
  const run = findeLauf(offenerLauf?.templateId, offenerLauf?.datum);
  if (!template || !run) return;

  const status = laufStatus(template, run);
  if (status.fehlendeNotizen.length > 0) {
    alert(
      t("ui.zu_diesen_werten_ausserhalb_des_15cb") +
        status.fehlendeNotizen.map((i) => `· ${i.label}`).join("\n")
    );
    return;
  }
  if (status.offen > 0 && !confirm(`${status.offen} ${t("ui.punkt_e_sind_noch_offen_trotzdem_6861")}`)) return;

  try {
    await saveChecklistRun({ ...run, finishedAt: new Date().toISOString() });
  } catch (err) {
    alert(t("ui.abschliessen_fehlgeschlagen") + err.message);
  }
}

// ── Verlauf und Druck ────────────────────────────────────────────────

function druckLauf(template, run) {
  const status = laufStatus(template, run);
  const zeilen = (template.items ?? []).map((item) => {
    const eintrag = eintragZu(run, item.id);
    let ergebnis;
    if (item.type === "wert") {
      const wert = parseWert(eintrag?.value);
      const einheit = item.unit ? ` ${item.unit}` : "";
      ergebnis = wert === null ? "–" : `${formatNumberLocal(wert)}${einheit}`;
      if (istAusserhalb(item, wert)) ergebnis += ` ${t("ui.ausserhalb")} ${grenzText(item)})`;
    } else {
      ergebnis = eintrag?.done ? t("ui.erledigt_klein") : t("ui.offen_klein");
    }
    return [
      localizedText(item, "label"),
      ergebnis,
      eintrag?.by ?? "–",
      eintrag?.at ? formatZeitpunkt(eintrag.at) : "–",
      String(eintrag?.note ?? ""),
    ];
  });

  return {
    titel: `${localizedText(template, "name")} · ${formatDatum(run.runDate)}`,
    meta: [
      [t("ui.art"), kindLabel(template.kind)],
      [t("ui.erledigt"), `${status.erledigt} ${t("ui.von")} ${status.gesamt}`],
      [t("ui.abweichungen"), String(status.abweichungen.length)],
      [t("ui.abgeschlossen"), run.finishedAt ? formatZeitpunkt(run.finishedAt) : t("ui.nein_klein")],
    ],
    zeilen,
  };
}

function verlaufLaeufe() {
  return letzteLaeufe(loadChecklistRuns())
    .map((run) => ({ run, template: vorlageZu(run.templateId) }))
    .filter((e) => e.template);
}

function verlaufHtml({ template, run }) {
  const status = laufStatus(template, run);
  const zustand = run.finishedAt
    ? `${t("ui.abgeschlossen_klein")} ${formatZeitpunkt(run.finishedAt)}`
    : t("ui.offen_klein");
  return `
    <div class="prep-item${status.abweichungen.length > 0 ? " prep-expired" : ""}" data-run-id="${escapeHtml(
      run.id
    )}">
      <div class="prep-item-head">
        <strong>${escapeHtml(localizedText(template, "name"))} · ${escapeHtml(
          formatDatum(run.runDate)
        )}</strong>
        <span class="prep-status">${escapeHtml(zustand)}</span>
      </div>
      <p class="prep-meta">${status.erledigt} ${t("ui.von")} ${status.gesamt} ${t("ui.erledigt_klein")}${
        status.abweichungen.length > 0 ? ` · ${status.abweichungen.length} ${t("ui.abweichung_en")}` : ""
      }</p>
      <div class="actions no-print">
        <button type="button" class="btn-secondary checklist-history-open">${t("ui.oeffnen")}</button>
      </div>
    </div>`;
}

function renderVerlauf() {
  const laeufe = verlaufLaeufe();
  historyEl.innerHTML = laeufe.length
    ? laeufe.map(verlaufHtml).join("")
    : `<p class="empty-note">${t("ui.noch_keine_liste_ausgefuellt")}</p>`;
  printHistoryBtn.disabled = laeufe.length === 0;
}

// ── Admin: Vorlagen pflegen ──────────────────────────────────────────

function templateItemRow(item = {}) {
  const row = document.createElement("div");
  row.className = "prep-item checklist-item-row";
  row.dataset.itemId = item.id || neueItemId();
  row.innerHTML = `
    <div class="field-row">
      <label>
        ${t("ui.bezeichnung_deutsch")}
        <input type="text" class="ci-label" placeholder="${t("ui.z_b_kuehlschrank_bar_ablesen")}" />
      </label>
      <label>
        ${t("ui.bezeichnung_englisch")}
        <input type="text" class="ci-label-en" placeholder="${t("ui.z_b_read_bar_fridge")}" />
      </label>
    </div>
    <div class="field-row">
      <label>
        ${t("ui.typ")}
        <select class="ci-type">
          <option value="check">${t("ui.abhaken")}</option>
          <option value="wert">${t("ui.messwert")}</option>
        </select>
      </label>
      <label class="ci-wert-only">
        ${t("ui.einheit")}
        <input type="text" class="ci-unit" placeholder="z. B. °C" />
      </label>
      <label class="ci-wert-only">
        ${t("ui.sollwert_min")}
        <input type="text" inputmode="decimal" class="ci-min" placeholder="optional" />
      </label>
      <label class="ci-wert-only">
        ${t("ui.sollwert_max")}
        <input type="text" inputmode="decimal" class="ci-max" placeholder="optional" />
      </label>
    </div>
    <div class="field-row">
      <label>
        ${t("ui.hinweis_deutsch")}
        <input type="text" class="ci-hint" placeholder="${t("ui.optional_z_b_thermometer_im_mittleren_fach")}" />
      </label>
      <label>
        ${t("ui.hinweis_englisch")}
        <input type="text" class="ci-hint-en" placeholder="${t("ui.optional_z_b_thermometer_on_the_middle_shelf")}" />
      </label>
    </div>
    <div class="actions">
      <button type="button" class="btn-secondary ci-up" aria-label="${t("ui.nach_oben")}">↑</button>
      <button type="button" class="btn-secondary ci-down" aria-label="${t("ui.nach_unten")}">↓</button>
      <button type="button" class="btn-secondary ci-remove">${t("ui.entfernen")}</button>
    </div>`;

  row.querySelector(".ci-label").value = item.label ?? "";
  row.querySelector(".ci-label-en").value = item.labelEn ?? "";
  row.querySelector(".ci-type").value = item.type === "wert" ? "wert" : "check";
  row.querySelector(".ci-unit").value = item.unit ?? "";
  row.querySelector(".ci-min").value = item.min === undefined || item.min === null ? "" : String(item.min);
  row.querySelector(".ci-max").value = item.max === undefined || item.max === null ? "" : String(item.max);
  row.querySelector(".ci-hint").value = item.hint ?? "";
  row.querySelector(".ci-hint-en").value = item.hintEn ?? "";
  zeigeWertFelder(row);
  templateItemsEl.appendChild(row);
  return row;
}

function zeigeWertFelder(row) {
  const istWert = row.querySelector(".ci-type").value === "wert";
  row.querySelectorAll(".ci-wert-only").forEach((el) => {
    el.hidden = !istWert;
  });
}

function gesammelteItems() {
  return [...templateItemsEl.querySelectorAll(".checklist-item-row")]
    .map((row) => {
      const label = row.querySelector(".ci-label").value.trim();
      const type = row.querySelector(".ci-type").value === "wert" ? "wert" : "check";
      const item = { id: row.dataset.itemId, label, type };
      // Englische Zweitfassung im selben Item (Paket 33); leere Felder werden
      // gar nicht erst geschrieben.
      const labelEn = row.querySelector(".ci-label-en").value.trim();
      if (labelEn) item.labelEn = labelEn;
      const hint = row.querySelector(".ci-hint").value.trim();
      if (hint) item.hint = hint;
      const hintEn = row.querySelector(".ci-hint-en").value.trim();
      if (hintEn) item.hintEn = hintEn;
      if (type === "wert") {
        const unit = row.querySelector(".ci-unit").value.trim();
        if (unit) item.unit = unit;
        const min = parseWert(row.querySelector(".ci-min").value);
        const max = parseWert(row.querySelector(".ci-max").value);
        if (min !== null) item.min = min;
        if (max !== null) item.max = max;
      }
      return item;
    })
    .filter((item) => item.label);
}

function oeffneVorlagenFormular(template = null) {
  bearbeiteteVorlage = template;
  templateFormEl.hidden = false;
  newTemplateBtn.hidden = true;
  templateItemsEl.innerHTML = "";
  templateNameEl.value = template?.name ?? "";
  templateNameEnEl.value = template?.nameEn ?? "";
  templateKindEl.value = template?.kind ?? "sonstiges";
  templateActiveEl.checked = template ? template.active !== false : true;
  const items = template?.items ?? [];
  if (items.length) items.forEach((item) => templateItemRow(item));
  else templateItemRow();
  templateNameEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function schliesseVorlagenFormular() {
  bearbeiteteVorlage = null;
  templateFormEl.hidden = true;
  newTemplateBtn.hidden = false;
  templateFormEl.reset();
  templateItemsEl.innerHTML = "";
}

async function speichereVorlage(e) {
  e.preventDefault();
  const name = templateNameEl.value.trim();
  if (!name) {
    alert(t("ui.bitte_einen_namen_fuer_die_vorlage_eintragen"));
    return;
  }
  const items = gesammelteItems();
  if (items.length === 0) {
    alert(t("ui.bitte_mindestens_einen_punkt_mit_3679"));
    return;
  }
  const template = {
    id: bearbeiteteVorlage?.id,
    name,
    nameEn: templateNameEnEl.value.trim(),
    kind: templateKindEl.value,
    items,
    active: templateActiveEl.checked,
  };
  try {
    await saveChecklistTemplate(template);
    schliesseVorlagenFormular();
  } catch (err) {
    alert(t("ui.speichern_fehlgeschlagen") + err.message);
  }
}

function vorlageHtml(template) {
  const wertPunkte = (template.items ?? []).filter((i) => i.type === "wert").length;
  const beschreibung = `${(template.items ?? []).length} ${t("ui.punkt_e")}${
    wertPunkte > 0 ? ` · ${t("ui.davon")} ${wertPunkte} ${t("ui.messwert_e")}` : ""
  }`;
  return `
    <div class="prep-item${template.active === false ? " prep-done" : ""}" data-template-id="${escapeHtml(
      template.id
    )}">
      <div class="prep-item-head">
        <strong>${escapeHtml(localizedText(template, "name"))}</strong>
        <span class="prep-status">${escapeHtml(kindLabel(template.kind))}${
          template.active === false ? ` · ${t("ui.inaktiv")}` : ""
        }</span>
      </div>
      <p class="prep-meta">${escapeHtml(beschreibung)}</p>
      <div class="actions no-print">
        <button type="button" class="btn-secondary checklist-template-edit">${t("ui.bearbeiten")}</button>
        <button type="button" class="btn-secondary checklist-template-delete">${t("ui.loeschen")}</button>
      </div>
    </div>`;
}

function renderVorlagenListe() {
  if (!isAdmin()) {
    templateListEl.innerHTML = "";
    return;
  }
  const vorlagen = [...loadChecklistTemplates()].sort((a, b) => a.name.localeCompare(b.name, getLocale()));
  templateListEl.innerHTML = vorlagen.length
    ? vorlagen.map(vorlageHtml).join("")
    : `<p class="empty-note">${escapeHtml(t("ui.noch_keine_vorlage_angelegt"))}</p>`;
}

// ---------------------------------------------------------------------

function renderAlles() {
  renderVorlagenAuswahl();
  renderLauf();
  renderVerlauf();
  renderVorlagenListe();
}

export function initChecklists() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    renderAlles();
    renderLauf();
  });

  dateEl.value = heuteInput();
  schliesseVorlagenFormular();
  renderAlles();
  onChecklistTemplatesChanged(renderAlles);
  onChecklistRunsChanged(() => {
    renderLauf();
    renderVerlauf();
  });

  openBtn.addEventListener("click", oeffneLauf);

  // Eingaben im offenen Lauf: Haken, Messwert, Notiz.
  runEl.addEventListener("change", (e) => {
    const box = e.target.closest(".checklist-done");
    if (box) {
      setzeEintrag(
        box.dataset.item,
        box.checked ? { done: true } : { done: false, by: null, at: null },
        box.checked
      );
      return;
    }
    const feld = e.target.closest(".checklist-value");
    if (feld) {
      const wert = parseWert(feld.value);
      setzeEintrag(feld.dataset.item, wert === null ? { value: null, by: null, at: null } : { value: wert }, wert !== null);
      return;
    }
    const notiz = e.target.closest(".checklist-note");
    if (notiz) {
      // Die Notiz gehört zum Messwert – wer gemessen hat, bleibt stehen.
      // Nur wenn zu dem Punkt noch gar kein Nachweis existiert, wird der
      // Schreiber der Notiz eingetragen.
      const run = findeLauf(offenerLauf?.templateId, offenerLauf?.datum);
      const vorhanden = eintragZu(run, notiz.dataset.item);
      setzeEintrag(notiz.dataset.item, { note: notiz.value.trim() }, !vorhanden?.by);
    }
  });

  runEl.addEventListener("click", async (e) => {
    if (e.target.closest("#checklist-finish")) {
      schliesseLaufAb();
      return;
    }
    if (e.target.closest("#checklist-reopen")) {
      const run = findeLauf(offenerLauf?.templateId, offenerLauf?.datum);
      if (!run) return;
      try {
        await saveChecklistRun({ ...run, finishedAt: null });
      } catch (err) {
        alert(t("ui.wieder_oeffnen_fehlgeschlagen") + err.message);
      }
      return;
    }
    if (e.target.closest("#checklist-print-run")) {
      const template = vorlageZu(offenerLauf?.templateId);
      const run = findeLauf(offenerLauf?.templateId, offenerLauf?.datum);
      if (template && run) printChecklistRuns([druckLauf(template, run)]);
      return;
    }
    if (e.target.closest("#checklist-delete-run")) {
      const run = findeLauf(offenerLauf?.templateId, offenerLauf?.datum);
      if (!run) return;
      if (!confirm(`${t("ui.nachweis_vom")} ${formatDatum(run.runDate)} ${t("ui.wirklich_loeschen")}`)) return;
      try {
        await deleteChecklistRun(run.id);
        offenerLauf = null;
        renderLauf();
      } catch (err) {
        alert(t("ui.loeschen_fehlgeschlagen") + err.message);
      }
    }
  });

  historyEl.addEventListener("click", (e) => {
    if (!e.target.closest(".checklist-history-open")) return;
    const karte = e.target.closest(".prep-item");
    const run = loadChecklistRuns().find((r) => r.id === karte?.dataset.runId);
    if (!run) return;
    offenerLauf = { templateId: run.templateId, datum: run.runDate };
    pickEl.value = run.templateId;
    dateEl.value = run.runDate;
    renderLauf();
    runEl.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  printHistoryBtn.addEventListener("click", () => {
    const laeufe = verlaufLaeufe();
    if (laeufe.length === 0) return;
    printChecklistRuns(laeufe.map(({ template, run }) => druckLauf(template, run)));
  });

  // ── Admin ──
  newTemplateBtn.addEventListener("click", () => oeffneVorlagenFormular());
  cancelTemplateBtn.addEventListener("click", schliesseVorlagenFormular);
  templateFormEl.addEventListener("submit", speichereVorlage);
  addTemplateItemBtn.addEventListener("click", () => templateItemRow());

  templateItemsEl.addEventListener("change", (e) => {
    if (e.target.closest(".ci-type")) zeigeWertFelder(e.target.closest(".checklist-item-row"));
  });

  templateItemsEl.addEventListener("click", (e) => {
    const row = e.target.closest(".checklist-item-row");
    if (!row) return;
    if (e.target.closest(".ci-remove")) {
      if (templateItemsEl.querySelectorAll(".checklist-item-row").length > 1) row.remove();
      else {
        row.querySelector(".ci-label").value = "";
        row.querySelector(".ci-hint").value = "";
      }
      return;
    }
    if (e.target.closest(".ci-up") && row.previousElementSibling) {
      templateItemsEl.insertBefore(row, row.previousElementSibling);
      return;
    }
    if (e.target.closest(".ci-down") && row.nextElementSibling) {
      templateItemsEl.insertBefore(row.nextElementSibling, row);
    }
  });

  templateListEl.addEventListener("click", async (e) => {
    const karte = e.target.closest(".prep-item");
    const template = loadChecklistTemplates().find((v) => v.id === karte?.dataset.templateId);
    if (!template) return;
    if (e.target.closest(".checklist-template-edit")) {
      oeffneVorlagenFormular(template);
      return;
    }
    if (e.target.closest(".checklist-template-delete")) {
      if (
        !confirm(
          `${t("ui.vorlage_7041")}${localizedText(template, "name")}${t(
            "ui.wirklich_loeschen_alle_ausgefuellten_1643"
          )}`
        )
      )
        return;
      try {
        await deleteChecklistTemplate(template.id);
        if (offenerLauf?.templateId === template.id) offenerLauf = null;
        renderAlles();
      } catch (err) {
        alert(t("ui.loeschen_fehlgeschlagen") + err.message);
      }
    }
  });
}
