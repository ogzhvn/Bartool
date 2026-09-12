import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { onProductsChanged, onRecipesChanged, isOffline, saveProduct, saveRecipe } from "./storage.js";
import { openProductForEdit } from "./products.js";
import { openRecipeForEdit } from "./recipes.js";
import { switchTab, setPendingEditReturn, registerTabGuard } from "./tabs.js";
import { can } from "./auth.js";
import { t, onLanguageChanged } from "./i18n.js";
import { columnsFor, setsFor, columnByField, NARROW_SETS } from "./catalogColumns.js";
import {
  anzeigeText,
  baueEditor,
  istEditierbarerTyp,
  kuerze,
  leseEditor,
  normalisiere,
} from "./catalogCell.js";

// Katalogtabelle (Adminbereich, Sub-Tab "admin-catalog").
//
// Die Bibliotheks-Tabs zeigen einen Eintrag nach dem anderen – gut zum
// Nachschlagen hinterm Tresen, mühsam beim Pflegen. Hier liegt derselbe
// Bestand als Tabelle: alle Zeilen untereinander, die gewünschten Felder
// nebeneinander, ohne für jedes Feld ein Formular zu öffnen.
//
// Etappe 2 (dieser Stand) bearbeitet in der Zelle: Klick oder Tippen öffnet
// genau ein Eingabefeld, Änderungen sammeln sich in einem Puffer und gehen
// erst auf Knopfdruck gebündelt in die Datenbank. Geschrieben wird
// ausschließlich über saveProduct()/saveRecipe() aus js/storage.js – sonst
// fehlen Änderungsverlauf, Preishistorie und Sync.
//
// Bereichsauswahl, Einfügen aus Excel und Suchen & Ersetzen kommen in
// Etappe 3.

const panelEl = document.getElementById("admin-catalog");
const kindBtnsEl = document.getElementById("catalog-kind-switch");
const searchEl = document.getElementById("catalog-search");
const filterEl = document.getElementById("catalog-filter");
const setEl = document.getElementById("catalog-set");
const columnsBtnEl = document.getElementById("catalog-columns-btn");
const columnsPopEl = document.getElementById("catalog-columns-pop");
const countEl = document.getElementById("catalog-count");
const noteEl = document.getElementById("catalog-note");
const staleEl = document.getElementById("catalog-stale");
const tableEl = document.getElementById("catalog-table");
const listsEl = document.getElementById("catalog-datalists");
const saveBarEl = document.getElementById("catalog-savebar");
const dirtyCountEl = document.getElementById("catalog-dirty-count");
const progressEl = document.getElementById("catalog-progress");
const saveBtnEl = document.getElementById("catalog-save-btn");
const discardBtnEl = document.getElementById("catalog-discard-btn");

const STORAGE_KEY = "bartool.catalogTable";
const NARROW_QUERY = "(max-width: 700px)";

// Quelle, die in der Preishistorie landet, wenn hier ein Einkaufspreis
// geändert wird. Inhalt bleibt deutsch (siehe CLAUDE.md, Regel 11).
const PREIS_QUELLE = "Katalogtabelle";

const state = {
  kind: "products",
  set: { products: null, recipes: null },
  custom: { products: null, recipes: null },
  filter: "",
  query: "",
  sort: { field: "name", dir: "asc" },
};

// Offene Änderungen, getrennt nach Art der Datensätze: wer zwischen Produkten
// und Rezepten umschaltet, soll seine Eingaben nicht verlieren.
//   dirty     – Map<name, Map<feld, wert>> mit fertig geprüften Werten
//   ungueltig – Map<name, Map<feld, rohtext>> für alles, was nicht parst
//   fehler    – Map<name, text> mit dem Fehler des letzten Speicherlaufs
const puffer = {
  products: { dirty: new Map(), ungueltig: new Map(), fehler: new Map() },
  recipes: { dirty: new Map(), ungueltig: new Map(), fehler: new Map() },
};

let offenerEditor = null;
let speichertGerade = false;
let externGeaendert = false;
// Vorschlagslisten je Spalte, pro Render einmal gebaut.
const listenCache = new Map();

