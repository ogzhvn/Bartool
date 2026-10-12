import {
  loadQuizQuestions,
  onQuizQuestionsChanged,
  saveQuizQuestion,
  setQuizQuestionsActive,
  deleteQuizQuestions,
  isOffline,
} from "./storage.js";
import { formatDate, onLanguageChanged, t } from "./i18n.js";
import { QUIZ_COLUMNS, QUIZ_SETS, QUIZ_NARROW_SET, quizColumnByField } from "./quizColumns.js";
import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { can } from "./auth.js";
import {
  initCellEditing,
  istBearbeitungOffen,
  istSpalteEditierbar,
  beiBearbeitungEnde,
  setzeZellInhalt,
  zeichneFehlerNeu,
} from "./tableEdit.js";

// Fragentabelle im Adminbereich (Sub-Tab "admin-quiz").
//
// Gleiche Optik und Bedienung wie die Katalogtabelle (js/adminTable.js):
// Spaltensets, Suche über die sichtbaren Spalten, Filter, Sortierung per
// Spaltenkopf, stehende erste Spalte, Bearbeiten in der Zelle über das
// gemeinsame js/tableEdit.js. Die Fragespalte ist der Anker – ein Klick lädt
// die Frage in das Formular darunter. Frage, Antworten und richtige Antwort
// bleiben dem Formular vorbehalten: sie hängen aneinander, und ein
// Antwortfeld allein zu ändern hieße, den Index daneben zu verschieben.
//
// Unterschied zur Katalogtabelle: hier stehen ein paar tausend Zeilen statt
// ein paar hundert. Deshalb der Render-Deckel unten – der Browser soll die
// Tabelle zeichnen, nicht daran ersticken.
//
// Die Fragen stehen in Gruppen nach Oberthema und Thema, die sich auf- und
// zuklappen lassen; ohne Suche und Themenfilter sind alle zu. Jede Fragezeile
// klappt außerdem ihre Details auf (alle Antworten, Erklärung). Über die
// Kästchen lassen sich viele Fragen auf einmal abschalten oder löschen.
//
// Spaltenbreiten zieht man am rechten Rand des Spaltenkopfs, die Reihenfolge
// per Ziehen am Spaltennamen (Maus) oder mit den Pfeilen unter "Spalten"
// (Finger – dort würde Ziehen mit dem Scrollen der Tabelle kollidieren).
// Beides bleibt pro Gerät gespeichert. Die Tabelle läuft dafür mit table-layout: fixed – sonst
// richtet der Browser die Spalten nach dem Inhalt aus und ignoriert die
// gezogene Breite.

const searchEl = document.getElementById("quiz-table-search");
const topicEl = document.getElementById("quiz-table-topic");
const sourceEl = document.getElementById("quiz-table-source");
const statusEl = document.getElementById("quiz-table-status");
const setEl = document.getElementById("quiz-table-set");
const columnsBtnEl = document.getElementById("quiz-table-columns-btn");
const columnsPopEl = document.getElementById("quiz-table-columns-pop");
const countEl = document.getElementById("quiz-table-count");
const noteEl = document.getElementById("quiz-table-note");
const tableEl = document.getElementById("quiz-table");
const expandAllEl = document.getElementById("quiz-table-expand-all");
const collapseAllEl = document.getElementById("quiz-table-collapse-all");
const bulkEl = document.getElementById("quiz-table-bulk");
const bulkCountEl = document.getElementById("quiz-table-bulk-count");
const bulkDeactivateEl = document.getElementById("quiz-table-bulk-deactivate");
const bulkActivateEl = document.getElementById("quiz-table-bulk-activate");
const bulkDeleteEl = document.getElementById("quiz-table-bulk-delete");
const bulkClearEl = document.getElementById("quiz-table-bulk-clear");
const bulkNoteEl = document.getElementById("quiz-table-bulk-note");

const STORAGE_KEY = "bartool.quizTable";
const NARROW_QUERY = "(max-width: 700px)";
// Mehr Zeilen zeichnet niemand mehr durch; wer eine bestimmte Frage sucht,
// sucht sie über Suchfeld und Filter, nicht durch Scrollen.
const MAX_ZEILEN = 300;
const MIN_BREITE = 60;
const MAX_BREITE = 1200;

const state = {
  set: null,
  custom: null,
  topic: "",
  source: "",
  status: "aktiv",
  query: "",
  sort: { field: "question", dir: "asc" },
  // Von Hand gezogene Spaltenbreiten in px, nach Feld. Ohne Eintrag gilt
  // die Breite aus js/quizColumns.js.
  breiten: {},
  // Von Hand gesetzte Spaltenreihenfolge (Feldnamen). null = Standard aus
  // js/quizColumns.js.
  reihenfolge: null,
};

// Auf- und zugeklappt: nur was jemand von Hand umgeschaltet hat. Ohne Eintrag
// gilt gruppeStandardOffen(). Wird bei jedem Filterwechsel geleert.
const geklappt = new Map();
// IDs (als String) der Fragen mit aufgeklappten Details bzw. im Kästchen.
const offeneDetails = new Set();
const auswahl = new Set();
// Gruppenschlüssel des letzten Zeichnens – für "Alle auf/zu".
let gruppenSchluessel = [];
let sammelLaeuft = false;

let oeffneImFormular = () => {};

