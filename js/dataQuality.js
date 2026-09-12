import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { openProductForEdit } from "./products.js";
import { openRecipeForEdit } from "./recipes.js";
import { onProductsChanged, onRecipesChanged } from "./storage.js";
import { switchTab, setPendingEditReturn } from "./tabs.js";
import { escapeHtml } from "./utils.js";
import { t, onLanguageChanged } from "./i18n.js";
import { exportProductsToExcel, exportProductsToWord } from "./productExport.js";
import { exportRecipesToExcel, exportRecipesToWord } from "./recipeExport.js";
import { initAuditTrash } from "./auditLog.js";

const containerEl = document.getElementById("data-quality-report");

const PRODUCT_METRICS = [
  { field: t("ui.einkaufspreis"), missing: (p) => !p.priceValue },
  { field: t("ui.kurzpitch"), missing: (p) => !p.quickPitch },
  { field: t("ui.tasting_notes"), missing: (p) => !p.tastingNotes },
  // Produktwissen (Paket 21): Grundlage für Schulung und Quiz.
  { field: t("ui.herkunftsland"), missing: (p) => !p.originCountry },
  { field: t("ui.grundstoff"), missing: (p) => !p.baseMaterial },
  { field: t("ui.aroma_schlagworte"), missing: (p) => (p.flavorTags ?? []).length === 0 },
  // Nur dort ein Mangel, wo eine Textangabe existiert, aus der sich keine Zahl
  // ableiten ließ – "0 % vol" ist ein gepflegter Wert, kein fehlender.
  {
    field: t("ui.alkoholgehalt_als_zahl"),
    missing: (p) => Boolean(p.abv) && (p.abvValue === "" || p.abvValue == null),
  },
  // Ohne Prüfvermerk wird ein Produkt später im Quiz nicht abgefragt.
  { field: t("ui.pruefvermerk"), missing: (p) => !p.verified },
];

const RECIPE_METRICS = [
  { field: t("ui.kurzpitch"), missing: (r) => !r.quickPitch },
  { field: t("ui.zubereitung"), missing: (r) => !r.method },
];

function renderMetricGroup(title, titleDative, tabId, items, metrics, openForEdit) {
  const rows = metrics
    .map((metric) => {
      const missing = items.filter(metric.missing);
      if (missing.length === 0) {
        return `<p class="empty-note">${t("ui.alle_66a5")} ${items.length} ${title}: ${escapeHtml(metric.field)} ${t("ui.hinterlegt")}.</p>`;
      }
      return `
        <details class="audit-entry">
          <summary>${missing.length} ${t("ui.von")} ${items.length} ${titleDative} ${t("ui.ohne_klein")} ${escapeHtml(metric.field)}</summary>
          <div class="quality-item-list">
            ${missing
              .map(
                (item) =>
                  `<button type="button" class="quality-item-btn" data-name="${escapeHtml(item.name)}">${escapeHtml(item.name)}</button>`
              )
              .join("")}
          </div>
        </details>
      `;
    })
    .join("");

  const wrapper = document.createElement("div");
  wrapper.innerHTML = `<h4>${escapeHtml(title)}</h4>${rows}`;
  wrapper.querySelectorAll(".quality-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setPendingEditReturn();
      switchTab(tabId, { keepEditReturn: true });
      openForEdit(btn.dataset.name);
    });
  });
  return wrapper;
}

function render() {
  containerEl.innerHTML = "";
  containerEl.appendChild(
    renderMetricGroup(t("ui.produkte"), t("ui.produkten"), "products", getAllProducts(), PRODUCT_METRICS, openProductForEdit)
  );
  containerEl.appendChild(
    renderMetricGroup(t("ui.rezepte"), t("ui.rezepten"), "recipes", getAllRecipes(), RECIPE_METRICS, openRecipeForEdit)
  );
}

// Sammelstelle für Import und Export (Paket 38): die eigentlichen
// Einstiegspunkte bleiben in den Fach-Tabs (Produkte/Rezepte), hier nur
// zusätzlich erreichbar. Import öffnet den Produkte-Tab mit der schon
// vorhandenen Import-Leiste, Export läuft direkt über den kompletten
// Katalog statt über eine Auswahl.
function initImportExport() {
  document.getElementById("admin-data-import-products")?.addEventListener("click", () => switchTab("products"));
  document.getElementById("admin-data-export-products-excel")?.addEventListener("click", () => {
    const produkte = getAllProducts();
    if (produkte.length > 0) exportProductsToExcel(produkte);
  });
  document.getElementById("admin-data-export-products-word")?.addEventListener("click", () => {
    const produkte = getAllProducts();
    if (produkte.length > 0) exportProductsToWord(produkte);
  });
  document.getElementById("admin-data-export-recipes-excel")?.addEventListener("click", () => {
    const rezepte = getAllRecipes();
    if (rezepte.length > 0) exportRecipesToExcel(rezepte);
  });
  document.getElementById("admin-data-export-recipes-word")?.addEventListener("click", () => {
    const rezepte = getAllRecipes();
    if (rezepte.length > 0) exportRecipesToWord(rezepte);
  });
}

export function initDataQuality() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(render);

  onProductsChanged(render);
  onRecipesChanged(render);
  render();

  initImportExport();
  // Papierkorb: eigenes Modul (js/auditLog.js), nur hier eingehängt, damit
  // die Wiederherstell-Logik nicht doppelt existiert.
  initAuditTrash();
}
