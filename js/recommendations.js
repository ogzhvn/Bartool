import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { onProductsChanged, onRecipesChanged, loadInventory, saveInventory } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { hasFlavorProfile, compatibilityScore, resolveIngredientProduct, deriveRecipeFlavorProfile, asFlavorProfileHolder } from "./compatibility.js";
import { calculateRecipeCost } from "./costing.js";

const RESULTS_PAGE_SIZE = 20;

// Produktgruppen, die als eigenständig "verkaufbar" für Cross-Sell-Vorschläge
// gelten (Spirituosen pur, Wein/Bier/Schaumwein) - Mixer, Sirupe, Säfte,
// Tee/Kaffee & Sonstiges sind Zutaten, keine Dinge, die man einem Gast
// zusätzlich empfiehlt (z. B. kein "dazu passt gut: Agavendicksaft").
const SELLABLE_GROUPS = new Set([
  "Gin",
  "Vodka",
  "Rum & Cachaça",
  "Whisky",
  "Tequila & Mezcal",
  "Brände",
  "Liköre & Aperitifs",
  "Wermut & Aperitif-Wein",
  "Bitters",
  "Absinth",
  "Schaumwein",
  "Wein",
  "Bier",
]);

const modeButtons = document.querySelectorAll(".rec-mode-btn");
const modeAMainEl = document.getElementById("rec-mode-a-main");
const modeBMainEl = document.getElementById("rec-mode-b-main");
const modeCMainEl = document.getElementById("rec-mode-c-main");
const modeASidebarEl = document.getElementById("rec-mode-a-sidebar");
const modeBSidebarEl = document.getElementById("rec-mode-b-sidebar");

const aSelectAllBtn = document.getElementById("rec-a-select-all");
const aSelectNoneBtn = document.getElementById("rec-a-select-none");
const aSearchEl = document.getElementById("rec-a-search");
const aChecklistEl = document.getElementById("rec-a-checklist");
const aResultsEl = document.getElementById("rec-a-results");
const aMarginToggleEl = document.getElementById("rec-a-margin-toggle");

const bSearchEl = document.getElementById("rec-b-search");
const bListEl = document.getElementById("rec-b-list");
const bHintEl = document.getElementById("rec-b-hint");
const bMarginToggleEl = document.getElementById("rec-b-margin-toggle");
const bResultsEl = document.getElementById("rec-b-results");

const cSearchEl = document.getElementById("rec-c-search");
const cOptionsEl = document.getElementById("rec-c-options");
const cResultsEl = document.getElementById("rec-c-results");

// Persistente Bar-Inventur (storage.js) statt reinem Sitzungszustand - eine
// echte Inventur soll über Besuche hinweg erhalten bleiben.
let inStock = loadInventory();
let selectedRecipeName = null;
let showAllModeB = false;