function leseEinstellungen() {
  try {
    const gespeichert = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof gespeichert.set === "string") state.set = gespeichert.set;
    if (Array.isArray(gespeichert.custom)) state.custom = gespeichert.custom;
    if (typeof gespeichert.status === "string") state.status = gespeichert.status;
    if (Array.isArray(gespeichert.reihenfolge)) state.reihenfolge = gespeichert.reihenfolge;
    if (gespeichert.breiten && typeof gespeichert.breiten === "object") {
      Object.entries(gespeichert.breiten).forEach(([feld, breite]) => {
        if (Number.isFinite(breite)) state.breiten[feld] = begrenzeBreite(breite);
      });
    }
  } catch {
    // Kaputter oder gesperrter localStorage: dann eben die Voreinstellung.
  }
}

function schreibeEinstellungen() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        set: state.set,
        custom: state.custom,
        status: state.status,
        breiten: state.breiten,
        reihenfolge: state.reihenfolge,
      })
    );
  } catch {
    // Speichern ist Komfort, kein Muss.
  }
}

function begrenzeBreite(breite) {
  return Math.round(Math.min(MAX_BREITE, Math.max(MIN_BREITE, breite)));
}

function spaltenBreite(spalte) {
  return state.breiten[spalte.field] ?? spalte.width;
}

// Bei table-layout: fixed braucht die Tabelle eine feste Gesamtbreite, sonst
// verteilt der Browser den Rest des Containers wieder auf alle Spalten.
function setzeTabellenBreite(spalten) {
  const summe = spalten.reduce((gesamt, spalte) => gesamt + spaltenBreite(spalte), 0);
  tableEl.style.width = `${summe}px`;
}

// Läuft gerade ein Ziehen? Dann wird nicht neu gezeichnet – das würde den
// Spaltenkopf unter dem Finger wegräumen.
let ziehtGerade = false;

function starteZiehen(event, th, spalte, spalten) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const griff = event.currentTarget;
  griff.setPointerCapture?.(event.pointerId);
  const startX = event.clientX;
  const startBreite = spaltenBreite(spalte);
  ziehtGerade = true;
  tableEl.classList.add("quiz-table-resizing");

  const bewege = (e) => {
    const breite = begrenzeBreite(startBreite + e.clientX - startX);
    state.breiten[spalte.field] = breite;
    th.style.width = `${breite}px`;
    setzeTabellenBreite(spalten);
  };
  const ende = () => {
    griff.removeEventListener("pointermove", bewege);
    griff.removeEventListener("pointerup", ende);
    griff.removeEventListener("pointercancel", ende);
    ziehtGerade = false;
    tableEl.classList.remove("quiz-table-resizing");
    schreibeEinstellungen();
    if (nachzuholen) {
      nachzuholen = false;
      render();
    }
  };
  griff.addEventListener("pointermove", bewege);
  griff.addEventListener("pointerup", ende);
  griff.addEventListener("pointercancel", ende);
}

// Klick nach einem Ziehen am Spaltennamen soll nicht auch noch sortieren.
let klickUnterdruecken = false;

// Umsortieren per Maus: erst ab ein paar Pixeln Weg gilt es als Ziehen,
// darunter bleibt es ein Klick (= sortieren). Finger nehmen die Pfeile unter
// "Spalten", siehe oben.
function starteUmsortieren(event, th, spalte) {
  klickUnterdruecken = false;
  if (spalte.field === "question" || event.pointerType === "touch" || event.button !== 0) return;
  const knopf = event.currentTarget;
  knopf.setPointerCapture?.(event.pointerId);
  const startX = event.clientX;
  let zieht = false;
  let ziel = null;

  const markierungWeg = () => {
    tableEl
      .querySelectorAll(".quiz-col-drop-before, .quiz-col-drop-after")
      .forEach((kopf) => kopf.classList.remove("quiz-col-drop-before", "quiz-col-drop-after"));
  };

  const bewege = (e) => {
    if (!zieht) {
      if (Math.abs(e.clientX - startX) < 8) return;
      zieht = true;
      ziehtGerade = true;
      tableEl.classList.add("quiz-table-reordering");
      th.classList.add("quiz-col-dragging");
    }
    markierungWeg();
    ziel = null;
    const treffer = [...tableEl.querySelectorAll("thead th")].find((kopf) => {
      const rahmen = kopf.getBoundingClientRect();
      return e.clientX >= rahmen.left && e.clientX < rahmen.right;
    });
    if (!treffer || treffer === th) return;
    const rahmen = treffer.getBoundingClientRect();
    // Über der Fragespalte heißt: so weit nach vorn wie möglich.
    const dahinter = treffer.dataset.field === "question" || e.clientX > rahmen.left + rahmen.width / 2;
    ziel = { feld: treffer.dataset.field, dahinter };
    treffer.classList.add(dahinter ? "quiz-col-drop-after" : "quiz-col-drop-before");
  };

  const ende = () => {
    knopf.removeEventListener("pointermove", bewege);
    knopf.removeEventListener("pointerup", ende);
    knopf.removeEventListener("pointercancel", ende);
    if (!zieht) return;
    klickUnterdruecken = true;
    ziehtGerade = false;
    markierungWeg();
    tableEl.classList.remove("quiz-table-reordering");
    th.classList.remove("quiz-col-dragging");
    if (ziel) verschiebeSpalte(spalte.field, ziel.feld, ziel.dahinter);
    nachzuholen = false;
    render();
  };
  knopf.addEventListener("pointermove", bewege);
  knopf.addEventListener("pointerup", ende);
  knopf.addEventListener("pointercancel", ende);
}

function baueGriff(th, spalte, spalten) {
  const griff = document.createElement("span");
  griff.className = "quiz-col-resizer";
  griff.title = t("ui.spaltenbreite_ziehen");
  griff.setAttribute("aria-hidden", "true");
  griff.addEventListener("pointerdown", (event) => starteZiehen(event, th, spalte, spalten));
  // Klick auf den Rand soll nicht sortieren und kein Kästchen umschalten.
  griff.addEventListener("click", (event) => event.stopPropagation());
  griff.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    delete state.breiten[spalte.field];
    schreibeEinstellungen();
    render();
  });
  return griff;
}

