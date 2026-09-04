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
import { escapeHtml, formatNumberDe } from "./utils.js";
import { printChecklistRuns } from "./printView.js";

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

export const KIND_LABELS = {
  opening: "Opening",
  closing: "Closing",
  reinigung: "Reinigung",
  temperatur: "Temperatur",
  sonstiges: "Sonstiges",
};

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
  if (min !== null && max !== null) return `${formatNumberDe(min)}–${formatNumberDe(max)}${einheit}`;
  if (min !== null) return `min. ${formatNumberDe(min)}${einheit}`;
  if (max !== null) return `max. ${formatNumberDe(max)}${einheit}`;
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
  const t = iso ? new Date(iso).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
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
  return templates.filter((t) => t.active !== false).sort((a, b) => a.name.localeCompare(b.name, "de"));
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

function formatUhrzeit(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function eigenerName() {
  const profil = getCurrentProfile();
  const nutzer = getCurrentUser();
  return profil?.display_name || profil?.username || nutzer?.email?.split("@")[0] || "unbekannt";
}

function vorlageZu(id) {
  return loadChecklistTemplates().find((t) => t.id === id) ?? null;
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
          (t) =>
            `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} · ${escapeHtml(
              KIND_LABELS[t.kind] ?? t.kind
            )}</option>`
        )
        .join("")
    : '<option value="">Noch keine aktive Vorlage</option>';
  if (vorher && vorlagen.some((t) => t.id === vorher)) pickEl.value = vorher;
  openBtn.disabled = vorlagen.length === 0;
}

