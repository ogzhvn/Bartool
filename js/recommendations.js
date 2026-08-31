import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { onProductsChanged, onRecipesChanged } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { compatibilityScore, resolveIngredientProduct } from "./compatibility.js";
import { calculateRecipeCost } from "./costing.js";

const RESULTS_PAGE_SIZE = 20;

const modeButtons = document.querySelectorAll(".rec-mode-btn");
const modeAMainEl = document.getElementById("rec-mode-a-main");
const modeBMainEl = document.getElementById("rec-mode-b-main");
const modeASidebarEl = document.getElementById("rec-mode-a-sidebar");
const modeBSidebarEl = document.getElementById("rec-mode-b-sidebar");

const aSelectAllBtn = document.getElementById("rec-a-select-all");
const aSelectNoneBtn = document.getElementById("rec-a-select-none");
const aSearchEl = document.getElementById("rec-a-search");
const aChecklistEl = document.getElementById("rec-a-checklist");
const aResultsEl = document.getElementById("rec-a-results");

const bSearchEl = document.getElementById("rec-b-search");
const bListEl = document.getElementById("rec-b-list");
const bHintEl = document.getElementById("rec-b-hint");
const bMarginToggleEl = document.getElementById("rec-b-margin-toggle");
const bResultsEl = document.getElementById("rec-b-results");

// Kein persistenter Lagerbestand (bewusst so gewünscht) - die Checkliste ist
// reiner Sitzungszustand. Default: alles vorrätig, hier werden nur die
// Ausnahmen (gerade nicht vorrätig) gemerkt, damit neu hinzukommende
// Produkte automatisch als vorrätig gelten statt manuell nachgepflegt werden
// zu müssen.
let uncheckedProducts = new Set();
let selectedRecipeName = null;
let showAllModeB = false;

function formatEuro(n) {
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function isChecked(name) {
  return !uncheckedProducts.has(name);
}

function ingredientAvailable(ingredient, availableProducts) {
  const name = ingredient.name.toLowerCase();
  return availableProducts.some((p) => name.includes(p.name.toLowerCase()));
}

// ---------- Mode toggle ----------

function setMode(mode) {
  modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.recMode === mode));
  modeAMainEl.classList.toggle("active", mode === "a");
  modeBMainEl.classList.toggle("active", mode === "b");
  modeASidebarEl.classList.toggle("active", mode === "a");
  modeBSidebarEl.classList.toggle("active", mode === "b");
}

// ---------- Modus A: Was kann ich aus meinem Bestand machen? ----------

function renderChecklist() {
  const query = aSearchEl.value.trim().toLowerCase();
  const products = getAllProducts().filter((p) => !query || p.name.toLowerCase().includes(query));
  aChecklistEl.innerHTML = products
    .map(
      (p) => `
      <label class="rec-checklist-item">
        <input type="checkbox" data-name="${escapeHtml(p.name)}" ${isChecked(p.name) ? "checked" : ""} />
        ${escapeHtml(p.name)}
      </label>
    `
    )
    .join("");
  aChecklistEl.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) uncheckedProducts.delete(cb.dataset.name);
      else uncheckedProducts.add(cb.dataset.name);
      renderModeAResults();
    });
  });
}

function renderModeAResults() {
  const products = getAllProducts();
  const available = products.filter((p) => isChecked(p.name));
  const recipes = getAllRecipes();

  const full = [];
  const missingOne = [];
  recipes.forEach((recipe) => {
    if (recipe.ingredients.length === 0) return;
    const missing = recipe.ingredients.filter((ing) => !ingredientAvailable(ing, available));
    if (missing.length === 0) full.push(recipe);
    else if (missing.length === 1) missingOne.push({ recipe, missing: missing[0] });
  });
  full.sort((a, b) => a.name.localeCompare(b.name, "de"));
  missingOne.sort((a, b) => a.recipe.name.localeCompare(b.recipe.name, "de"));

  aResultsEl.innerHTML = `
    <h3>✓ Kannst du sofort machen (${full.length})</h3>
    ${
      full.length === 0
        ? `<p class="empty-note">Mit dem aktuell markierten Bestand ist noch kein Rezept komplett abgedeckt.</p>`
        : `<div class="sm-results">${full
            .map(
              (r) => `
            <div class="sm-pitch-card">
              <span class="sm-pitch-name">${escapeHtml(r.name)}</span>
            </div>
          `
            )
            .join("")}</div>`
    }

    <h3>Fehlt nur eine Zutat (${missingOne.length})</h3>
    ${
      missingOne.length === 0
        ? `<p class="empty-note">Keine Rezepte, denen genau eine Zutat fehlt.</p>`
        : `<div class="sm-results">${missingOne
            .map(
              ({ recipe, missing }) => `
            <div class="sm-pitch-card">
              <span class="sm-pitch-name">${escapeHtml(recipe.name)}</span>
              <p class="sm-pitch-line">Dir fehlt nur: ${escapeHtml(missing.name)}</p>
            </div>
          `
            )
            .join("")}</div>`
    }
  `;
}

// ---------- Modus B: Ähnlich wie … ----------

function renderRecipeSidebarList() {
  const query = bSearchEl.value.trim().toLowerCase();
  const recipes = getAllRecipes().filter((r) => r.name.toLowerCase().includes(query));
  bListEl.innerHTML = recipes
    .map(
      (r) =>
        `<button type="button" class="recipe-name-btn${r.name === selectedRecipeName ? " active" : ""}" data-name="${escapeHtml(r.name)}">${escapeHtml(r.name)}</button>`
    )
    .join("");
  bListEl.querySelectorAll(".recipe-name-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRecipeName = btn.dataset.name;
      showAllModeB = false;
      renderRecipeSidebarList();
      renderModeBResults();
    });
  });
}