function istSchmal() {
  return window.matchMedia(NARROW_QUERY).matches;
}

function aktivesSetKey() {
  if (state.set) return state.set;
  return istSchmal() ? QUIZ_NARROW_SET : QUIZ_SETS[0].key;
}

// Alle Spalten in der aktuellen Reihenfolge. Felder, die in einer
// gespeicherten Reihenfolge fehlen (neue Spalte seit dem Speichern), hängen
// hinten an; unbekannte fallen weg. Die Frage steht immer vorn – sie ist die
// stehende Spalte und trägt die Kästchen.
function geordneteSpalten() {
  const felder = (state.reihenfolge ?? []).filter(
    (feld, index, liste) => quizColumnByField(feld) && liste.indexOf(feld) === index && feld !== "question"
  );
  QUIZ_COLUMNS.forEach((spalte) => {
    if (spalte.field !== "question" && !felder.includes(spalte.field)) felder.push(spalte.field);
  });
  return ["question", ...felder].map(quizColumnByField);
}

function istStandardReihenfolge() {
  return geordneteSpalten().every((spalte, index) => spalte === QUIZ_COLUMNS[index]);
}

// Schiebt `feld` vor bzw. hinter `zielFeld`. Hinter die Frage geht es nie.
function verschiebeSpalte(feld, zielFeld, dahinter) {
  if (feld === "question" || feld === zielFeld) return;
  const felder = geordneteSpalten().map((spalte) => spalte.field).filter((f) => f !== feld);
  let index = felder.indexOf(zielFeld);
  if (index < 0) return;
  if (dahinter) index += 1;
  felder.splice(Math.max(1, index), 0, feld);
  state.reihenfolge = felder;
  schreibeEinstellungen();
}

// Ein Schritt nach vorn oder hinten in der Gesamtliste (auch über
// ausgeblendete Spalten hinweg – sonst bliebe man an ihnen hängen, ohne es
// zu sehen).
function rueckeSpalte(feld, richtung) {
  const felder = geordneteSpalten().map((spalte) => spalte.field);
  const von = felder.indexOf(feld);
  const nach = von + richtung;
  if (von < 1 || nach < 1 || nach >= felder.length) return;
  [felder[von], felder[nach]] = [felder[nach], felder[von]];
  state.reihenfolge = felder;
  schreibeEinstellungen();
}

function sichtbareSpalten() {
  const key = aktivesSetKey();
  const felder =
    key === "eigene"
      ? state.custom ?? [QUIZ_COLUMNS[0].field]
      : (QUIZ_SETS.find((s) => s.key === key) ?? QUIZ_SETS[0]).fields;
  const ausgewaehlt = new Set(felder);
  ausgewaehlt.add("question");
  return geordneteSpalten().filter((spalte) => ausgewaehlt.has(spalte.field));
}

// Anzeigetext einer Zelle. Immer ein String – gesetzt wird er per
// textContent, nie als HTML (Fragen und Antworten sind Nutzereingaben).
function zellText(frage, spalte) {
  if (spalte.wert) return String(spalte.wert(frage) ?? "");
  const wert = frage[spalte.field];
  if (spalte.type === "bool") return wert ? t("ui.ja") : "";
  if (spalte.type === "date") return wert ? formatDate(wert) : "";
  if (spalte.type === "select") {
    const option = (spalte.options?.() ?? []).find((o) => String(o.value) === String(wert));
    return option ? option.label : (wert ?? "");
  }
  return wert == null ? "" : String(wert);
}

function sortSchluessel(frage, spalte) {
  if (spalte.field === "difficulty") return Number(frage.difficulty) || 0;
  const text = zellText(frage, spalte);
  return text === "" ? null : text.toLowerCase();
}

function sortiere(fragen, spalten) {
  const spalte = spalten.find((s) => s.field === state.sort.field) ?? spalten[0];
  const richtung = state.sort.dir === "desc" ? -1 : 1;
  return [...fragen].sort((a, b) => {
    const links = sortSchluessel(a, spalte);
    const rechts = sortSchluessel(b, spalte);
    if (links === null && rechts === null) return a.question.localeCompare(b.question, "de");
    if (links === null) return 1;
    if (rechts === null) return -1;
    if (links === rechts) return a.question.localeCompare(b.question, "de");
    if (typeof links === "number" && typeof rechts === "number") return (links - rechts) * richtung;
    return String(links).localeCompare(String(rechts), "de") * richtung;
  });
}

function passtZurSuche(frage, spalten, query) {
  if (!query) return true;
  const begriffe = query.toLowerCase().split(/\s+/).filter(Boolean);
  const heuhaufen = [frage.question, ...spalten.map((spalte) => zellText(frage, spalte))]
    .join(" ")
    .toLowerCase();
  return begriffe.every((begriff) => heuhaufen.includes(begriff));
}

function gefiltert(spalten) {
  return loadQuizQuestions()
    .filter((frage) => !state.topic || frage.topic === state.topic)
    .filter((frage) => !state.source || frage.source === state.source)
    .filter((frage) => {
      if (state.status === "aktiv") return frage.active !== false;
      if (state.status === "inaktiv") return frage.active === false;
      return true;
    })
    .filter((frage) => passtZurSuche(frage, spalten, state.query));
}

