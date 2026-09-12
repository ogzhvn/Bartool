import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { onProductsChanged, onRecipesChanged, isOffline } from "./storage.js";
import { openProductForEdit } from "./products.js";
import { openRecipeForEdit } from "./recipes.js";
import { switchTab, setPendingEditReturn } from "./tabs.js";
import { can } from "./auth.js";
import { t, onLanguageChanged, formatDecimal } from "./i18n.js";
import { columnsFor, setsFor, NARROW_SETS } from "./catalogColumns.js";
import { UNIT_LABELS } from "./units.js";
import { formatNumber } from "./utils.js";

// Katalogtabelle (Adminbereich, Sub-Tab "admin-catalog").
//
// Die Bibliotheks-Tabs zeigen einen Eintrag nach dem anderen – gut zum
// Nachschlagen hinterm Tresen, mühsam beim Pflegen. Hier liegt derselbe
// Bestand als Tabelle: alle Zeilen untereinander, die gewünschten Felder
// nebeneinander, ohne für jedes Feld ein Formular zu öffnen.
//
// Etappe 1 (dieser Stand) zeigt und filtert. Das Bearbeiten in der Zelle
// kommt in Etappe 2; die Zellen tragen dafür schon ihre Koordinaten
// (data-name/data-field), damit dabei nichts am Aufbau umgestellt werden muss.

const panelEl = document.getElementById("admin-catalog");
const kindBtnsEl = document.getElementById("catalog-kind-switch");
const searchEl = document.getElementById("catalog-search");
const filterEl = document.getElementById("catalog-filter");
const setEl = document.getElementById("catalog-set");
const columnsBtnEl = document.getElementById("catalog-columns-btn");
const columnsPopEl = document.getElementById("catalog-columns-pop");
const countEl = document.getElementById("catalog-count");
const noteEl = document.getElementById("catalog-note");
const tableEl = document.getElementById("catalog-table");

const STORAGE_KEY = "bartool.catalogTable";
const NARROW_QUERY = "(max-width: 700px)";

// Sichtbare Länge einer Textzelle. Der volle Text hängt im title-Attribut,
// die Zelle bleibt damit eine Zeile hoch und die Tabelle lesbar.
const CELL_MAX = 120;

const state = {
  kind: "products",
  set: { products: null, recipes: null },
  custom: { products: null, recipes: null },
  filter: "",
  query: "",
  sort: { field: "name", dir: "asc" },
};

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

// Das Filterfeld über der Tabelle: bei Produkten die Gruppe (Gin, Whisky …),
// bei Rezepten die Kategorie. Beides ist das, wonach man beim Pflegen sucht.
function filterFeld() {
  return state.kind === "recipes" ? "category" : "group";
}

function zutatenText(recipe) {
  return (recipe.ingredients ?? [])
    .map((ing) => `${formatNumber(ing.amount)} ${UNIT_LABELS[ing.unit] ?? ing.unit} ${ing.name}`)
    .join(" · ");
}

// Anzeigetext einer Zelle. Immer ein String – die Tabelle setzt ihn per
// textContent, nie als HTML (siehe stored-XSS-Fix in der Bibliothek).
function zellText(eintrag, spalte) {
  const wert = eintrag[spalte.field];
  if (spalte.field === "ingredients") return zutatenText(eintrag);
  if (spalte.type === "bool") return wert ? t("ui.ja") : "";
  if (spalte.type === "tags" || Array.isArray(wert)) return (wert ?? []).join(", ");
  if (spalte.type === "select") {
    const option = (spalte.options?.() ?? []).find((o) => o.value === wert);
    return option ? option.label : (wert ?? "");
  }
  if (spalte.type === "number") {
    if (wert === "" || wert == null) return "";
    const zahl = Number(wert);
    return Number.isFinite(zahl) ? formatDecimal(zahl, Number.isInteger(zahl) ? 0 : 2) : String(wert);
  }
  return wert == null ? "" : String(wert);
}

// Sortierwert: Zahlen als Zahl, alles andere kleingeschrieben als Text.
// Leere Felder wandern ans Ende, egal in welche Richtung sortiert wird –
// beim Pflegen sucht man die gefüllten Zeilen, nicht die Lücken.
function sortSchluessel(eintrag, spalte) {
  if (spalte.type === "number") {
    const zahl = Number(eintrag[spalte.field]);
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
  const text = zellText(eintrag, spalte);
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

  if (spalte.type === "readonly") td.classList.add("catalog-cell-locked");
  if (text.length > CELL_MAX) {
    td.textContent = `${text.slice(0, CELL_MAX)}…`;
    td.title = text;
  } else {
    td.textContent = text;
  }
  return td;
}

function baueKoerper(eintraege, spalten) {
  const tbody = document.createElement("tbody");
  const fragment = document.createDocumentFragment();
  eintraege.forEach((eintrag) => {
    const zeile = document.createElement("tr");
    zeile.dataset.name = eintrag.name;
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
  const schreibrecht = state.kind === "recipes" ? can("recipes.write") : can("products.write");
  let text = "";
  if (isOffline()) text = t("ui.offline_nur_lesen");
  else if (!schreibrecht) text = t("ui.kein_schreibrecht_nur_lesen");
  noteEl.textContent = text;
  noteEl.hidden = !text;
}

function render() {
  if (!tableEl) return;
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

  tableEl.textContent = "";
  tableEl.appendChild(baueKopf(spalten));
  tableEl.appendChild(baueKoerper(eintraege, spalten));

  if (countEl) {
    countEl.textContent = `${eintraege.length} ${t("ui.von")} ${alleEintraege().length}`;
  }
  if (searchEl) searchEl.placeholder = t("ui.in_sichtbaren_spalten_suchen");
}

function wechsleArt(kind) {
  if (kind === state.kind) return;
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

  // Neu rendern nur, wenn der Bereich offen ist: die Tabelle ist die teuerste
  // Ansicht der App, und im Hintergrund sieht sie ohnehin niemand.
  const neuWennSichtbar = () => {
    if (panelEl?.classList.contains("active")) render();
  };
  onProductsChanged(neuWennSichtbar);
  onRecipesChanged(neuWennSichtbar);
  onLanguageChanged(neuWennSichtbar);
  window.addEventListener("online", aktualisiereHinweis);
  window.addEventListener("offline", aktualisiereHinweis);

  render();
}