function buch(kind = state.kind) {
  return puffer[kind];
}

function leseEinstellungen() {
  try {
    const gespeichert = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (gespeichert.kind === "recipes" || gespeichert.kind === "products") state.kind = gespeichert.kind;
    ["products", "recipes"].forEach((kind) => {
      if (typeof gespeichert.set?.[kind] === "string") state.set[kind] = gespeichert.set[kind];
      if (Array.isArray(gespeichert.custom?.[kind])) state.custom[kind] = gespeichert.custom[kind];
    });
  } catch {
    // Kaputter oder gesperrter localStorage: dann eben die Voreinstellung.
  }
}

function schreibeEinstellungen() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ kind: state.kind, set: state.set, custom: state.custom })
    );
  } catch {
    // Speichern ist Komfort, kein Muss – ein privater Tab darf das ablehnen.
  }
}

function istSchmal() {
  return window.matchMedia(NARROW_QUERY).matches;
}

function aktivesSetKey() {
  const gespeichert = state.set[state.kind];
  if (gespeichert) return gespeichert;
  return istSchmal() ? NARROW_SETS[state.kind] : setsFor(state.kind)[0].key;
}

// Welche Spalten stehen gerade in der Tabelle? Entweder das gewählte Set oder
// die eigene Auswahl. "name" ist immer dabei – ohne Namensspalte wäre keine
// Zeile mehr zuzuordnen.
function sichtbareSpalten() {
  const alle = columnsFor(state.kind);
  const key = aktivesSetKey();
  const felder =
    key === "eigene"
      ? state.custom[state.kind] ?? [alle[0].field]
      : (setsFor(state.kind).find((s) => s.key === key) ?? setsFor(state.kind)[0]).fields;
  const ausgewaehlt = new Set(felder);
  ausgewaehlt.add("name");
  return alle.filter((spalte) => ausgewaehlt.has(spalte.field));
}

function alleEintraege() {
  return state.kind === "recipes" ? getAllRecipes() : getAllProducts();
}

function eintragNach(name) {
  return alleEintraege().find((eintrag) => eintrag.name === name) ?? null;
}

// Das Filterfeld über der Tabelle: bei Produkten die Gruppe (Gin, Whisky …),
// bei Rezepten die Kategorie. Beides ist das, wonach man beim Pflegen sucht.
function filterFeld() {
  return state.kind === "recipes" ? "category" : "group";
}

// ---------------------------------------------------------------------
// Werte: Puffer schlägt Datenbank
// ---------------------------------------------------------------------

function aktuellerWert(eintrag, spalte) {
  const gepuffert = buch().dirty.get(eintrag.name);
  if (gepuffert?.has(spalte.field)) return gepuffert.get(spalte.field);
  return eintrag[spalte.field];
}

function rohUngueltig(name, field) {
  return buch().ungueltig.get(name)?.get(field);
}

function zellText(eintrag, spalte) {
  const roh = rohUngueltig(eintrag.name, spalte.field);
  if (roh !== undefined) return roh;
  return anzeigeText(aktuellerWert(eintrag, spalte), spalte, eintrag);
}

function gleich(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const links = Array.isArray(a) ? a : [];
    const rechts = Array.isArray(b) ? b : [];
    return links.length === rechts.length && links.every((wert, i) => wert === rechts[i]);
  }
  return a === b;
}

function setzeWert(name, spalte, roh) {
  const eintrag = eintragNach(name);
  if (!eintrag) return;
  const { dirty, ungueltig } = buch();
  const { ok, wert } = normalisiere(roh, spalte);

  if (!ok) {
    if (!ungueltig.has(name)) ungueltig.set(name, new Map());
    ungueltig.get(name).set(spalte.field, String(roh ?? ""));
    return;
  }

  const ungueltigeZeile = ungueltig.get(name);
  if (ungueltigeZeile) {
    ungueltigeZeile.delete(spalte.field);
    if (ungueltigeZeile.size === 0) ungueltig.delete(name);
  }

  // Zurück auf den Ursprungswert getippt? Dann ist die Zelle nicht mehr
  // geändert – sonst stünde "1 Änderung" da, die keine ist.
  if (gleich(wert, eintrag[spalte.field])) {
    const zeile = dirty.get(name);
    if (zeile) {
      zeile.delete(spalte.field);
      if (zeile.size === 0) dirty.delete(name);
    }
    return;
  }

  if (!dirty.has(name)) dirty.set(name, new Map());
  dirty.get(name).set(spalte.field, wert);
}