// Ohne Suche und Themenfilter wären alle offen ein paar tausend Zeilen – dann
// erst einmal nur die Gruppen. Mit Suche will man die Treffer sehen.
function gruppeStandardOffen() {
  return Boolean(state.query || state.topic);
}

function istOffen(schluessel) {
  return geklappt.has(schluessel) ? geklappt.get(schluessel) : gruppeStandardOffen();
}

function filterGeaendert() {
  geklappt.clear();
}

// Oberthema → Thema → Fragen. Die Fragen kommen schon sortiert herein und
// behalten ihre Reihenfolge; die Gruppen stehen alphabetisch.
function gruppiere(fragen) {
  const gruppen = new Map();
  fragen.forEach((frage) => {
    const ober = frage.parentTopic || frage.topic || "–";
    const thema = frage.topic || ober;
    if (!gruppen.has(ober)) gruppen.set(ober, new Map());
    const themen = gruppen.get(ober);
    if (!themen.has(thema)) themen.set(thema, []);
    themen.get(thema).push(frage);
  });
  const alphabetisch = ([a], [b]) => a.localeCompare(b, "de");
  return [...gruppen.entries()].sort(alphabetisch).map(([ober, themen]) => {
    const unter = [...themen.entries()].sort(alphabetisch).map(([thema, liste]) => ({
      schluessel: `t:${ober}\u0001${thema}`,
      label: thema,
      fragen: liste,
    }));
    return {
      schluessel: `o:${ober}`,
      label: ober,
      fragen: unter.flatMap((u) => u.fragen),
      // Produktfragen haben ein einziges Thema gleich dem Oberthema – eine
      // zweite Kopfzeile mit demselben Namen wäre nur Rauschen.
      unter: unter.length > 1 || unter[0].label !== ober ? unter : null,
    };
  });
}

// Geschrieben wird nur online und nur mit dem Recht, Fragen zu pflegen.
function darfSchreiben() {
  return !isOffline() && can("quiz.manage");
}

function aktualisiereHinweis() {
  if (!noteEl) return;
  let text = "";
  if (isOffline()) text = t("ui.offline_nur_lesen");
  else if (!can("quiz.manage")) text = t("ui.kein_schreibrecht_nur_lesen");
  noteEl.textContent = text;
  noteEl.hidden = !text;
}

// Vorschlagslisten: Themen aus dem Fragenbestand, Produkt- und Rezeptbezug aus
// dem Katalog. Der Bezug muss auf den Namen genau passen, sonst findet die
// Frage ihr Produkt nicht mehr – von Hand getippt geht das regelmäßig schief.
function vorschlaegeFuer(spalte) {
  if (spalte.field === "refProduct") return getAllProducts().map((p) => p.name);
  if (spalte.field === "refRecipe") return getAllRecipes().map((r) => r.name);
  return [...new Set(loadQuizQuestions().map((frage) => frage[spalte.field]).filter(Boolean))]
    .map(String)
    .sort((a, b) => a.localeCompare(b, "de"));
}

// saveQuizQuestion() setzt bei einer vorhandenen id edited = true: von Hand
// geänderte Fragen lässt der Katalog-Abgleich (js/quizSync.js) danach in Ruhe.
//
// Die Frage wird hier geholt und nicht beim Öffnen der Zelle: geschrieben wird
// der ganze Datensatz, und zwei schnell hintereinander geänderte Felder
// derselben Zeile würden sich sonst gegenseitig zurückdrehen.
async function speichereZelle(id, spalte, wert) {
  const aktuell = loadQuizQuestions().find((frage) => String(frage.id) === String(id));
  if (!aktuell) throw new Error(t("ui.eintrag_nicht_mehr_vorhanden"));
  await saveQuizQuestion({ ...aktuell, [spalte.field]: wert });
}

// Kästchen für eine Zeile oder eine ganze Gruppe. Halb gesetzt, wenn nur ein
// Teil der Gruppe ausgewählt ist.
function auswahlBox(ids, ariaLabel) {
  const wrap = document.createElement("label");
  wrap.className = "quiz-select";
  const box = document.createElement("input");
  box.type = "checkbox";
  const gewaehlt = ids.filter((id) => auswahl.has(id)).length;
  box.checked = ids.length > 0 && gewaehlt === ids.length;
  box.indeterminate = gewaehlt > 0 && gewaehlt < ids.length;
  box.disabled = ids.length === 0;
  box.setAttribute("aria-label", ariaLabel);
  box.addEventListener("change", () => {
    if (box.checked) ids.forEach((id) => auswahl.add(id));
    else ids.forEach((id) => auswahl.delete(id));
    render();
  });
  wrap.appendChild(box);
  return wrap;
}

function darfAuswaehlen() {
  return can("quiz.manage");
}

function baueKopf(spalten, trefferIds) {
  const thead = document.createElement("thead");
  const zeile = document.createElement("tr");
  spalten.forEach((spalte) => {
    const th = document.createElement("th");
    th.style.width = `${spaltenBreite(spalte)}px`;
    th.dataset.field = spalte.field;
    if (spalte.field === "question") {
      th.className = "catalog-sticky-col";
      if (darfAuswaehlen()) th.appendChild(auswahlBox(trefferIds, t("ui.alle_treffer_auswaehlen")));
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-sort-btn";
    btn.textContent = t(spalte.labelKey);
    if (state.sort.field === spalte.field) {
      const pfeil = document.createElement("i");
      pfeil.className = `ph ${state.sort.dir === "asc" ? "ph-caret-up" : "ph-caret-down"}`;
      pfeil.setAttribute("aria-hidden", "true");
      btn.appendChild(pfeil);
      th.setAttribute("aria-sort", state.sort.dir === "asc" ? "ascending" : "descending");
    }
    if (spalte.field !== "question") {
      btn.classList.add("quiz-col-movable");
      btn.title = t("ui.spalte_ziehen_zum_verschieben");
    }
    btn.addEventListener("pointerdown", (event) => starteUmsortieren(event, th, spalte));
    btn.addEventListener("click", () => {
      if (klickUnterdruecken) {
        klickUnterdruecken = false;
        return;
      }
      if (state.sort.field === spalte.field) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort = { field: spalte.field, dir: "asc" };
      }
      render();
    });

    th.appendChild(btn);
    th.appendChild(baueGriff(th, spalte, spalten));
    zeile.appendChild(th);
  });
  thead.appendChild(zeile);
  return thead;
}

