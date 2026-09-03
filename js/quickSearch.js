import { getAllRecipes } from "./recipeLibrary.js";
import { getAllProducts } from "./productLibrary.js";
import { switchTab, closeMobileNav } from "./tabs.js";
import { focusRecipe } from "./recipes.js";
import { focusProduct } from "./products.js";
import { escapeHtml } from "./utils.js";

const MAX_PER_GROUP = 8;

const overlayEl = document.getElementById("quick-search-overlay");
const inputEl = document.getElementById("quick-search-input");
const resultsEl = document.getElementById("quick-search-results");
const openBtn = document.getElementById("quick-search-btn");

let hits = [];
let activeIndex = -1;

function matches(item, query) {
  return item.name.toLowerCase().includes(query) || (item.category ?? "").toLowerCase().includes(query);
}

function collectHits(query) {
  const recipeHits = getAllRecipes()
    .filter((r) => matches(r, query))
    .slice(0, MAX_PER_GROUP)
    .map((r) => ({ type: "recipes", name: r.name, category: r.category ?? "" }));
  const productHits = getAllProducts()
    .filter((p) => matches(p, query))
    .slice(0, MAX_PER_GROUP)
    .map((p) => ({ type: "products", name: p.name, category: p.category ?? "" }));
  return [...recipeHits, ...productHits];
}

function renderResults() {
  if (hits.length === 0) {
    resultsEl.innerHTML = `<p class="quick-search-empty">Keine Treffer.</p>`;
    return;
  }
  const groups = [
    ["Rezepte", hits.filter((h) => h.type === "recipes")],
    ["Produkte", hits.filter((h) => h.type === "products")],
  ].filter(([, items]) => items.length > 0);

  resultsEl.innerHTML = groups
    .map(
      ([label, items]) => `
        <h3 class="quick-search-group-title">${escapeHtml(label)}</h3>
        ${items
          .map((item) => {
            const index = hits.indexOf(item);
            return `
              <button type="button" class="quick-search-hit${index === activeIndex ? " active" : ""}" data-index="${index}">
                <span>${escapeHtml(item.name)}</span>
                ${item.category ? `<span class="quick-search-hit-category">${escapeHtml(item.category)}</span>` : ""}
              </button>
            `;
          })
          .join("")}
      `
    )
    .join("");

  resultsEl.querySelectorAll(".quick-search-hit").forEach((btn) => {
    btn.addEventListener("click", () => selectHit(Number(btn.dataset.index)));
  });
}

function selectHit(index) {
  const hit = hits[index];
  if (!hit) return;
  closeOverlay();
  switchTab(hit.type);
  closeMobileNav();
  if (hit.type === "recipes") {
    focusRecipe(hit.name);
  } else {
    focusProduct(hit.name);
  }
}

function updateActive(newIndex) {
  activeIndex = newIndex;
  renderResults();
}

function handleInput() {
  const query = inputEl.value.trim().toLowerCase();
  hits = query ? collectHits(query) : [];
  activeIndex = hits.length > 0 ? 0 : -1;
  renderResults();
}

function openOverlay() {
  overlayEl.hidden = false;
  inputEl.value = "";
  hits = [];
  activeIndex = -1;
  resultsEl.innerHTML = "";
  inputEl.focus();
}

function closeOverlay() {
  overlayEl.hidden = true;
}

function handleKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (overlayEl.hidden) openOverlay();
    else closeOverlay();
    return;
  }
  if (overlayEl.hidden) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeOverlay();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (hits.length > 0) updateActive((activeIndex + 1) % hits.length);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (hits.length > 0) updateActive((activeIndex - 1 + hits.length) % hits.length);
  } else if (e.key === "Enter") {
    e.preventDefault();
    selectHit(activeIndex);
  }
}

export function initQuickSearch() {
  openBtn.addEventListener("click", openOverlay);
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) closeOverlay();
  });
  inputEl.addEventListener("input", handleInput);
  document.addEventListener("keydown", handleKeydown);
}