function anzahlAenderungen(kind = state.kind) {
  let summe = 0;
  puffer[kind].dirty.forEach((zeile) => {
    summe += zeile.size;
  });
  return summe;
}

function anzahlUngueltig(kind = state.kind) {
  let summe = 0;
  puffer[kind].ungueltig.forEach((zeile) => {
    summe += zeile.size;
  });
  return summe;
}

function hatOffeneAenderungen() {
  return ["products", "recipes"].some((kind) => anzahlAenderungen(kind) + anzahlUngueltig(kind) > 0);
}

function verwerfeAlles() {
  ["products", "recipes"].forEach((kind) => {
    puffer[kind].dirty.clear();
    puffer[kind].ungueltig.clear();
    puffer[kind].fehler.clear();
  });
}

// ---------------------------------------------------------------------
// Rechte
// ---------------------------------------------------------------------

function schreibrecht(kind = state.kind) {
  return kind === "recipes" ? can("recipes.write") : can("products.write");
}

function kannBearbeiten() {
  return !isOffline() && schreibrecht();
}

// ---------------------------------------------------------------------
// Sortieren, Filtern, Suchen
// ---------------------------------------------------------------------

// Sortierwert: Zahlen als Zahl, alles andere kleingeschrieben als Text.
// Leere Felder wandern ans Ende, egal in welche Richtung sortiert wird –
// beim Pflegen sucht man die gefüllten Zeilen, nicht die Lücken.
function sortSchluessel(eintrag, spalte) {
  if (spalte.type === "number") {
    const zahl = Number(aktuellerWert(eintrag, spalte));
    return Number.isFinite(zahl) ? zahl : null;
  }
  const text = zellText(eintrag, spalte);
  return text === "" ? null : text.toLowerCase();
}

function sortiere(eintraege, spalten) {
  const spalte = spalten.find((s) => s.field === state.sort.field) ?? spalten[0];
  const richtung = state.sort.dir === "desc" ? -1 : 1;
  return [...eintraege].sort((a, b) => {
    const links = sortSchluessel(a, spalte);
    const rechts = sortSchluessel(b, spalte);
    if (links === null && rechts === null) return a.name.localeCompare(b.name, "de");
    if (links === null) return 1;
    if (rechts === null) return -1;
    if (links === rechts) return a.name.localeCompare(b.name, "de");
    if (typeof links === "number" && typeof rechts === "number") return (links - rechts) * richtung;
    return String(links).localeCompare(String(rechts), "de") * richtung;
  });
}

// Suche über den Namen und alle gerade sichtbaren Spalten: was man sieht,
// findet man auch. Eine Suche über ausgeblendete Felder würde Treffer
// liefern, die in der Tabelle nicht zu erkennen sind.
function passtZurSuche(eintrag, spalten, query) {
  if (!query) return true;
  const begriffe = query.toLowerCase().split(/\s+/).filter(Boolean);
  const heuhaufen = [eintrag.name, ...spalten.map((spalte) => zellText(eintrag, spalte))]
    .join(" ")
    .toLowerCase();
  return begriffe.every((begriff) => heuhaufen.includes(begriff));
}

function gefilterteEintraege(spalten) {
  const feld = filterFeld();
  return alleEintraege()
    .filter((eintrag) => !state.filter || (eintrag[feld] ?? "") === state.filter)
    .filter((eintrag) => passtZurSuche(eintrag, spalten, state.query));
}

function oeffneFormular(name) {
  setPendingEditReturn();
  switchTab(state.kind, { keepEditReturn: true });
  if (state.kind === "recipes") openRecipeForEdit(name);
  else openProductForEdit(name);
}