function baueZelle(frage, spalte) {
  const td = document.createElement("td");
  const text = zellText(frage, spalte);
  td.dataset.id = frage.id;
  td.dataset.field = spalte.field;
  td.className = `catalog-cell catalog-cell-${spalte.type}`;

  if (spalte.field === "question") {
    td.classList.add("catalog-sticky-col");
    const id = String(frage.id);
    // Eigener Flex-Container: nur so kürzt eine schmal gezogene Spalte den
    // Fragetext mit "…" statt den ganzen Knopf wegzuschneiden.
    const inhalt = document.createElement("div");
    inhalt.className = "quiz-cell-flex";
    td.appendChild(inhalt);
    if (darfAuswaehlen()) inhalt.appendChild(auswahlBox([id], t("ui.auswaehlen")));

    const offen = offeneDetails.has(id);
    const klapp = document.createElement("button");
    klapp.type = "button";
    klapp.className = "quiz-toggle";
    klapp.setAttribute("aria-expanded", String(offen));
    klapp.setAttribute("aria-label", t(offen ? "ui.details_verbergen" : "ui.details_zeigen"));
    klapp.title = klapp.getAttribute("aria-label");
    const pfeil = document.createElement("i");
    pfeil.className = `ph ${offen ? "ph-caret-down" : "ph-caret-right"}`;
    pfeil.setAttribute("aria-hidden", "true");
    klapp.appendChild(pfeil);
    klapp.addEventListener("click", () => {
      if (offen) offeneDetails.delete(id);
      else offeneDetails.add(id);
      render();
    });
    inhalt.appendChild(klapp);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-name-btn";
    btn.textContent = frage.question;
    btn.title = t("ui.im_formular_oeffnen");
    btn.addEventListener("click", () => oeffneImFormular(frage));
    inhalt.appendChild(btn);
    return td;
  }

  if (istSpalteEditierbar(spalte) && darfSchreiben()) {
    td.classList.add("catalog-cell-editable");
  } else {
    td.classList.add("catalog-cell-locked");
  }
  setzeZellInhalt(td, text);
  return td;
}

function baueFragezeile(frage, spalten) {
  const zeile = document.createElement("tr");
  zeile.dataset.id = frage.id;
  if (frage.active === false) zeile.classList.add("quiz-row-inactive");
  spalten.forEach((spalte) => zeile.appendChild(baueZelle(frage, spalte)));
  return zeile;
}

// Alles zur Frage auf einen Blick, auch was in keiner sichtbaren Spalte
// steht. Nur Text – Fragen und Antworten sind Nutzereingaben.
function baueDetailzeile(frage, spalten) {
  const zeile = document.createElement("tr");
  zeile.className = "quiz-detail-row";
  if (frage.active === false) zeile.classList.add("quiz-row-inactive");
  const td = document.createElement("td");
  td.className = "quiz-detail-cell";
  td.colSpan = spalten.length;
  const box = document.createElement("div");
  box.className = "quiz-detail";

  const titel = document.createElement("p");
  titel.className = "quiz-detail-question";
  titel.textContent = frage.question;
  box.appendChild(titel);

  const liste = document.createElement("ol");
  liste.className = "quiz-detail-options";
  (frage.options ?? []).forEach((antwort, index) => {
    const li = document.createElement("li");
    li.textContent = antwort;
    if (index === frage.correctIndex) {
      li.classList.add("quiz-detail-correct");
      li.title = t("ui.richtige_antwort");
      const haken = document.createElement("i");
      haken.className = "ph ph-check";
      haken.setAttribute("aria-label", t("ui.richtige_antwort"));
      li.prepend(haken, " ");
    }
    liste.appendChild(li);
  });
  box.appendChild(liste);

  const angaben = [
    ["ui.erklaerung", frage.explanation],
    ["ui.thema", [frage.parentTopic, frage.topic].filter(Boolean).filter((w, i, a) => a.indexOf(w) === i).join(" › ")],
    ["ui.produkt", frage.refProduct],
    ["ui.rezept", frage.refRecipe],
    ["ui.quelle", frage.source === "generator" ? t("ui.generiert") : t("ui.kuratiert")],
  ];
  angaben.forEach(([labelKey, wert]) => {
    if (!wert) return;
    const p = document.createElement("p");
    const label = document.createElement("strong");
    label.textContent = `${t(labelKey)}: `;
    p.append(label, String(wert));
    box.appendChild(p);
  });

  td.appendChild(box);
  zeile.appendChild(td);
  return zeile;
}

