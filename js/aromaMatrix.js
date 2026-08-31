import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { onProductsChanged, onRecipesChanged } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { groupSortIndex } from "./products.js";
import { compatibilityScore, sharedDimensions, recipesUsingBoth, hasFlavorProfile } from "./compatibility.js";

const MAX_SELECTED = 3;
const MAX_GRID_PRODUCTS = 30;
const RESULTS_PAGE_SIZE = 20;

const modeButtons = document.querySelectorAll(".aroma-mode-btn");
const listPanelEl = document.getElementById("aroma-list-mode");
const gridPanelEl = document.getElementById("aroma-grid-mode");
const searchEl = document.getElementById("aroma-search");
const searchOptionsEl = document.getElementById("aroma-search-options");
const chipsEl = document.getElementById("aroma-chips");
const resultsEl = document.getElementById("aroma-results");
const gridGroupEl = document.getElementById("aroma-grid-group");
const gridWrapperEl = document.getElementById("aroma-grid-wrapper");
const detailEl = document.getElementById("aroma-detail");

let selectedNames = [];
let showAllResults = false;

function getFlavorProducts() {
  return getAllProducts().filter(hasFlavorProfile);
}

function heatStyle(score) {
  return `background: color-mix(in srgb, var(--heat-low), var(--heat-high) ${score}%);`;
}

