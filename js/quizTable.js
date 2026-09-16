import { loadQuizQuestions, onQuizQuestionsChanged } from "./storage.js";
import { formatDate, onLanguageChanged, t } from "./i18n.js";
import { QUIZ_COLUMNS, QUIZ_SETS, QUIZ_NARROW_SET } from "./quizColumns.js";

// Fragentabelle im Adminbereich (Sub-Tab "admin-quiz").
//
// Gleiche Optik und Bedienung wie die Katalogtabelle (js/adminTable.js):
// Spaltensets, Suche über die sichtbaren Spalten, Filter, Sortierung per
// Spaltenkopf, stehende erste Spalte. Die Fragespalte ist der Anker – ein
// Klick lädt die Frage in das Formular darunter.
//
// Unterschied zur Katalogtabelle: hier stehen ein paar tausend Zeilen statt
// ein paar hundert. Deshalb der Render-Deckel unten – der Browser soll die
// Tabelle zeichnen, nicht daran ersticken.

const searchEl = document.getElementById("quiz-table-search");
const topicEl = document.getElementById("quiz-table-topic");
const sourceEl = document.getElementById("quiz-table-source");
const statusEl = document.getElementById("quiz-table-status");
const setEl = document.getElementById("quiz-table-set");
const columnsBtnEl = document.getElementById("quiz-table-columns-btn");
const columnsPopEl = document.getElementById("quiz-table-columns-pop");
const countEl = document.getElementById("quiz-table-count");
const tableEl = document.getElementById("quiz-table");

const STORAGE_KEY = "bartool.quizTable";
const NARROW_QUERY = "(max-width: 700px)";
const CELL_MAX = 120;
// Mehr Zeilen zeichnet niemand mehr durch; wer eine bestimmte Frage sucht,
// sucht sie über Suchfeld und Filter, nicht durch Scrollen.
const MAX_ZEILEN = 300;

const state = {
  set: null,
  custom: null,
  topic: "",
  source: "",
  status: "aktiv",
  query: "",
  sort: { field: "question", dir: "asc" },
};

let oeffneImFormular = () => {};

function leseEinstellungen() {
  try {
    const gespeichert = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof gespeichert.set === "string") state.set = gespeichert.set;
    if (Array.isArray(gespeichert.custom)) state.custom = gespeichert.custom;
    if (typeof gespeichert.status === "string") state.status = gespeichert.status;
  } catch {
    // Kaputter oder gesperrter localStorage: dann eben die Voreinstellung.
  }
}

function schreibeEinstellungen() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ set: state.set, custom: state.custom, status: state.status })
    );
  } catch {
    // Speichern ist Komfort, kein Muss.
  }
}

function istSchmal() {
  return window.matchMedia(NARROW_QUERY).matches;
}

function aktivesSetKey() {
  if (state.set) return state.set;
  return istSchmal() ? QUIZ_NARROW_SET : QUIZ_SETS[0].key;
}