function baueGruppenzeile(gruppe, ebene, spalten) {
  const zeile = document.createElement("tr");
  zeile.className = `quiz-group-row quiz-group-level-${ebene}`;
  const td = document.createElement("td");
  td.className = "catalog-sticky-col";
  const inhalt = document.createElement("div");
  inhalt.className = "quiz-cell-flex";
  td.appendChild(inhalt);

  if (darfAuswaehlen()) {
    inhalt.appendChild(auswahlBox(gruppe.fragen.map((frage) => String(frage.id)), t("ui.gruppe_auswaehlen", { name: gruppe.label })));
  }

  const offen = istOffen(gruppe.schluessel);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "quiz-group-toggle";
  btn.setAttribute("aria-expanded", String(offen));
  const pfeil = document.createElement("i");
  pfeil.className = `ph ${offen ? "ph-caret-down" : "ph-caret-right"}`;
  pfeil.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "quiz-group-name";
  name.textContent = gruppe.label;
  const anzahl = document.createElement("span");
  anzahl.className = "quiz-group-count";
  anzahl.textContent = String(gruppe.fragen.length);
  btn.append(pfeil, name, anzahl);
  btn.addEventListener("click", () => {
    geklappt.set(gruppe.schluessel, !offen);
    render();
  });
  inhalt.appendChild(btn);
  zeile.appendChild(td);

  if (spalten.length > 1) {
    const rest = document.createElement("td");
    rest.colSpan = spalten.length - 1;
    zeile.appendChild(rest);
  }
  return zeile;
}

function baueKoerper(gruppen, spalten) {
  const tbody = document.createElement("tbody");
  const fragment = document.createDocumentFragment();
  let gezeichnet = 0;
  let gedeckelt = false;

  const zeichneFragen = (fragen) => {
    for (const frage of fragen) {
      if (gezeichnet >= MAX_ZEILEN) {
        gedeckelt = true;
        return;
      }
      fragment.appendChild(baueFragezeile(frage, spalten));
      if (offeneDetails.has(String(frage.id))) fragment.appendChild(baueDetailzeile(frage, spalten));
      gezeichnet += 1;
    }
  };

  gruppen.forEach((gruppe) => {
    fragment.appendChild(baueGruppenzeile(gruppe, 1, spalten));
    if (!istOffen(gruppe.schluessel)) return;
    if (!gruppe.unter) {
      zeichneFragen(gruppe.fragen);
      return;
    }
    gruppe.unter.forEach((thema) => {
      fragment.appendChild(baueGruppenzeile(thema, 2, spalten));
      if (istOffen(thema.schluessel)) zeichneFragen(thema.fragen);
    });
  });

  tbody.appendChild(fragment);
  return { tbody, gedeckelt };
}

// Leiste über der Tabelle, sobald etwas ausgewählt ist.
function aktualisiereSammelleiste() {
  if (!bulkEl) return;
  bulkEl.hidden = auswahl.size === 0 || !darfAuswaehlen();
  if (bulkCountEl) bulkCountEl.textContent = t("ui.n_ausgewaehlt", { n: auswahl.size });
  const gesperrt = sammelLaeuft || !darfSchreiben();
  [bulkDeactivateEl, bulkActivateEl, bulkDeleteEl].forEach((btn) => {
    if (btn) btn.disabled = gesperrt;
  });
}

function zeigeSammelHinweis(text, fehler = false) {
  if (!bulkNoteEl) return;
  bulkNoteEl.textContent = text;
  bulkNoteEl.className = fehler ? "error-note" : "hint";
  bulkNoteEl.hidden = !text;
}

async function sammelAktion(aktion) {
  if (sammelLaeuft || !auswahl.size || !darfSchreiben()) return;
  sammelLaeuft = true;
  // Nach dem Schreiben werden alle Fragen neu geladen – das dauert ein paar
  // Sekunden, und so lange soll niemand glauben, der Knopf hätte nichts getan.
  zeigeSammelHinweis(t("ui.wird_gespeichert"));
  aktualisiereSammelleiste();
  try {
    const meldung = await aktion([...auswahl]);
    auswahl.clear();
    zeigeSammelHinweis(meldung);
  } catch (error) {
    zeigeSammelHinweis(t("ui.quiz_sammelaktion_fehlgeschlagen") + (error?.message ?? ""), true);
  } finally {
    sammelLaeuft = false;
    render();
  }
}

function bestaetigeLoeschen() {
  const generiert = loadQuizQuestions().filter(
    (frage) => auswahl.has(String(frage.id)) && frage.source === "generator"
  ).length;
  let frage = t("ui.quiz_n_fragen_loeschen", { n: auswahl.size });
  if (generiert) frage += `\n\n${t("ui.quiz_generierte_kommen_wieder", { n: generiert })}`;
  return confirm(frage);
}

async function loescheAuswahl(ids) {
  await deleteQuizQuestions(ids);
  return t("ui.quiz_n_geloescht", { n: ids.length });
}

async function schalteAuswahl(ids, aktiv) {
  await setQuizQuestionsActive(ids, aktiv, { vonHand: true });
  return t(aktiv ? "ui.quiz_n_eingeschaltet" : "ui.quiz_n_abgeschaltet", { n: ids.length });
}

function fuelleAuswahl(el, werte, alleLabel, aktuell) {
  if (!el) return;
  el.textContent = "";
  const alle = document.createElement("option");
  alle.value = "";
  alle.textContent = alleLabel;
  el.appendChild(alle);
  werte.forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    el.appendChild(option);
  });
  el.value = aktuell;
}