function formatEuro(n) {
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function isChecked(name) {
  return inStock.has(name);
}

// Alltägliche Frischware (Limette, Minze, Zitrone zum Auspressen usw.) wird
// bewusst nicht als Katalogprodukt geführt (Wunsch des Barbesitzers), gilt
// hier aber immer als vorhanden, damit Rezepte mit solchen Zutaten nicht
// pauschal als "nicht machbar" gelten. Exakter Abgleich auf den um
// Klammerzusätze bereinigten Namen, damit z. B. "Zitronensaft" (ein echtes,
// im Bestand gepflegtes Produkt) nicht versehentlich mit erfasst wird.
const FRESH_STAPLES = [
  "limette",
  "limettenblätter",
  "zitrone",
  "minzblätter",
  "banane",
  "gurkenscheiben",
  "basilikumblätter",
  "thymian",
  "kardamomkapseln",
  "orange",
];

function isFreshStaple(ingredientName) {
  const base = ingredientName
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .trim();
  return FRESH_STAPLES.includes(base);
}

function ingredientAvailable(ingredient, availableProducts) {
  if (isFreshStaple(ingredient.name)) return true;
  const name = ingredient.name.toLowerCase();
  return availableProducts.some((p) => name.includes(p.name.toLowerCase()));
}

function firstSentence(text) {
  if (!text) return "";
  const match = text.match(/^[^.!?]*[.!?]/);
  return (match ? match[0] : text).trim();
}

// Ein Produkt oder Rezept hat quickPitch oft noch nicht gepflegt - solange
// greift ein Fallback auf die erste Aussage aus Story/Tasting Notes bzw.
// Geschichte, statt eine leere Zeile anzuzeigen.
function pitchLineFor(item) {
  if (item.quickPitch) return item.quickPitch;
  const fallback = item.story || item.tastingNotes || item.history || "";
  return firstSentence(fallback) || "(Keine Kurzbeschreibung hinterlegt)";
}

function pitchCard(type, item) {
  return `
    <div class="sm-pitch-card">
      <div class="sm-pitch-head">
        <span class="sm-pitch-name">${escapeHtml(item.name)}</span>
        <span class="sm-pitch-type">${type === "product" ? "Produkt" : "Cocktail"}</span>
      </div>
      <p class="sm-pitch-line">${escapeHtml(pitchLineFor(item))}</p>
    </div>
  `;
}

function lookupByName(name, products = getAllProducts(), recipes = getAllRecipes()) {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const product = products.find((p) => p.name.toLowerCase() === needle);
  if (product) return { type: "product", item: product };
  const recipe = recipes.find((r) => r.name.toLowerCase() === needle);
  if (recipe) return { type: "recipe", item: recipe };
  return null;
}

// ---------- Mode toggle ----------

function setMode(mode) {
  modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.recMode === mode));
  modeAMainEl.classList.toggle("active", mode === "a");
  modeBMainEl.classList.toggle("active", mode === "b");
  modeCMainEl.classList.toggle("active", mode === "c");
  modeASidebarEl.classList.toggle("active", mode === "a");
  modeBSidebarEl.classList.toggle("active", mode === "b");
}

