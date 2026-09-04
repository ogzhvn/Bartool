import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { openProductForEdit } from "./products.js";
import { openRecipeForEdit } from "./recipes.js";
import { onProductsChanged, onRecipesChanged } from "./storage.js";
import { switchTab, setPendingEditReturn } from "./tabs.js";
import { escapeHtml } from "./utils.js";

const containerEl = document.getElementById("data-quality-report");

const PRODUCT_METRICS = [
  { field: "Einkaufspreis", missing: (p) => !p.priceValue },
  { field: "Kurzpitch", missing: (p) => !p.quickPitch },
  { field: "Tasting Notes", missing: (p) => !p.tastingNotes },
  // Produktwissen (Paket 21): Grundlage für Schulung und Quiz.
  { field: "Herkunftsland", missing: (p) => !p.originCountry },
  { field: "Grundstoff", missing: (p) => !p.baseMaterial },
  { field: "Aroma-Schlagworte", missing: (p) => (p.flavorTags ?? []).length === 0 },
  // Nur dort ein Mangel, wo eine Textangabe existiert, aus der sich keine Zahl
  // ableiten ließ – "0 % vol" ist ein gepflegter Wert, kein fehlender.
  {
    field: "Alkoholgehalt als Zahl",
    missing: (p) => Boolean(p.abv) && (p.abvValue === "" || p.abvValue == null),
  },
  // Ohne Prüfvermerk wird ein Produkt später im Quiz nicht abgefragt.
  { field: "Prüfvermerk", missing: (p) => !p.verified },
];

const RECIPE_METRICS = [
  { field: "Kurzpitch", missing: (r) => !r.quickPitch },
  { field: "Zubereitung", missing: (r) => !r.method },
];

function renderMetricGroup(title, titleDative, tabId, items, metrics, openForEdit) {
  const rows = metrics
    .map((metric) => {
      const missing = items.filter(metric.missing);
      if (missing.length === 0) {
        return `<p class="empty-note">✓ Alle ${items.length} ${title}: ${escapeHtml(metric.field)} hinterlegt.</p>`;
      }
      return `
        <details class="audit-entry">
          <summary>${missing.length} von ${items.length} ${titleDative} ohne ${escapeHtml(metric.field)}</summary>
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
    renderMetricGroup("Produkte", "Produkten", "products", getAllProducts(), PRODUCT_METRICS, openProductForEdit)
  );
  containerEl.appendChild(
    renderMetricGroup("Rezepte", "Rezepten", "recipes", getAllRecipes(), RECIPE_METRICS, openRecipeForEdit)
  );
}

export function initDataQuality() {
  onProductsChanged(render);
  onRecipesChanged(render);
  render();
}