function fuelleFilter() {
  const themen = [...new Set(loadQuizQuestions().map((f) => f.topic).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "de")
  );
  if (!themen.includes(state.topic)) state.topic = "";
  fuelleAuswahl(
    topicEl,
    themen.map((thema) => ({ value: thema, label: thema })),
    t("ui.alle_themen"),
    state.topic
  );
  fuelleAuswahl(
    sourceEl,
    [
      { value: "generator", label: t("ui.generiert") },
      { value: "kuratiert", label: t("ui.kuratiert") },
    ],
    t("ui.alle_quellen"),
    state.source
  );

  if (statusEl) {
    statusEl.textContent = "";
    [
      { value: "aktiv", label: t("ui.nur_aktive") },
      { value: "inaktiv", label: t("ui.nur_abgeschaltete") },
      { value: "alle", label: t("ui.alle_fragen") },
    ].forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      statusEl.appendChild(option);
    });
    statusEl.value = state.status;
  }
}

function fuelleSets() {
  if (!setEl) return;
  const aktiv = aktivesSetKey();
  setEl.textContent = "";
  QUIZ_SETS.forEach((satz) => {
    const option = document.createElement("option");
    option.value = satz.key;
    option.textContent = t(satz.labelKey);
    setEl.appendChild(option);
  });
  const eigene = document.createElement("option");
  eigene.value = "eigene";
  eigene.textContent = t("ui.eigene_auswahl");
  setEl.appendChild(eigene);
  setEl.value = aktiv;
}

function fuelleSpaltenAuswahl() {
  if (!columnsPopEl) return;
  const sichtbar = new Set(sichtbareSpalten().map((spalte) => spalte.field));
  // Neu gezeichnet wird auch beim Rücken mit den Pfeilen – ohne das hier
  // spränge die Liste dabei jedes Mal nach oben.
  const scrollPos = columnsPopEl.scrollTop;
  columnsPopEl.textContent = "";
  const geordnet = geordneteSpalten();
  geordnet.forEach((spalte, index) => {
    const reihe = document.createElement("div");
    reihe.className = "quiz-column-row";

    const label = document.createElement("label");
    label.className = "catalog-column-option";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = sichtbar.has(spalte.field);
    // Die Fragespalte trägt die Zeile – sie lässt sich nicht abwählen.
    box.disabled = spalte.field === "question";
    box.addEventListener("change", () => {
      const felder = new Set(sichtbareSpalten().map((s) => s.field));
      if (box.checked) felder.add(spalte.field);
      else felder.delete(spalte.field);
      state.custom = geordneteSpalten().map((s) => s.field).filter((feld) => felder.has(feld));
      state.set = "eigene";
      schreibeEinstellungen();
      render();
    });

    const text = document.createElement("span");
    text.textContent = t(spalte.labelKey);

    label.append(box, text);
    reihe.appendChild(label);

    // Pfeile: der Weg zum Umsortieren auf dem Handy und per Tastatur.
    [
      { richtung: -1, icon: "ph-arrow-up", labelKey: "ui.spalte_nach_vorne" },
      { richtung: 1, icon: "ph-arrow-down", labelKey: "ui.spalte_nach_hinten" },
    ].forEach(({ richtung, icon, labelKey }) => {
      const pfeil = document.createElement("button");
      pfeil.type = "button";
      pfeil.className = "quiz-column-move";
      pfeil.dataset.field = spalte.field;
      pfeil.dataset.richtung = String(richtung);
      pfeil.setAttribute("aria-label", `${t(spalte.labelKey)}: ${t(labelKey)}`);
      pfeil.title = t(labelKey);
      const ziel = index + richtung;
      pfeil.disabled = spalte.field === "question" || ziel < 1 || ziel >= geordnet.length;
      const symbol = document.createElement("i");
      symbol.className = `ph ${icon}`;
      symbol.setAttribute("aria-hidden", "true");
      pfeil.appendChild(symbol);
      pfeil.addEventListener("click", () => {
        rueckeSpalte(spalte.field, richtung);
        render();
        // Der Knopf ist nach dem Neuzeichnen ein neuer – Fokus mitnehmen,
        // damit man mit der Tastatur mehrmals hintereinander rücken kann.
        const neu = columnsPopEl.querySelector(
          `.quiz-column-move[data-field="${CSS.escape(spalte.field)}"][data-richtung="${richtung}"]`
        );
        if (neu && !neu.disabled) neu.focus();
      });
      reihe.appendChild(pfeil);
    });

    columnsPopEl.appendChild(reihe);
  });

  const reihenfolgeZurueck = document.createElement("button");
  reihenfolgeZurueck.type = "button";
  reihenfolgeZurueck.className = "btn-secondary quiz-columns-reset";
  reihenfolgeZurueck.textContent = t("ui.spaltenreihenfolge_zuruecksetzen");
  reihenfolgeZurueck.disabled = istStandardReihenfolge();
  reihenfolgeZurueck.addEventListener("click", () => {
    state.reihenfolge = null;
    schreibeEinstellungen();
    render();
  });
  columnsPopEl.appendChild(reihenfolgeZurueck);

  const zuruecksetzen = document.createElement("button");
  zuruecksetzen.type = "button";
  zuruecksetzen.className = "btn-secondary quiz-columns-reset";
  zuruecksetzen.textContent = t("ui.spaltenbreiten_zuruecksetzen");
  zuruecksetzen.disabled = Object.keys(state.breiten).length === 0;
  zuruecksetzen.addEventListener("click", () => {
    state.breiten = {};
    schreibeEinstellungen();
    render();
  });
  columnsPopEl.appendChild(zuruecksetzen);
  columnsPopEl.scrollTop = scrollPos;
}