function itemZusatz(item) {
  const teile = [];
  if (item.type === "wert") {
    const grenzen = grenzText(item);
    if (grenzen) teile.push(`Sollbereich ${grenzen}`);
  }
  if (item.hint) teile.push(item.hint);
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
        placeholder="${pflicht ? "Notiz zur Abweichung – Pflicht" : "Notiz"}"
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
        <span style="flex: 1 1 11rem; min-width: 11rem">${escapeHtml(item.label)}${itemZusatz(item)}</span>
        <input
          type="text"
          inputmode="decimal"
          class="checklist-value"
          data-field="value"
          data-item="${escapeHtml(item.id)}"
          value="${wert === null ? "" : escapeHtml(formatNumberDe(wert))}"
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
      }">${escapeHtml(item.label)}${itemZusatz(item)}</span>
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
        <span class="stat-label">erledigt</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">${status.abweichungen.length}</span>
        <span class="stat-label">Abweichungen</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">${gesperrt ? "ja" : "nein"}</span>
        <span class="stat-label">abgeschlossen</span>
      </div>
    </div>`;

  const hinweis =
    status.fehlendeNotizen.length > 0
      ? `<p class="empty-note">${status.fehlendeNotizen.length} Wert(e) außerhalb des Sollbereichs ohne Notiz. Ohne Notiz lässt sich die Liste nicht abschließen.</p>`
      : "";

  const abschluss = gesperrt
    ? `<p class="prep-meta">Abgeschlossen ${escapeHtml(formatZeitpunkt(run.finishedAt))}</p>`
    : "";

  return `
    <div class="prep-item${status.abweichungen.length > 0 ? " prep-expired" : ""}" data-run-id="${escapeHtml(
      run.id
    )}">
      <div class="prep-item-head">
        <strong>${escapeHtml(template.name)} · ${escapeHtml(formatDatum(run.runDate))}</strong>
        <span class="prep-status">${escapeHtml(KIND_LABELS[template.kind] ?? template.kind)}</span>
      </div>
      ${kacheln}
      ${zeilen || '<p class="prep-meta">Diese Vorlage hat noch keine Punkte.</p>'}
      ${hinweis}
      ${abschluss}
      <div class="actions no-print">
        ${
          gesperrt
            ? isAdmin()
              ? '<button type="button" class="btn-secondary" id="checklist-reopen">Wieder öffnen</button>'
              : ""
            : '<button type="button" class="btn-primary" id="checklist-finish">Liste abschließen</button>'
        }
        <button type="button" class="btn-secondary" id="checklist-print-run">Drucken</button>
        ${isAdmin() ? '<button type="button" class="btn-secondary" id="checklist-delete-run">Löschen</button>' : ""}
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
    runEl.innerHTML = `<p class="empty-note">Für ${escapeHtml(template.name)} am ${escapeHtml(
      formatDatum(offenerLauf.datum)
    )} ist noch nichts eingetragen.</p>`;
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
        alert("Liste konnte nicht geöffnet werden: " + err.message);
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
    alert("Speichern fehlgeschlagen: " + err.message);
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
      "Zu diesen Werten außerhalb des Sollbereichs fehlt noch eine Notiz:\n\n" +
        status.fehlendeNotizen.map((i) => `· ${i.label}`).join("\n")
    );
    return;
  }
  if (status.offen > 0 && !confirm(`${status.offen} Punkt(e) sind noch offen. Trotzdem abschließen?`)) return;

  try {
    await saveChecklistRun({ ...run, finishedAt: new Date().toISOString() });
  } catch (err) {
    alert("Abschließen fehlgeschlagen: " + err.message);
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
      ergebnis = wert === null ? "–" : `${formatNumberDe(wert)}${einheit}`;
      if (istAusserhalb(item, wert)) ergebnis += ` (außerhalb ${grenzText(item)})`;
    } else {
      ergebnis = eintrag?.done ? "erledigt" : "offen";
    }
    return [
      item.label,
      ergebnis,
      eintrag?.by ?? "–",
      eintrag?.at ? formatZeitpunkt(eintrag.at) : "–",
      String(eintrag?.note ?? ""),
    ];
  });

  return {
    titel: `${template.name} · ${formatDatum(run.runDate)}`,
    meta: [
      ["Art", KIND_LABELS[template.kind] ?? template.kind],
      ["Erledigt", `${status.erledigt} von ${status.gesamt}`],
      ["Abweichungen", String(status.abweichungen.length)],
      ["Abgeschlossen", run.finishedAt ? formatZeitpunkt(run.finishedAt) : "nein"],
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
  const zustand = run.finishedAt ? `abgeschlossen ${formatZeitpunkt(run.finishedAt)}` : "offen";
  return `
    <div class="prep-item${status.abweichungen.length > 0 ? " prep-expired" : ""}" data-run-id="${escapeHtml(
      run.id
    )}">
      <div class="prep-item-head">
        <strong>${escapeHtml(template.name)} · ${escapeHtml(formatDatum(run.runDate))}</strong>
        <span class="prep-status">${escapeHtml(zustand)}</span>
      </div>
      <p class="prep-meta">${status.erledigt} von ${status.gesamt} erledigt${
        status.abweichungen.length > 0 ? ` · ${status.abweichungen.length} Abweichung(en)` : ""
      }</p>
      <div class="actions no-print">
        <button type="button" class="btn-secondary checklist-history-open">Öffnen</button>
      </div>
    </div>`;
}

function renderVerlauf() {
  const laeufe = verlaufLaeufe();
  historyEl.innerHTML = laeufe.length
    ? laeufe.map(verlaufHtml).join("")
    : '<p class="empty-note">Noch keine Liste ausgefüllt.</p>';
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
        Bezeichnung
        <input type="text" class="ci-label" placeholder="z. B. Kühlschrank Bar ablesen" />
      </label>
      <label>
        Typ
        <select class="ci-type">
          <option value="check">Abhaken</option>
          <option value="wert">Messwert</option>
        </select>
      </label>
      <label class="ci-wert-only">
        Einheit
        <input type="text" class="ci-unit" placeholder="z. B. °C" />
      </label>
      <label class="ci-wert-only">
        Sollwert min.
        <input type="text" inputmode="decimal" class="ci-min" placeholder="optional" />
      </label>
      <label class="ci-wert-only">
        Sollwert max.
        <input type="text" inputmode="decimal" class="ci-max" placeholder="optional" />
      </label>
    </div>
    <label>
      Hinweis
      <input type="text" class="ci-hint" placeholder="optional, z. B. Thermometer im mittleren Fach" />
    </label>
    <div class="actions">
      <button type="button" class="btn-secondary ci-up" aria-label="nach oben">↑</button>
      <button type="button" class="btn-secondary ci-down" aria-label="nach unten">↓</button>
      <button type="button" class="btn-secondary ci-remove">Entfernen</button>
    </div>`;

  row.querySelector(".ci-label").value = item.label ?? "";
  row.querySelector(".ci-type").value = item.type === "wert" ? "wert" : "check";
  row.querySelector(".ci-unit").value = item.unit ?? "";
  row.querySelector(".ci-min").value = item.min === undefined || item.min === null ? "" : String(item.min);
  row.querySelector(".ci-max").value = item.max === undefined || item.max === null ? "" : String(item.max);
  row.querySelector(".ci-hint").value = item.hint ?? "";
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
      const hint = row.querySelector(".ci-hint").value.trim();
      if (hint) item.hint = hint;
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
    alert("Bitte einen Namen für die Vorlage eintragen.");
    return;
  }
  const items = gesammelteItems();
  if (items.length === 0) {
    alert("Bitte mindestens einen Punkt mit Bezeichnung eintragen.");
    return;
  }
  const template = {
    id: bearbeiteteVorlage?.id,
    name,
    kind: templateKindEl.value,
    items,
    active: templateActiveEl.checked,
  };
  try {
    await saveChecklistTemplate(template);
    schliesseVorlagenFormular();
  } catch (err) {
    alert("Speichern fehlgeschlagen: " + err.message);
  }
}

function vorlageHtml(template) {
  const wertPunkte = (template.items ?? []).filter((i) => i.type === "wert").length;
  const beschreibung = `${(template.items ?? []).length} Punkt(e)${
    wertPunkte > 0 ? ` · davon ${wertPunkte} Messwert(e)` : ""
  }`;
  return `
    <div class="prep-item${template.active === false ? " prep-done" : ""}" data-template-id="${escapeHtml(
      template.id
    )}">
      <div class="prep-item-head">
        <strong>${escapeHtml(template.name)}</strong>
        <span class="prep-status">${escapeHtml(KIND_LABELS[template.kind] ?? template.kind)}${
          template.active === false ? " · inaktiv" : ""
        }</span>
      </div>
      <p class="prep-meta">${escapeHtml(beschreibung)}</p>
      <div class="actions no-print">
        <button type="button" class="btn-secondary checklist-template-edit">Bearbeiten</button>
        <button type="button" class="btn-secondary checklist-template-delete">Löschen</button>
      </div>
    </div>`;
}

function renderVorlagenListe() {
  if (!isAdmin()) {
    templateListEl.innerHTML = "";
    return;
  }
  const vorlagen = [...loadChecklistTemplates()].sort((a, b) => a.name.localeCompare(b.name, "de"));
  templateListEl.innerHTML = vorlagen.length
    ? vorlagen.map(vorlageHtml).join("")
    : '<p class="empty-note">Noch keine Vorlage angelegt.</p>';
}

// ---------------------------------------------------------------------

function renderAlles() {
  renderVorlagenAuswahl();
  renderLauf();
  renderVerlauf();
  renderVorlagenListe();
}

export function initChecklists() {
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
        alert("Wieder öffnen fehlgeschlagen: " + err.message);
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
      if (!confirm(`Nachweis vom ${formatDatum(run.runDate)} wirklich löschen?`)) return;
      try {
        await deleteChecklistRun(run.id);
        offenerLauf = null;
        renderLauf();
      } catch (err) {
        alert("Löschen fehlgeschlagen: " + err.message);
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
    const template = loadChecklistTemplates().find((t) => t.id === karte?.dataset.templateId);
    if (!template) return;
    if (e.target.closest(".checklist-template-edit")) {
      oeffneVorlagenFormular(template);
      return;
    }
    if (e.target.closest(".checklist-template-delete")) {
      if (
        !confirm(
          `Vorlage „${template.name}“ wirklich löschen? Alle ausgefüllten Nachweise dieser Vorlage werden mitgelöscht.`
        )
      )
        return;
      try {
        await deleteChecklistTemplate(template.id);
        if (offenerLauf?.templateId === template.id) offenerLauf = null;
        renderAlles();
      } catch (err) {
        alert("Löschen fehlgeschlagen: " + err.message);
      }
    }
  });
}
