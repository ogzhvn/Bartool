import { t, formatDecimal } from "./i18n.js";
import { UNIT_LABELS } from "./units.js";
import { formatNumber } from "./utils.js";

// Eine Zelle der Katalogtabelle (js/adminTable.js): lesen, anzeigen, prüfen,
// bearbeiten. Bewusst ohne Kenntnis der Tabelle drumherum – hier steht nur,
// was ein einzelnes Feld ausmacht, damit adminTable.js sich um Fokus,
// Navigation und Speichern kümmern kann.
//
// Werte liegen immer in derselben Form vor wie in den Objekten aus
// fromProductRow()/fromRecipeRow(): Zahl oder "" bei number, boolean bei
// bool, Array bei tags, sonst String. Die Rohfassung einer ungültigen
// Eingabe bleibt in adminTable.js liegen, hier kommen nur saubere Werte an.

// Sichtbare Länge einer Textzelle. Der volle Text hängt im title-Attribut,
// die Zelle bleibt damit eine Zeile hoch und die Tabelle lesbar.
const CELL_MAX = 120;

// Obergrenzen, die nicht aus dem Feldtyp folgen, sondern aus der Sache:
// ein Alkoholgehalt über 100 % ist keine Eingabe, sondern ein Vertipper.
const GRENZEN = {
  abvValue: { min: 0, max: 100 },
  abvMax: { min: 0, max: 100 },
  priceValue: { min: 0 },
  parLevel: { min: 0 },
  salesPrice: { min: 0 },
  basePortions: { min: 0 },
};

// Zahl aus einer Eingabe. Hinterm Tresen wird mit Komma getippt, aus einer
// kopierten Zelle kommt der Punkt – beides muss gehen.
export function parseZahl(roh) {
  const text = String(roh ?? "").trim().replace(",", ".");
  if (text === "") return { ok: true, wert: "" };
  const zahl = Number(text);
  if (!Number.isFinite(zahl)) return { ok: false, wert: text };
  return { ok: true, wert: zahl };
}

// Wandelt die Rohfassung aus einem Editor in den Wert um, der im Eintrag
// steht. { ok:false } heißt: die Zelle wird rot, gespeichert wird nichts.
export function normalisiere(roh, spalte) {
  if (spalte.type === "bool") return { ok: true, wert: Boolean(roh) };
  if (spalte.type === "tags") {
    const liste = String(roh ?? "")
      .split(",")
      .map((teil) => teil.trim())
      .filter(Boolean);
    return { ok: true, wert: liste };
  }
  if (spalte.type === "number") {
    const { ok, wert } = parseZahl(roh);
    if (!ok) return { ok: false, wert: String(roh ?? "") };
    const grenze = GRENZEN[spalte.field];
    if (wert !== "" && grenze) {
      if (grenze.min != null && wert < grenze.min) return { ok: false, wert: String(roh ?? "") };
      if (grenze.max != null && wert > grenze.max) return { ok: false, wert: String(roh ?? "") };
    }
    return { ok: true, wert };
  }
  if (spalte.type === "select") {
    const werte = (spalte.options?.() ?? []).map((option) => option.value);
    const wert = String(roh ?? "");
    if (wert !== "" && werte.length && !werte.includes(wert)) return { ok: false, wert };
    return { ok: true, wert };
  }
  return { ok: true, wert: String(roh ?? "") };
}

export function zutatenText(recipe) {
  return (recipe.ingredients ?? [])
    .map((ing) => `${formatNumber(ing.amount)} ${UNIT_LABELS[ing.unit] ?? ing.unit} ${ing.name}`)
    .join(" · ");
}

// Anzeigetext einer Zelle. Immer ein String – die Tabelle setzt ihn per
// textContent, nie als HTML (siehe stored-XSS-Fix in der Bibliothek).
export function anzeigeText(wert, spalte, eintrag = null) {
  if (spalte.field === "ingredients") return eintrag ? zutatenText(eintrag) : "";
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

// Text, der beim Öffnen des Editors drinsteht. Unterscheidet sich bewusst von
// anzeigeText(): im Editor soll die Zahl ohne Tausenderpunkt und ohne
// Rundung stehen, sonst schreibt ein Klick auf Enter den gekürzten Wert
// zurück.
export function editorText(wert, spalte) {
  if (spalte.type === "tags" || Array.isArray(wert)) return (wert ?? []).join(", ");
  if (spalte.type === "number") return wert === "" || wert == null ? "" : String(wert);
  return wert == null ? "" : String(wert);
}

export function kuerze(text) {
  return text.length > CELL_MAX ? `${text.slice(0, CELL_MAX)}…` : text;
}

export function istEditierbarerTyp(spalte) {
  return spalte.type !== "readonly" && spalte.field !== "name";
}

// Baut genau ein Eingabeelement für diese Zelle. listId zeigt auf eine
// <datalist> mit den Bestandswerten der Spalte (suggest: true).
export function baueEditor(spalte, wert, listId = null) {
  if (spalte.type === "bool") {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "catalog-editor catalog-editor-bool";
    box.checked = Boolean(wert);
    return box;
  }

  if (spalte.type === "select") {
    const select = document.createElement("select");
    select.className = "catalog-editor";
    const leer = document.createElement("option");
    leer.value = "";
    leer.textContent = "—";
    select.appendChild(leer);
    (spalte.options?.() ?? []).forEach((option) => {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      select.appendChild(el);
    });
    select.value = String(wert ?? "");
    return select;
  }

  if (spalte.type === "longtext") {
    const area = document.createElement("textarea");
    area.className = "catalog-editor catalog-editor-longtext";
    area.rows = 4;
    area.value = editorText(wert, spalte);
    return area;
  }

  const input = document.createElement("input");
  input.className = "catalog-editor";
  // inputmode statt type="number": ein Zahlenfeld verschluckt das Komma je
  // nach Browser-Locale, und genau das wird hier getippt.
  input.type = "text";
  if (spalte.type === "number") input.inputMode = "decimal";
  input.value = editorText(wert, spalte);
  if (listId) input.setAttribute("list", listId);
  return input;
}

export function leseEditor(editor, spalte) {
  return spalte.type === "bool" ? editor.checked : editor.value;
}