export function render() {
  if (!tableEl) return;
  const spalten = sichtbareSpalten();
  if (!spalten.some((spalte) => spalte.field === state.sort.field)) {
    state.sort = { field: "question", dir: "asc" };
  }
  const treffer = sortiere(gefiltert(spalten), spalten);
  const trefferIds = treffer.map((frage) => String(frage.id));
  // Ausgewählt bleibt nur, was gerade zu sehen ist (Filter, Suche) – sonst
  // träfe "Löschen" Fragen, die niemand mehr vor Augen hat.
  const sichtbarIds = new Set(trefferIds);
  [...auswahl].forEach((id) => {
    if (!sichtbarIds.has(id)) auswahl.delete(id);
  });
  const gruppen = gruppiere(treffer);
  gruppenSchluessel = gruppen.flatMap((g) => [g.schluessel, ...(g.unter ?? []).map((u) => u.schluessel)]);

  fuelleSets();
  fuelleFilter();
  fuelleSpaltenAuswahl();
  aktualisiereHinweis();

  tableEl.textContent = "";
  setzeTabellenBreite(spalten);
  tableEl.appendChild(baueKopf(spalten, trefferIds));
  const { tbody, gedeckelt } = baueKoerper(gruppen, spalten);
  tableEl.appendChild(tbody);
  zeichneFehlerNeu(tableEl);
  aktualisiereSammelleiste();

  if (countEl) {
    const gesamt = loadQuizQuestions().length;
    countEl.textContent = gedeckelt
      ? `${treffer.length} ${t("ui.von")} ${gesamt} – ${t("ui.quiz_erste_n_zeilen", { n: MAX_ZEILEN })}`
      : `${treffer.length} ${t("ui.von")} ${gesamt}`;
  }
  if (searchEl) searchEl.placeholder = t("ui.in_sichtbaren_spalten_suchen");
}

// Merkt sich, dass während einer offenen Zelle eine Änderung hereinkam.
let nachzuholen = false;

function renderWennFrei() {
  if (istBearbeitungOffen() || ziehtGerade) {
    nachzuholen = true;
    return;
  }
  render();
}

// `onOpen` bekommt die Frage, die im Formular landen soll.
export function initQuizTable(onOpen) {
  if (!tableEl) return;
  oeffneImFormular = typeof onOpen === "function" ? onOpen : () => {};
  leseEinstellungen();

  initCellEditing(tableEl, {
    tabellenId: "quiz",
    schluesselAttribut: "id",
    spalte: quizColumnByField,
    eintrag: (id) => loadQuizQuestions().find((frage) => String(frage.id) === String(id)) ?? null,
    text: zellText,
    darfSchreiben,
    sperrhinweis: aktualisiereHinweis,
    vorschlaege: vorschlaegeFuer,
    speichern: speichereZelle,
  });

  let suchTimer = null;
  searchEl?.addEventListener("input", () => {
    clearTimeout(suchTimer);
    suchTimer = setTimeout(() => {
      state.query = searchEl.value.trim();
      filterGeaendert();
      render();
    }, 150);
  });

  topicEl?.addEventListener("change", () => {
    state.topic = topicEl.value;
    filterGeaendert();
    render();
  });
  sourceEl?.addEventListener("change", () => {
    state.source = sourceEl.value;
    filterGeaendert();
    render();
  });
  statusEl?.addEventListener("change", () => {
    state.status = statusEl.value;
    filterGeaendert();
    schreibeEinstellungen();
    render();
  });
  setEl?.addEventListener("change", () => {
    state.set = setEl.value;
    schreibeEinstellungen();
    render();
  });

  const klappeAlle = (offen) => {
    gruppenSchluessel.forEach((schluessel) => geklappt.set(schluessel, offen));
    render();
  };
  expandAllEl?.addEventListener("click", () => klappeAlle(true));
  collapseAllEl?.addEventListener("click", () => klappeAlle(false));

  bulkDeactivateEl?.addEventListener("click", () => sammelAktion((ids) => schalteAuswahl(ids, false)));
  bulkActivateEl?.addEventListener("click", () => sammelAktion((ids) => schalteAuswahl(ids, true)));
  bulkDeleteEl?.addEventListener("click", () => {
    if (sammelLaeuft || !auswahl.size || !bestaetigeLoeschen()) return;
    sammelAktion(loescheAuswahl);
  });
  bulkClearEl?.addEventListener("click", () => {
    auswahl.clear();
    zeigeSammelHinweis("");
    render();
  });

  columnsBtnEl?.addEventListener("click", () => {
    const offen = !columnsPopEl.hidden;
    columnsPopEl.hidden = offen;
    columnsBtnEl.setAttribute("aria-expanded", String(!offen));
  });
  document.addEventListener("click", (event) => {
    if (!columnsPopEl || columnsPopEl.hidden) return;
    // composedPath statt contains: ein Klick auf die Pfeile zeichnet das Menü
    // neu, und der geklickte Knopf hängt danach nicht mehr im Dokument.
    const pfad = event.composedPath();
    if (pfad.includes(columnsPopEl) || (columnsBtnEl && pfad.includes(columnsBtnEl))) return;
    columnsPopEl.hidden = true;
    columnsBtnEl?.setAttribute("aria-expanded", "false");
  });

  // Nie neu zeichnen, solange jemand in einer Zelle tippt – das Neuzeichnen
  // würde das Eingabefeld mitsamt Inhalt wegräumen. Ein Sync-Lauf schreibt
  // tausende Zeilen, und genau der trifft sonst mitten in eine Eingabe.
  onQuizQuestionsChanged(renderWennFrei);
  onLanguageChanged(renderWennFrei);
  beiBearbeitungEnde(() => {
    if (!nachzuholen) return;
    nachzuholen = false;
    render();
  });
  const netzWechsel = () => {
    aktualisiereHinweis();
    renderWennFrei();
  };
  window.addEventListener("online", netzWechsel);
  window.addEventListener("offline", netzWechsel);
  render();
}