// ---------------------------------------------------------------------
// Vorschlagslisten (suggest: true)
// ---------------------------------------------------------------------

function listenId(spalte) {
  return `catalog-list-${state.kind}-${spalte.field}`;
}

// Erst beim ersten Bearbeiten einer Spalte gebaut: eine <datalist> je
// Textspalte vorab zu erzeugen kostet bei 40 Spalten mehr, als es bringt.
function datalistFuer(spalte) {
  if (!listsEl || !spalte.suggest) return null;
  const id = listenId(spalte);
  if (listenCache.has(id)) return id;

  const werte = [...new Set(alleEintraege().map((e) => e[spalte.field]).filter(Boolean))]
    .map(String)
    .sort((a, b) => a.localeCompare(b, "de"));
  const liste = document.createElement("datalist");
  liste.id = id;
  werte.forEach((wert) => {
    const option = document.createElement("option");
    option.value = wert;
    liste.appendChild(option);
  });
  listsEl.appendChild(liste);
  listenCache.set(id, true);
  return id;
}

// ---------------------------------------------------------------------
// Zelle malen
// ---------------------------------------------------------------------

function malZelle(td) {
  const spalte = columnByField(state.kind, td.dataset.field);
  const eintrag = eintragNach(td.dataset.name);
  if (!spalte || !eintrag) return;

  const text = zellText(eintrag, spalte);
  const kurz = kuerze(text);
  td.textContent = kurz;
  if (kurz !== text) td.title = text;
  else td.removeAttribute("title");

  td.classList.toggle("catalog-cell-dirty", Boolean(buch().dirty.get(eintrag.name)?.has(spalte.field)));
  td.classList.toggle("catalog-cell-invalid", rohUngueltig(eintrag.name, spalte.field) !== undefined);
}

// ---------------------------------------------------------------------
// Editor: genau ein Eingabefeld, immer in der fokussierten Zelle
// ---------------------------------------------------------------------

function zelleIstEditierbar(td) {
  if (!td || td.tagName !== "TD") return false;
  const spalte = columnByField(state.kind, td.dataset.field);
  return Boolean(spalte) && istEditierbarerTyp(spalte);
}

function schliesseEditor(uebernehmen) {
  if (!offenerEditor) return;
  const { td, editor, spalte, name } = offenerEditor;
  offenerEditor = null;
  if (uebernehmen) setzeWert(name, spalte, leseEditor(editor, spalte));
  td.classList.remove("catalog-cell-editing");
  editor.remove();
  malZelle(td);
  aktualisiereLeiste();
}

// startText: das Zeichen, mit dem die Bearbeitung angestoßen wurde. Wer in
// einer fokussierten Zelle einfach lostippt, erwartet, dass dieses Zeichen
// im Feld steht und den alten Wert ersetzt.
function starteEdit(td, { startText = null, sofortToggle = false } = {}) {
  if (!kannBearbeiten() || speichertGerade || !zelleIstEditierbar(td)) return;
  if (offenerEditor?.td === td) return;
  schliesseEditor(true);

  const spalte = columnByField(state.kind, td.dataset.field);
  const eintrag = eintragNach(td.dataset.name);
  if (!eintrag) return;

  const wert = aktuellerWert(eintrag, spalte);
  const editor = baueEditor(spalte, wert, datalistFuer(spalte));
  if (startText != null && spalte.type !== "bool" && spalte.type !== "select") editor.value = startText;

  td.textContent = "";
  td.removeAttribute("title");
  td.classList.add("catalog-cell-editing");
  td.appendChild(editor);
  offenerEditor = { td, editor, spalte, name: eintrag.name };

  editor.addEventListener("keydown", editorTaste);
  editor.addEventListener("blur", () => {
    // Erst im nächsten Tick: sonst räumt der blur den Editor weg, bevor ein
    // Klick auf eine andere Zelle dort ankommt.
    setTimeout(() => {
      if (offenerEditor?.editor === editor) schliesseEditor(true);
    }, 0);
  });
  if (spalte.type === "bool" || spalte.type === "select") {
    editor.addEventListener("change", () => {
      schliesseEditor(true);
      td.focus();
    });
  }

  editor.focus();
  if (startText != null && editor.setSelectionRange) {
    const ende = editor.value.length;
    editor.setSelectionRange(ende, ende);
  } else if (editor.select) {
    editor.select();
  }
  // Ein Klick auf eine ja/nein-Zelle ist als Umschalten gemeint, nicht als
  // "Kästchen öffnen und dann nochmal klicken".
  if (sofortToggle && spalte.type === "bool") {
    editor.checked = !editor.checked;
    schliesseEditor(true);
    td.focus();
  }
}