// Zutaten-Überlappung als Dice-Koeffizient (0..1) über die Namen beider
// Zutatenlisten.
function ingredientOverlapScore(a, b) {
  if (a.ingredients.length === 0 || b.ingredients.length === 0) return 0;
  const namesB = b.ingredients.map((i) => i.name.toLowerCase());
  const matched = a.ingredients.filter((i) => namesB.includes(i.name.toLowerCase())).length;
  return (2 * matched) / (a.ingredients.length + b.ingredients.length);
}

// compatibilityScore() paarweise über beide Zutatenlisten gemittelt (nur
// Zutaten, die auf ein Produkt mit Aromaprofil auflösbar sind).
function pairwiseCompatibilityAvg(a, b, products) {
  const prodsA = a.ingredients.map((i) => resolveIngredientProduct(i.name, products)).filter(Boolean);
  const prodsB = b.ingredients.map((i) => resolveIngredientProduct(i.name, products)).filter(Boolean);
  const scores = [];
  prodsA.forEach((pa) => {
    prodsB.forEach((pb) => {
      const s = compatibilityScore(pa, pb);
      if (s !== null) scores.push(s);
    });
  });
  if (scores.length === 0) return null;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

// Kombiniert Zutaten-Überlappung und Aroma-Kompatibilität zu einem 0-100
// Ähnlichkeits-Score. Ohne auflösbare Aromaprofile zählt nur die Überlappung.
function similarityScore(a, b, products) {
  const overlapPct = ingredientOverlapScore(a, b) * 100;
  const pairwiseAvg = pairwiseCompatibilityAvg(a, b, products);
  return pairwiseAvg === null ? Math.round(overlapPct) : Math.round(0.5 * overlapPct + 0.5 * pairwiseAvg);
}

function renderModeBResults() {
  if (!selectedRecipeName) {
    bHintEl.hidden = false;
    bResultsEl.innerHTML = "";
    return;
  }
  const products = getAllProducts();
  const recipes = getAllRecipes();
  const reference = recipes.find((r) => r.name === selectedRecipeName);
  if (!reference) {
    bHintEl.hidden = false;
    bResultsEl.innerHTML = "";
    return;
  }
  bHintEl.hidden = true;

  const scored = recipes
    .filter((r) => r.name !== reference.name)
    .map((r) => ({ recipe: r, score: similarityScore(reference, r, products) }))
    .sort((x, y) => y.score - x.score);

  const visible = showAllModeB ? scored : scored.slice(0, RESULTS_PAGE_SIZE);
  const hiddenCount = scored.length - visible.length;

  let entries = visible.map((e) => ({ ...e, cost: null }));
  if (bMarginToggleEl.checked) {
    entries = entries.map((e) => {
      const cost = calculateRecipeCost(e.recipe);
      return { ...e, cost: cost.allPricesKnown ? cost.total : null };
    });
    // Sortiert die aktuell sichtbaren, bereits ähnlichkeitsgefilterten
    // Vorschläge zusätzlich nach Wareneinsatz - ersetzt die Relevanz-Sortierung
    // nicht, sondern gewichtet nur innerhalb davon.
    entries.sort((a, b) => {
      if (a.cost === null && b.cost === null) return b.score - a.score;
      if (a.cost === null) return 1;
      if (b.cost === null) return -1;
      return a.cost - b.cost;
    });
  }

  const cardsHtml =
    entries.length === 0
      ? `<p class="empty-note">Keine anderen Rezepte gefunden.</p>`
      : entries
          .map(
            ({ recipe, score, cost }) => `
          <div class="sm-pitch-card">
            <div class="sm-pitch-head">
              <span class="sm-pitch-name">${escapeHtml(recipe.name)}</span>
              <span class="sm-pitch-type">${score} / 100${cost != null ? ` · Wareneinsatz ${formatEuro(cost)}` : ""}</span>
            </div>
          </div>
        `
          )
          .join("");

  const moreHtml =
    hiddenCount > 0
      ? `<button type="button" class="btn-secondary rec-b-more">+ ${hiddenCount} weitere anzeigen</button>`
      : showAllModeB && scored.length > RESULTS_PAGE_SIZE
        ? `<button type="button" class="btn-secondary rec-b-more" data-collapse="1">Weniger anzeigen</button>`
        : "";

  bResultsEl.innerHTML = `<div class="sm-results">${cardsHtml}</div>${moreHtml}`;
  const moreBtn = bResultsEl.querySelector(".rec-b-more");
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      showAllModeB = !moreBtn.dataset.collapse;
      renderModeBResults();
    });
  }
}

// ---------- Init ----------

export function initRecommendations() {
  modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.recMode)));

  aSelectAllBtn.addEventListener("click", () => {
    uncheckedProducts.clear();
    renderChecklist();
    renderModeAResults();
  });
  aSelectNoneBtn.addEventListener("click", () => {
    uncheckedProducts = new Set(getAllProducts().map((p) => p.name));
    renderChecklist();
    renderModeAResults();
  });
  aSearchEl.addEventListener("input", renderChecklist);

  bSearchEl.addEventListener("input", renderRecipeSidebarList);
  bMarginToggleEl.addEventListener("change", renderModeBResults);

  onProductsChanged(() => {
    renderChecklist();
    renderModeAResults();
    renderModeBResults();
  });
  onRecipesChanged(() => {
    renderModeAResults();
    renderRecipeSidebarList();
    renderModeBResults();
  });

  renderChecklist();
  renderModeAResults();
  renderRecipeSidebarList();
  renderModeBResults();
}
