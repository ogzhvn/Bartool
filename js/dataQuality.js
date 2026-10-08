import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { openProductForEdit } from "./products.js";
import { openRecipeForEdit } from "./recipes.js";
import { loadDishes, onDishesChanged, onProductsChanged, onRecipesChanged } from "./storage.js";
import { canSee } from "./auth.js";
import { focusDish } from "./dishes.js";
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

// Weinbegleitung (Paket 73): Gerichte, deren Wein nicht mehr im Katalog steht.
function renderDishWineGroup() {
  const wrapper = document.createElement("div");
  const heading = document.createElement("h4");
  heading.textContent = t("ui.gerichte");
  wrapper.appendChild(heading);
  const ids = new Set(getAllProducts().map((p) => p.id));
  const broken = loadDishes().filter((d) => d.winePairings.some((w) => !ids.has(w?.product_id)));
  if (broken.length === 0) {
    const ok = document.createElement("p");
    ok.className = "empty-note";
    ok.textContent = t("ui.qualitaet_wein_ok");
    wrapper.appendChild(ok);
    return wrapper;
  }
  const details = document.createElement("details");
  details.className = "audit-entry";
  const summary = document.createElement("summary");
  summary.textContent = t("ui.qualitaet_wein_fehlt", { n: broken.length });
  const list = document.createElement("div");
  list.className = "quality-item-list";
  broken.forEach((dish) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quality-item-btn";
    btn.textContent = dish.name;
    btn.addEventListener("click", () => focusDish(dish.id));
    list.appendChild(btn);
  });
  details.append(summary, list);
  wrapper.appendChild(details);
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
  if (canSee("dishes")) containerEl.appendChild(renderDishWineGroup());
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
  onDishesChanged(render);
  render();

  initImportExport();
  // Papierkorb: eigenes Modul (js/auditLog.js), nur hier eingehängt, damit
  // die Wiederherstell-Logik nicht doppelt existiert.
  initAuditTrash();
}