// ---------- Modus A: Aus meinem Bestand ----------

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
      if (cb.checked) inStock.add(cb.dataset.name);
      else inStock.delete(cb.dataset.name);
      saveInventory(inStock);
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

  let fullEntries = full.map((r) => ({ recipe: r, cost: null }));
  if (aMarginToggleEl.checked) {
    fullEntries = fullEntries.map(({ recipe }) => {
      const cost = calculateRecipeCost(recipe);
      return { recipe, cost: cost.allPricesKnown ? cost.total : null };
    });
    // Günstigerer Wareneinsatz = mehr Marge bei gleichem Verkaufspreis -
    // Rezepte ohne Preisdaten landen hinten statt die Sortierung zu verfälschen.
    fullEntries.sort((a, b) => {
      if (a.cost === null && b.cost === null) return a.recipe.name.localeCompare(b.recipe.name, "de");
      if (a.cost === null) return 1;
      if (b.cost === null) return -1;
      return a.cost - b.cost;
    });
  } else {
    fullEntries.sort((a, b) => a.recipe.name.localeCompare(b.recipe.name, "de"));
  }
  missingOne.sort((a, b) => a.recipe.name.localeCompare(b.recipe.name, "de"));

  aResultsEl.innerHTML = `
    <h3>✓ Kannst du sofort machen (${fullEntries.length})</h3>
    ${
      fullEntries.length === 0
        ? `<p class="empty-note">Mit der aktuell markierten Inventur ist noch kein Rezept komplett abgedeckt.</p>`
        : `<div class="sm-results">${fullEntries
            .map(
              ({ recipe, cost }) => `
            <div class="sm-pitch-card">
              <span class="sm-pitch-name">${escapeHtml(recipe.name)}</span>
              ${cost != null ? `<span class="sm-pitch-type">Wareneinsatz ${formatEuro(cost)}</span>` : ""}
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

// ---------- Modus C: Cross-Sell ----------

function isSellableProduct(product) {
  return SELLABLE_GROUPS.has(product.group);
}

function renderModeCResults() {
  const name = cSearchEl.value.trim();
  if (!name) {
    cResultsEl.innerHTML = `<p class="empty-note">Wähle oben, was der Gast bestellt hat.</p>`;
    return;
  }
  const products = getAllProducts();
  const recipes = getAllRecipes();
  const found = lookupByName(name, products, recipes);
  if (!found) {
    cResultsEl.innerHTML = `<p class="empty-note">Kein Produkt oder Rezept mit diesem Namen gefunden.</p>`;
    return;
  }
  const { type, item } = found;

  // (a) manuell gepflegtes "Passt gut zu" ist immer genauer als jede Heuristik.
  if (item.pairsWith && item.pairsWith.length > 0) {
    const entries = item.pairsWith.map((n) => lookupByName(n, products, recipes)).filter(Boolean);
    cResultsEl.innerHTML =
      entries.length > 0
        ? entries.map(({ type: t, item: i }) => pitchCard(t, i)).join("")
        : `<p class="empty-note">Die hinterlegten "Passt gut zu"-Namen wurden nicht gefunden.</p>`;
    return;
  }

  // (b) algorithmischer Fallback: compatibilityScore, aber nur gegen andere
  // verkaufbare Spirituosen/Wein/Bier/Schaumwein und Cocktails - Mixer,
  // Sirupe, Säfte, Tee/Kaffee sind Zutaten, keine Cross-Sell-Vorschläge.
  let holder;
  if (type === "product") {
    if (!hasFlavorProfile(item)) {
      cResultsEl.innerHTML = `<p class="empty-note">Für "${escapeHtml(item.name)}" ist weder "Passt gut zu" noch ein Aromaprofil hinterlegt.</p>`;
      return;
    }
    holder = item;
  } else {
    const derived = deriveRecipeFlavorProfile(item, products);
    if (!derived) {
      cResultsEl.innerHTML = `<p class="empty-note">Für "${escapeHtml(item.name)}" ist weder "Passt gut zu" noch ein ableitbares Aromaprofil hinterlegt.</p>`;
      return;
    }
    holder = asFlavorProfileHolder(item.name, derived);
  }

  const productCandidates = products
    .filter(isSellableProduct)
    .filter(hasFlavorProfile)
    .filter((p) => p.name !== item.name)
    .filter((p) => type !== "product" || p.group !== item.group)
    .map((p) => ({ type: "product", item: p, holder: p }));

  const recipeCandidates = recipes
    .filter((r) => r.name !== item.name)
    .map((r) => {
      const derived = deriveRecipeFlavorProfile(r, products);
      return derived ? { type: "recipe", item: r, holder: asFlavorProfileHolder(r.name, derived) } : null;
    })
    .filter(Boolean);

  const scored = [...productCandidates, ...recipeCandidates]
    .map((c) => ({ ...c, score: compatibilityScore(holder, c.holder) }))
    .filter((c) => c.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  cResultsEl.innerHTML =
    scored.length === 0
      ? `<p class="empty-note">Keine passenden Vorschläge gefunden.</p>`
      : scored.map(({ type: t, item: i }) => pitchCard(t, i)).join("");
}

function populateModeCOptions() {
  const products = getAllProducts();
  const recipes = getAllRecipes();
  const names = [...new Set([...products.map((p) => p.name), ...recipes.map((r) => r.name)])].sort((a, b) =>
    a.localeCompare(b, "de")
  );
  cOptionsEl.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

// ---------- Init ----------

export function initRecommendations() {
  modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.recMode)));

  aSelectAllBtn.addEventListener("click", () => {
    inStock = new Set(getAllProducts().map((p) => p.name));
    saveInventory(inStock);
    renderChecklist();
    renderModeAResults();
  });
  aSelectNoneBtn.addEventListener("click", () => {
    inStock = new Set();
    saveInventory(inStock);
    renderChecklist();
    renderModeAResults();
  });
  aSearchEl.addEventListener("input", renderChecklist);
  aMarginToggleEl.addEventListener("change", renderModeAResults);

  bSearchEl.addEventListener("input", renderRecipeSidebarList);
  bMarginToggleEl.addEventListener("change", renderModeBResults);

  cSearchEl.addEventListener("change", renderModeCResults);
  cSearchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      renderModeCResults();
    }
  });

  onProductsChanged(() => {
    renderChecklist();
    renderModeAResults();
    renderModeBResults();
    populateModeCOptions();
    renderModeCResults();
  });
  onRecipesChanged(() => {
    renderModeAResults();
    renderRecipeSidebarList();
    renderModeBResults();
    populateModeCOptions();
    renderModeCResults();
  });

  renderChecklist();
  renderModeAResults();
  renderRecipeSidebarList();
  renderModeBResults();
  populateModeCOptions();
}
