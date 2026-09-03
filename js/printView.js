import { buildRecipeBlocks } from "./recipeExport.js";
import { buildProductBlocks } from "./productExport.js";
import { escapeHtml } from "./utils.js";

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