function shortLabel(name) {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

function topNeighbors(product, count, excludeNames) {
  const recipes = getAllRecipes();
  const exclude = new Set(excludeNames.map((n) => n.toLowerCase()));
  return getFlavorProducts()
    .filter((p) => !exclude.has(p.name.toLowerCase()))
    .map((p) => ({ product: p, score: compatibilityScore(product, p, recipes) }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

function showDetail(primaryProducts, target) {
  const recipes = getAllRecipes();
  const pairsHtml = primaryProducts
    .map((primary) => {
      const score = compatibilityScore(primary, target, recipes);
      const shared = sharedDimensions(primary.flavorProfile, target.flavorProfile);
      const together = recipesUsingBoth(primary.name, target.name, recipes);
      return `
        <div class="aroma-detail-pair">
          <h4>${escapeHtml(primary.name)} × ${escapeHtml(target.name)} — ${score ?? "–"} / 100</h4>
          ${
            shared.length > 0
              ? `<p><strong>Gemeinsame Aromen:</strong> ${shared.map((s) => `${escapeHtml(s.label)} (${s.a}/${s.b})`).join(", ")}</p>`
              : `<p class="empty-note">Keine gemeinsamen Aroma-Dimensionen.</p>`
          }
          ${together.length > 0 ? `<p><strong>Schon gemeinsam in:</strong> ${together.map((r) => escapeHtml(r.name)).join(", ")}</p>` : ""}
        </div>
      `;
    })
    .join("");

  const excludeNames = [...primaryProducts.map((p) => p.name), target.name];
  const neighbors = topNeighbors(target, 3, excludeNames);
  const neighborsHtml =
    neighbors.length > 0
      ? `<p><strong>${escapeHtml(target.name)} passt außerdem gut zu:</strong> ${neighbors
          .map((n) => `${escapeHtml(n.product.name)} (${n.score})`)
          .join(", ")}</p>`
      : "";

  detailEl.innerHTML = `
    <button type="button" class="btn-secondary aroma-detail-close">✕ Schließen</button>
    <h3>Details</h3>
    ${pairsHtml}
    ${neighborsHtml}
  `;
  detailEl.hidden = false;
  detailEl.querySelector(".aroma-detail-close").addEventListener("click", () => (detailEl.hidden = true));
  detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderChips() {
  chipsEl.innerHTML = selectedNames
    .map(
      (name) => `
      <span class="aroma-chip">
        ${escapeHtml(name)}
        <button type="button" class="aroma-chip-remove" data-name="${escapeHtml(name)}" aria-label="Entfernen">✕</button>
      </span>
    `
    )
    .join("");
  chipsEl.querySelectorAll(".aroma-chip-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedNames = selectedNames.filter((n) => n !== btn.dataset.name);
      showAllResults = false;
      renderChips();
      renderResultsList();
    });
  });
}

function renderResultsList() {
  if (selectedNames.length === 0) {
    resultsEl.innerHTML = `<p class="empty-note">Wähle oben mindestens eine Zutat aus.</p>`;
    return;
  }
  const flavorProducts = getFlavorProducts();
  const selectedProducts = selectedNames.map((n) => flavorProducts.find((p) => p.name === n)).filter(Boolean);
  const recipes = getAllRecipes();
  const candidates = flavorProducts.filter((p) => !selectedNames.includes(p.name));

  const scored = candidates
    .map((product) => {
      const scores = selectedProducts
        .map((sp) => compatibilityScore(sp, product, recipes))
        .filter((s) => s !== null);
      if (scores.length === 0) return null;
      const score = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      return { product, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const withoutProfile = getAllProducts().length - flavorProducts.length;
  const visible = showAllResults ? scored : scored.slice(0, RESULTS_PAGE_SIZE);
  const hiddenCount = scored.length - visible.length;

  resultsEl.innerHTML = `
    ${withoutProfile > 0 ? `<p class="hint">${withoutProfile} Produkte ohne Aromaprofil werden nicht angezeigt.</p>` : ""}
    ${
      scored.length === 0
        ? `<p class="empty-note">Keine passenden Produkte mit Aromaprofil gefunden.</p>`
        : visible
            .map(
              ({ product, score }) => `
        <button type="button" class="aroma-result-row" data-name="${escapeHtml(product.name)}">
          <span class="aroma-result-name">${escapeHtml(product.name)}</span>
          <span class="aroma-result-bar-track"><span class="aroma-result-bar" style="width:${score}%; ${heatStyle(score)}"></span></span>
          <span class="aroma-result-score">${score}</span>
        </button>
      `
            )
            .join("")
    }
    ${
      hiddenCount > 0
        ? `<button type="button" class="btn-secondary aroma-results-more">+ ${hiddenCount} weitere anzeigen</button>`
        : showAllResults && scored.length > RESULTS_PAGE_SIZE
          ? `<button type="button" class="btn-secondary aroma-results-more" data-collapse="1">Weniger anzeigen</button>`
          : ""
    }
  `;
  resultsEl.querySelectorAll(".aroma-result-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = flavorProducts.find((p) => p.name === btn.dataset.name);
      if (target) showDetail(selectedProducts, target);
    });
  });
  const moreBtn = resultsEl.querySelector(".aroma-results-more");
  if (moreBtn) {
    moreBtn.addEventListener("click", () => {
      showAllResults = !moreBtn.dataset.collapse;
      renderResultsList();
    });
  }
}

function handleSearchSubmit() {
  const value = searchEl.value.trim();
  if (!value) return;
  const match = getFlavorProducts().find((p) => p.name.toLowerCase() === value.toLowerCase());
  if (!match) {
    alert("Kein Produkt mit gepflegtem Aromaprofil mit diesem Namen gefunden.");
    return;
  }
  if (selectedNames.includes(match.name)) {
    searchEl.value = "";
    return;
  }
  if (selectedNames.length >= MAX_SELECTED) {
    alert(`Maximal ${MAX_SELECTED} Zutaten gleichzeitig auswählen.`);
    return;
  }
  selectedNames.push(match.name);
  showAllResults = false;
  searchEl.value = "";
  detailEl.hidden = true;
  renderChips();
  renderResultsList();
}

function populateSearchOptions() {
  searchOptionsEl.innerHTML = getFlavorProducts()
    .map((p) => `<option value="${escapeHtml(p.name)}"></option>`)
    .join("");
}

function populateGridGroups() {
  const groups = [...new Set(getFlavorProducts().map((p) => p.group).filter(Boolean))].sort(
    (a, b) => groupSortIndex(a) - groupSortIndex(b) || a.localeCompare(b, "de")
  );
  const current = gridGroupEl.value;
  gridGroupEl.innerHTML = groups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  if (groups.includes(current)) {
    gridGroupEl.value = current;
  } else if (groups.length > 0) {
    gridGroupEl.value = groups[0];
  }
}

function renderGrid() {
  const groupName = gridGroupEl.value;
  const products = getFlavorProducts()
    .filter((p) => p.group === groupName)
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  if (products.length === 0) {
    gridWrapperEl.innerHTML = `<p class="empty-note">Keine Produkte mit Aromaprofil in dieser Gruppe.</p>`;
    return;
  }

  const shown = products.slice(0, MAX_GRID_PRODUCTS);
  const recipes = getAllRecipes();
  const note =
    products.length > MAX_GRID_PRODUCTS
      ? `<p class="hint">Zeigt die ersten ${MAX_GRID_PRODUCTS} von ${products.length} Produkten dieser Gruppe.</p>`
      : "";

  const headerCells = shown.map((p) => `<th title="${escapeHtml(p.name)}">${escapeHtml(shortLabel(p.name))}</th>`).join("");
  const rows = shown
    .map((rowP) => {
      const cells = shown
        .map((colP) => {
          if (rowP.name === colP.name) return `<td class="aroma-grid-self"></td>`;
          const score = compatibilityScore(rowP, colP, recipes);
          return `<td class="aroma-grid-cell" data-row="${escapeHtml(rowP.name)}" data-col="${escapeHtml(colP.name)}" style="${heatStyle(score)}" title="${escapeHtml(rowP.name)} × ${escapeHtml(colP.name)}: ${score}">${score}</td>`;
        })
        .join("");
      return `<tr><th title="${escapeHtml(rowP.name)}">${escapeHtml(shortLabel(rowP.name))}</th>${cells}</tr>`;
    })
    .join("");

  gridWrapperEl.innerHTML = `
    ${note}
    <div class="aroma-grid-scroll">
      <table class="aroma-grid">
        <thead><tr><th></th>${headerCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  gridWrapperEl.querySelectorAll(".aroma-grid-cell").forEach((td) => {
    td.addEventListener("click", () => {
      const rowP = shown.find((p) => p.name === td.dataset.row);
      const colP = shown.find((p) => p.name === td.dataset.col);
      if (rowP && colP) showDetail([rowP], colP);
    });
  });
}

function setMode(mode) {
  modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.mode === mode));
  listPanelEl.classList.toggle("active", mode === "list");
  gridPanelEl.classList.toggle("active", mode === "grid");
  detailEl.hidden = true;
}

export function initAromaMatrix() {
  modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.mode)));
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearchSubmit();
    }
  });
  searchEl.addEventListener("change", handleSearchSubmit);
  gridGroupEl.addEventListener("change", renderGrid);

  onProductsChanged(() => {
    selectedNames = selectedNames.filter((n) => getFlavorProducts().some((p) => p.name === n));
    populateSearchOptions();
    populateGridGroups();
    renderChips();
    renderResultsList();
    renderGrid();
  });
  onRecipesChanged(() => {
    renderResultsList();
    renderGrid();
  });

  populateSearchOptions();
  populateGridGroups();
  renderChips();
  renderResultsList();
  renderGrid();
}
