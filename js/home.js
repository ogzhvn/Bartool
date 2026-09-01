import { switchTab } from "./tabs.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { loadRecipes, loadProducts, onRecipesChanged, onProductsChanged } from "./storage.js";
import { getCurrentProfile, getCurrentUser } from "./auth.js";

const greetingEl = document.getElementById("home-greeting");
const statsEl = document.getElementById("home-stats");

function renderGreeting() {
  const profile = getCurrentProfile();
  const user = getCurrentUser();
  const name = profile?.display_name || user?.email?.split("@")[0] || "";
  greetingEl.textContent = name ? `Willkommen zurück, ${name}` : "Willkommen bei Bartool";
}

function renderStats() {
  const stats = [
    [getAllRecipes().length, "Rezepte im Buch"],
    [loadRecipes().length, "davon eigene"],
    [loadProducts().length, "Produkte im Katalog"],
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

export function initHome() {
  renderGreeting();
  renderStats();
  onRecipesChanged(renderStats);
  onProductsChanged(renderStats);
  document.querySelectorAll("#home .tool-card").forEach((card) => {
    card.addEventListener("click", () => switchTab(card.dataset.tab));
  });
}