function sichtbareSpalten() {
  const key = aktivesSetKey();
  const felder =
    key === "eigene"
      ? state.custom ?? [QUIZ_COLUMNS[0].field]
      : (QUIZ_SETS.find((s) => s.key === key) ?? QUIZ_SETS[0]).fields;
  const ausgewaehlt = new Set(felder);
  ausgewaehlt.add("question");
  return QUIZ_COLUMNS.filter((spalte) => ausgewaehlt.has(spalte.field));
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

function baueKopf(spalten) {
  const thead = document.createElement("thead");
  const zeile = document.createElement("tr");
  spalten.forEach((spalte) => {
    const th = document.createElement("th");
    th.style.minWidth = `${spalte.width}px`;
    if (spalte.field === "question") th.className = "catalog-sticky-col";

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
    btn.addEventListener("click", () => {
      if (state.sort.field === spalte.field) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort = { field: spalte.field, dir: "asc" };
      }
      render();
    });

    th.appendChild(btn);
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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-name-btn";
    btn.textContent = frage.question;
    btn.title = t("ui.im_formular_oeffnen");
    btn.addEventListener("click", () => oeffneImFormular(frage));
    td.appendChild(btn);
    return td;
  }

  if (spalte.type === "readonly") td.classList.add("catalog-cell-locked");
  if (text.length > CELL_MAX) {
    td.textContent = `${text.slice(0, CELL_MAX)}…`;
    td.title = text;
  } else {
    td.textContent = text;
  }
  return td;
}

function baueKoerper(fragen, spalten) {
  const tbody = document.createElement("tbody");
  const fragment = document.createDocumentFragment();
  fragen.forEach((frage) => {
    const zeile = document.createElement("tr");
    zeile.dataset.id = frage.id;
    if (frage.active === false) zeile.classList.add("quiz-row-inactive");
    spalten.forEach((spalte) => zeile.appendChild(baueZelle(frage, spalte)));
    fragment.appendChild(zeile);
  });
  tbody.appendChild(fragment);
  return tbody;
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
  columnsPopEl.textContent = "";
  QUIZ_COLUMNS.forEach((spalte) => {
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
      state.custom = QUIZ_COLUMNS.map((s) => s.field).filter((feld) => felder.has(feld));
      state.set = "eigene";
      schreibeEinstellungen();
      render();
    });

    const text = document.createElement("span");
    text.textContent = t(spalte.labelKey);

    label.append(box, text);
    columnsPopEl.appendChild(label);
  });
}

export function render() {
  if (!tableEl) return;
  const spalten = sichtbareSpalten();
  if (!spalten.some((spalte) => spalte.field === state.sort.field)) {
    state.sort = { field: "question", dir: "asc" };
  }
  const treffer = sortiere(gefiltert(spalten), spalten);
  const sichtbar = treffer.slice(0, MAX_ZEILEN);

  fuelleSets();
  fuelleFilter();
  fuelleSpaltenAuswahl();

  tableEl.textContent = "";
  tableEl.appendChild(baueKopf(spalten));
  tableEl.appendChild(baueKoerper(sichtbar, spalten));

  if (countEl) {
    const gesamt = loadQuizQuestions().length;
    countEl.textContent =
      treffer.length > sichtbar.length
        ? `${sichtbar.length} ${t("ui.von")} ${treffer.length} – ${t("ui.bitte_weiter_einschraenken")}`
        : `${treffer.length} ${t("ui.von")} ${gesamt}`;
  }
  if (searchEl) searchEl.placeholder = t("ui.in_sichtbaren_spalten_suchen");
}

// `onOpen` bekommt die Frage, die im Formular landen soll.
export function initQuizTable(onOpen) {
  if (!tableEl) return;
  oeffneImFormular = typeof onOpen === "function" ? onOpen : () => {};
  leseEinstellungen();

  let suchTimer = null;
  searchEl?.addEventListener("input", () => {
    clearTimeout(suchTimer);
    suchTimer = setTimeout(() => {
      state.query = searchEl.value.trim();
      render();
    }, 150);
  });

  topicEl?.addEventListener("change", () => {
    state.topic = topicEl.value;
    render();
  });
  sourceEl?.addEventListener("change", () => {
    state.source = sourceEl.value;
    render();
  });
  statusEl?.addEventListener("change", () => {
    state.status = statusEl.value;
    schreibeEinstellungen();
    render();
  });
  setEl?.addEventListener("change", () => {
    state.set = setEl.value;
    schreibeEinstellungen();
    render();
  });

  columnsBtnEl?.addEventListener("click", () => {
    const offen = !columnsPopEl.hidden;
    columnsPopEl.hidden = offen;
    columnsBtnEl.setAttribute("aria-expanded", String(!offen));
  });
  document.addEventListener("click", (event) => {
    if (!columnsPopEl || columnsPopEl.hidden) return;
    if (columnsPopEl.contains(event.target) || columnsBtnEl?.contains(event.target)) return;
    columnsPopEl.hidden = true;
    columnsBtnEl?.setAttribute("aria-expanded", "false");
  });

  onQuizQuestionsChanged(render);
  onLanguageChanged(render);
  render();
}
