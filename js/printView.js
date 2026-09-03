import { buildRecipeBlocks } from "./recipeExport.js";
import { buildProductBlocks } from "./productExport.js";
import { escapeHtml, formatNumberDe } from "./utils.js";

// Druckansicht für ausgewählte Rezepte und Produkte.
//
// Die Listenansicht selbst zu drucken wäre unschön: dort stecken Auswahl-
// kästchen, Formularfelder und Bedienelemente drin. Stattdessen wird der
// Inhalt der ausgewählten Einträge in einen eigenen Bereich (#print-area)
// geschrieben, der nur beim Drucken sichtbar ist – aufgebaut aus denselben
// Bausteinen wie der Word-Export, damit Ausdruck und Word-Datei gleich
// aussehen.

const printAreaEl = document.getElementById("print-area");

function printBlocks(title, blocksHtml) {
  printAreaEl.innerHTML = `<h1>${escapeHtml(title)}</h1>${blocksHtml}`;
  document.body.classList.add("printing");

  const cleanUp = () => {
    document.body.classList.remove("printing");
    printAreaEl.innerHTML = "";
    window.removeEventListener("afterprint", cleanUp);
  };
  window.addEventListener("afterprint", cleanUp);

  // Kurz warten, damit der Browser den neuen Inhalt gerendert hat, bevor der
  // Druckdialog den Seitenumbruch berechnet.
  setTimeout(() => {
    window.print();
    // Sicherheitsnetz: Safari auf dem iPhone löst "afterprint" nicht
    // zuverlässig aus. Ohne diesen Fallback bliebe die Seite im Druckmodus
    // hängen und der Bildschirm wäre leer.
    setTimeout(cleanUp, 2000);
  }, 50);
}

export function printRecipes(recipes) {
  if (recipes.length === 0) return;
  printBlocks(
    recipes.length === 1 ? recipes[0].name : `Rezepte (${recipes.length})`,
    buildRecipeBlocks(recipes)
  );
}

export function printProducts(products) {
  if (products.length === 0) return;
  printBlocks(
    products.length === 1 ? products[0].name : `Produkte (${products.length})`,
    buildProductBlocks(products)
  );
}

// ---------------------------------------------------------------------
// Etiketten für Ansätze
//
// Bewusst ohne QR-Code: dafür bräuchte es eine zusätzliche Bibliothek, und
// das Projekt kommt ohne Fremdcode im Frontend aus. Auf dem Etikett steht
// das, was hinterm Tresen zählt – was drin ist und wie lange es noch gut ist.
// ---------------------------------------------------------------------

function formatLabelDate(value) {
  if (!value) return "–";
  return new Date(value).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function labelHtml(prep, typLabel, ersteller) {
  const zeilen = [
    prep.batchSizeMl ? `${formatNumberDe(prep.batchSizeMl)} ml` : "",
    prep.abv !== "" && prep.abv != null ? `${formatNumberDe(prep.abv)} % vol` : "",
    prep.location,
  ].filter(Boolean);

  return `
    <div class="label-card">
      <div class="label-name">${escapeHtml(prep.label)}</div>
      <div class="label-type">${escapeHtml(typLabel)}${zeilen.length ? " · " + escapeHtml(zeilen.join(" · ")) : ""}</div>
      <div class="label-dates">
        <span>Angesetzt<strong>${formatLabelDate(prep.madeAt)}</strong></span>
        <span>Haltbar bis<strong>${formatLabelDate(prep.expiresAt)}</strong></span>
      </div>
      ${prep.notes ? `<div class="label-note">${escapeHtml(prep.notes)}</div>` : ""}
      ${ersteller ? `<div class="label-note">Angesetzt von ${escapeHtml(ersteller)}</div>` : ""}
    </div>`;
}

// anzahl = wie oft dasselbe Etikett gedruckt wird (mehrere Flaschen je Ansatz).
export function printLabels(prep, typLabel, anzahl = 1, ersteller = "") {
  if (!prep) return;
  const menge = Math.max(1, Math.min(60, Number(anzahl) || 1));
  const karten = Array.from({ length: menge }, () => labelHtml(prep, typLabel, ersteller)).join("");
  printAreaEl.innerHTML = `<div class="label-sheet">${karten}</div>`;
  document.body.classList.add("printing", "printing-labels");

  const cleanUp = () => {
    document.body.classList.remove("printing", "printing-labels");
    printAreaEl.innerHTML = "";
    window.removeEventListener("afterprint", cleanUp);
  };
  window.addEventListener("afterprint", cleanUp);

  setTimeout(() => {
    window.print();
    setTimeout(cleanUp, 2000);
  }, 50);
}