function editorTaste(event) {
  if (!offenerEditor) return;
  const { td, spalte } = offenerEditor;

  if (event.key === "Escape") {
    event.preventDefault();
    schliesseEditor(false);
    malZelle(td);
    td.focus();
    return;
  }
  if (event.key === "Enter" && (spalte.type !== "longtext" || event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    schliesseEditor(true);
    (naechsteZelle(td, 1, 0) ?? td).focus();
    return;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    schliesseEditor(true);
    (naechsteEditierbare(td, event.shiftKey ? -1 : 1) ?? td).focus();
  }
}

// ---------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------

function zellKoordinaten(td) {
  const tr = td.parentElement;
  const tbody = tr?.parentElement;
  if (!tbody) return null;
  return { tbody, zeile: [...tbody.rows].indexOf(tr), spalte: [...tr.cells].indexOf(td) };
}

function naechsteZelle(td, dZeile, dSpalte) {
  const koord = zellKoordinaten(td);
  if (!koord) return null;
  const zeile = koord.tbody.rows[koord.zeile + dZeile];
  if (!zeile) return null;
  return zeile.cells[koord.spalte + dSpalte] ?? null;
}

// Tab läuft über alle bearbeitbaren Zellen in Leserichtung und springt am
// Zeilenende in die nächste Zeile – die Namensspalte wird übersprungen.
function naechsteEditierbare(td, richtung) {
  const zellen = [...tableEl.querySelectorAll("tbody td")].filter(zelleIstEditierbar);
  const index = zellen.indexOf(td);
  if (index === -1) return null;
  return zellen[index + richtung] ?? null;
}

function tabellenTaste(event) {
  const td = event.target.closest?.("td");
  if (!td || offenerEditor) return;
  const spalte = columnByField(state.kind, td.dataset.field);
  if (!spalte) return;

  const springe = (ziel) => {
    if (!ziel) return;
    event.preventDefault();
    ziel.focus();
  };

  switch (event.key) {
    case "ArrowDown":
      return springe(naechsteZelle(td, 1, 0));
    case "ArrowUp":
      return springe(naechsteZelle(td, -1, 0));
    case "ArrowRight":
      return springe(naechsteZelle(td, 0, 1));
    case "ArrowLeft":
      return springe(naechsteZelle(td, 0, -1));
    case "Tab":
      return springe(naechsteEditierbare(td, event.shiftKey ? -1 : 1));
    case "Enter":
      // In der Namensspalte liegt der Fokus auf dem Button, der das Formular
      // öffnet – da muss Enter seinen Normalweg gehen.
      if (!zelleIstEditierbar(td)) return;
      event.preventDefault();
      starteEdit(td);
      return;
    case "Delete":
    case "Backspace": {
      if (!kannBearbeiten() || !zelleIstEditierbar(td)) return;
      event.preventDefault();
      setzeWert(td.dataset.name, spalte, spalte.type === "bool" ? false : "");
      malZelle(td);
      aktualisiereLeiste();
      return;
    }
    default:
      break;
  }

  // Losgetippt: das Zeichen eröffnet die Bearbeitung und steht schon drin.
  if (
    zelleIstEditierbar(td) &&
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    starteEdit(td, { startText: event.key });
  }
}

// ---------------------------------------------------------------------
// Tabelle aufbauen
// ---------------------------------------------------------------------

function baueKopf(spalten) {
  const thead = document.createElement("thead");
  const zeile = document.createElement("tr");
  spalten.forEach((spalte) => {
    const th = document.createElement("th");
    th.style.minWidth = `${spalte.width}px`;
    if (spalte.field === "name") th.className = "catalog-sticky-col";

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
      schliesseEditor(true);
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

function baueZelle(eintrag, spalte) {
  const td = document.createElement("td");
  td.dataset.name = eintrag.name;
  td.dataset.field = spalte.field;
  td.className = `catalog-cell catalog-cell-${spalte.type}`;

  if (spalte.field === "name") {
    td.classList.add("catalog-sticky-col");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "catalog-name-btn";
    btn.textContent = eintrag.name;
    btn.title = t("ui.im_formular_oeffnen");
    btn.addEventListener("click", () => oeffneFormular(eintrag.name));
    td.appendChild(btn);
    return td;
  }

  if (spalte.type === "readonly") {
    td.classList.add("catalog-cell-locked");
  } else {
    // Jede bearbeitbare Zelle ist eine eigene Tab-Station: so läuft die
    // Tastaturbedienung ohne Sondertasten, wie man es von einer Tabelle
    // erwartet.
    td.tabIndex = 0;
  }

  malZelle(td);
  return td;
}

function baueKoerper(eintraege, spalten) {
  const tbody = document.createElement("tbody");
  const fragment = document.createDocumentFragment();
  const { fehler } = buch();
  eintraege.forEach((eintrag) => {
    const zeile = document.createElement("tr");
    zeile.dataset.name = eintrag.name;
    if (fehler.has(eintrag.name)) {
      zeile.classList.add("catalog-row-error");
      zeile.title = fehler.get(eintrag.name);
    }
    spalten.forEach((spalte) => zeile.appendChild(baueZelle(eintrag, spalte)));
    fragment.appendChild(zeile);
  });
  tbody.appendChild(fragment);
  return tbody;
}

function fuelleFilter() {
  if (!filterEl) return;
  const feld = filterFeld();
  const werte = [...new Set(alleEintraege().map((e) => e[feld]).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "de")
  );
  if (!werte.includes(state.filter)) state.filter = "";

  filterEl.textContent = "";
  const alle = document.createElement("option");
  alle.value = "";
  alle.textContent = state.kind === "recipes" ? t("ui.alle_kategorien") : t("ui.alle_gruppen");
  filterEl.appendChild(alle);
  werte.forEach((wert) => {
    const option = document.createElement("option");
    option.value = wert;
    option.textContent = wert;
    filterEl.appendChild(option);
  });
  filterEl.value = state.filter;
}

function fuelleSets() {
  if (!setEl) return;
  const aktiv = aktivesSetKey();
  setEl.textContent = "";
  setsFor(state.kind).forEach((satz) => {
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
  columnsFor(state.kind).forEach((spalte) => {
    const label = document.createElement("label");
    label.className = "catalog-column-option";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = sichtbar.has(spalte.field);
    // Die Namensspalte trägt die Zeile – sie lässt sich nicht abwählen.
    box.disabled = spalte.field === "name";
    box.addEventListener("change", () => {
      const felder = new Set(sichtbareSpalten().map((s) => s.field));
      if (box.checked) felder.add(spalte.field);
      else felder.delete(spalte.field);
      state.custom[state.kind] = columnsFor(state.kind)
        .map((s) => s.field)
        .filter((feld) => felder.has(feld));
      state.set[state.kind] = "eigene";
      schreibeEinstellungen();
      render();
    });

    const text = document.createElement("span");
    text.textContent = t(spalte.labelKey);

    label.append(box, text);
    columnsPopEl.appendChild(label);
  });
}

function aktualisiereKindSchalter() {
  kindBtnsEl?.querySelectorAll("[data-kind]").forEach((btn) => {
    const aktiv = btn.dataset.kind === state.kind;
    btn.classList.toggle("active", aktiv);
    btn.setAttribute("aria-pressed", String(aktiv));
  });
}

function aktualisiereHinweis() {
  if (!noteEl) return;
  let text = "";
  if (isOffline()) text = t("ui.offline_nur_lesen");
  else if (!schreibrecht()) text = t("ui.kein_schreibrecht_nur_lesen");
  noteEl.textContent = text;
  noteEl.hidden = !text;
}

function aktualisiereBanner() {
  if (!staleEl) return;
  staleEl.hidden = !externGeaendert;
}

function aktualisiereLeiste() {
  if (!saveBarEl) return;
  const geaendert = anzahlAenderungen();
  const ungueltig = anzahlUngueltig();
  saveBarEl.hidden = geaendert + ungueltig === 0;

  if (dirtyCountEl) {
    const teile = [geaendert === 1 ? t("ui.eine_aenderung") : t("ui.n_aenderungen", { n: geaendert })];
    if (ungueltig > 0) teile.push(t("ui.n_ungueltig", { n: ungueltig }));
    dirtyCountEl.textContent = teile.join(" · ");
    dirtyCountEl.classList.toggle("catalog-savebar-warn", ungueltig > 0);
  }
  if (saveBtnEl) saveBtnEl.disabled = speichertGerade || geaendert === 0 || ungueltig > 0;
  if (discardBtnEl) discardBtnEl.disabled = speichertGerade;
}

function render() {
  if (!tableEl) return;
  schliesseEditor(true);
  listenCache.clear();
  if (listsEl) listsEl.textContent = "";

  const spalten = sichtbareSpalten();
  // Sortierspalte ausgeblendet? Dann zurück auf den Namen, sonst sortiert die
  // Tabelle nach etwas, das niemand sieht.
  if (!spalten.some((spalte) => spalte.field === state.sort.field)) {
    state.sort = { field: "name", dir: "asc" };
  }
  const eintraege = sortiere(gefilterteEintraege(spalten), spalten);

  fuelleSets();
  fuelleFilter();
  fuelleSpaltenAuswahl();
  aktualisiereKindSchalter();
  aktualisiereHinweis();
  aktualisiereBanner();
  aktualisiereLeiste();

  tableEl.textContent = "";
  tableEl.appendChild(baueKopf(spalten));
  tableEl.appendChild(baueKoerper(eintraege, spalten));

  if (countEl) {
    countEl.textContent = `${eintraege.length} ${t("ui.von")} ${alleEintraege().length}`;
  }
  if (searchEl) searchEl.placeholder = t("ui.in_sichtbaren_spalten_suchen");
}

// ---------------------------------------------------------------------
// Speichern
// ---------------------------------------------------------------------

// Eine Zeile so zusammensetzen, wie sie das Formular auch abschicken würde:
// der vollständige Eintrag plus die geänderten Felder. saveProduct()/
// saveRecipe() upserten über den Namen, es geht also immer der ganze
// Datensatz raus – ein Teil-Update gäbe es hier nicht.
function zeileZumSpeichern(eintrag, aenderungen) {
  const kopie = { ...eintrag, ...Object.fromEntries(aenderungen) };
  if (state.kind === "products") {
    // Wie im Produktformular: "geprüft" trägt das Datum der Prüfung mit.
    if (kopie.verified) kopie.verifiedAt = kopie.verifiedAt || new Date().toISOString();
    else kopie.verifiedAt = "";
  }
  return kopie;
}

async function speichere() {
  const kind = state.kind;
  const { dirty, fehler } = puffer[kind];
  if (speichertGerade || dirty.size === 0 || anzahlUngueltig(kind) > 0) return;
  if (!kannBearbeiten()) return;

  schliesseEditor(true);
  speichertGerade = true;
  fehler.clear();
  aktualisiereLeiste();

  const namen = [...dirty.keys()];
  let erledigt = 0;
  for (const name of namen) {
    if (progressEl) {
      progressEl.hidden = false;
      progressEl.textContent = t("ui.speichere_fortschritt", { fertig: erledigt, gesamt: namen.length });
    }
    try {
      const eintrag = eintragNach(name);
      if (!eintrag) throw new Error(t("ui.eintrag_nicht_mehr_vorhanden"));
      const zeile = zeileZumSpeichern(eintrag, dirty.get(name));
      if (kind === "recipes") await saveRecipe(zeile);
      else await saveProduct(zeile, { priceSource: PREIS_QUELLE });
      dirty.delete(name);
    } catch (err) {
      // Eine kaputte Zeile darf den Lauf nicht abbrechen: der Rest geht
      // durch, die Zeile bleibt rot und im Puffer stehen.
      fehler.set(name, err?.message ?? String(err));
    }
    erledigt += 1;
  }

  speichertGerade = false;
  if (progressEl) {
    progressEl.hidden = true;
    progressEl.textContent = "";
  }
  externGeaendert = false;
  render();
}

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------

function wechsleArt(kind) {
  if (kind === state.kind) return;
  schliesseEditor(true);
  state.kind = kind;
  state.filter = "";
  state.query = "";
  state.sort = { field: "name", dir: "asc" };
  if (searchEl) searchEl.value = "";
  schreibeEinstellungen();
  render();
}

export function initAdminTable() {
  if (!tableEl) return;
  leseEinstellungen();

  kindBtnsEl?.querySelectorAll("[data-kind]").forEach((btn) => {
    btn.addEventListener("click", () => wechsleArt(btn.dataset.kind));
  });

  let suchTimer = null;
  searchEl?.addEventListener("input", () => {
    clearTimeout(suchTimer);
    suchTimer = setTimeout(() => {
      state.query = searchEl.value.trim();
      render();
    }, 150);
  });

  filterEl?.addEventListener("change", () => {
    state.filter = filterEl.value;
    render();
  });

  setEl?.addEventListener("change", () => {
    state.set[state.kind] = setEl.value;
    schreibeEinstellungen();
    render();
  });

  // Ein Klick öffnet den Editor genau in der getroffenen Zelle. mousedown
  // statt click: so ist der Editor da, bevor der Browser den Fokus setzt,
  // und ein Klick aus einem offenen Editor heraus landet gleich im Ziel.
  tableEl.addEventListener("mousedown", (event) => {
    const td = event.target.closest("td");
    if (!td || !zelleIstEditierbar(td)) return;
    if (offenerEditor?.td === td) return;
    event.preventDefault();
    starteEdit(td, { sofortToggle: true });
  });
  tableEl.addEventListener("keydown", tabellenTaste);

  saveBtnEl?.addEventListener("click", () => {
    speichere();
  });
  discardBtnEl?.addEventListener("click", () => {
    if (speichertGerade) return;
    if (anzahlAenderungen() + anzahlUngueltig() > 0 && !confirm(t("ui.aenderungen_wirklich_verwerfen"))) return;
    schliesseEditor(false);
    verwerfeAlles();
    externGeaendert = false;
    render();
  });

  // Spaltenauswahl als eigenes Popover: ein <details> würde beim Klick auf
  // eine Checkbox nicht zufallen, soll aber beim Klick daneben verschwinden.
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

  // Fremde Änderungen (anderes Gerät, Realtime) dürfen den Puffer nicht
  // überschreiben – sonst wäre die halbe Eingabe weg. Stattdessen ein
  // Banner: neu laden kann man über Verwerfen.
  const beiDatenaenderung = () => {
    if (speichertGerade) return;
    if (hatOffeneAenderungen()) {
      externGeaendert = true;
      aktualisiereBanner();
      return;
    }
    if (panelEl?.classList.contains("active")) render();
  };
  onProductsChanged(beiDatenaenderung);
  onRecipesChanged(beiDatenaenderung);
  // Neu rendern nur, wenn der Bereich offen ist: die Tabelle ist die teuerste
  // Ansicht der App, und im Hintergrund sieht sie ohnehin niemand.
  onLanguageChanged(() => {
    if (panelEl?.classList.contains("active")) render();
  });
  window.addEventListener("online", aktualisiereHinweis);
  window.addEventListener("offline", aktualisiereHinweis);

  // Offene Änderungen gehen beim Tab- oder Seitenwechsel verloren.
  registerTabGuard((zielTab) => {
    if (zielTab === "admin-catalog" || !hatOffeneAenderungen()) return true;
    return confirm(t("ui.offene_aenderungen_verlassen"));
  });
  window.addEventListener("beforeunload", (event) => {
    if (!hatOffeneAenderungen()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  render();
}
