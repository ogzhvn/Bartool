import { switchTab } from "./tabs.js";
import { getAllRecipes } from "./recipeLibrary.js";
import {
  loadRecipes,
  loadProducts,
  loadShiftLogs,
  onRecipesChanged,
  onProductsChanged,
  onShiftLogsChanged,
} from "./storage.js";
import { getCurrentProfile, getCurrentUser } from "./auth.js";
import { getFavorites, getRecent, onFavoritesChanged } from "./favorites.js";
import { offeneAusLetzterSchicht } from "./shiftLog.js";
import { focusRecipe } from "./recipes.js";
import { focusProduct } from "./products.js";
import { escapeHtml } from "./utils.js";
import { t, onLanguageChanged } from "./i18n.js";

const greetingEl = document.getElementById("home-greeting");
const statsEl = document.getElementById("home-stats");
const favWrapEl = document.getElementById("home-favorites-wrap");
const favListEl = document.getElementById("home-favorites");
const recentWrapEl = document.getElementById("home-recent-wrap");
const recentListEl = document.getElementById("home-recent");

function renderGreeting() {
  const profile = getCurrentProfile();
  const user = getCurrentUser();
  const name = profile?.display_name || user?.email?.split("@")[0] || "";
  greetingEl.textContent = name ? `${t("ui.willkommen_zurueck")} ${name}` : t("ui.willkommen_bei_bartool");
}

function renderStats() {
  const stats = [
    [getAllRecipes().length, t("ui.rezepte_im_buch")],
    [loadRecipes().length, t("ui.davon_eigene")],
    [loadProducts().length, t("ui.produkte_im_katalog")],
    [offeneAusLetzterSchicht(loadShiftLogs()).length, t("ui.offene_punkte_aus_der_letzten_schicht")],
  ];
  statsEl.innerHTML = stats
    .map(
      ([value, label]) => `
      <div class="stat-tile">
        <span class="stat-value">${value}</span>
        <span class="stat-label">${label}</span>
      </div>`
    )
    .join("");
}

// Springt zum Eintrag – in die Leseansicht, nicht ins Formular.
function oeffne(art, name) {
  if (art === "recipe") {
    switchTab("recipes");
    focusRecipe(name);
  } else {
    switchTab("products");
    focusProduct(name);
  }
}

function renderShortcutList(el, wrapEl, eintraege) {
  // Leere Blöcke ganz ausblenden statt einen leeren Kasten zu zeigen.
  wrapEl.hidden = eintraege.length === 0;
  if (eintraege.length === 0) return;
  el.innerHTML = eintraege
    .map(
      (e) => `
      <button type="button" class="shortcut-chip" data-art="${escapeHtml(e.art)}" data-name="${escapeHtml(e.name)}">
        <i class="ph ${e.art === "recipe" ? "ph-book-open" : "ph-wine"}" aria-hidden="true"></i>
        ${escapeHtml(e.name)}
      </button>`
    )
    .join("");
}

function renderShortcuts() {
  renderShortcutList(favListEl, favWrapEl, getFavorites());
  renderShortcutList(recentListEl, recentWrapEl, getRecent());
}

export function initHome() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    renderGreeting();
    renderStats();
    renderShortcuts();
  });

  renderGreeting();
  renderStats();
  renderShortcuts();
  onRecipesChanged(renderStats);
  onProductsChanged(renderStats);
  onShiftLogsChanged(renderStats);
  onFavoritesChanged(renderShortcuts);

  [favListEl, recentListEl].forEach((el) =>
    el.addEventListener("click", (e) => {
      const chip = e.target.closest(".shortcut-chip");
      if (chip) oeffne(chip.dataset.art, chip.dataset.name);
    })
  );
  document.querySelectorAll("#home .tool-card").forEach((card) => {
    card.addEventListener("click", () => switchTab(card.dataset.tab));
  });
}
