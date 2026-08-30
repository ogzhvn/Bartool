import { initBatching } from "./batching.js";
import { initRecipes } from "./recipes.js";
import { initSuperjuice } from "./superjuice.js";
import { initDilution } from "./dilution.js";

function initTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

initTabs();
initRecipes();
initBatching();
initSuperjuice();
initDilution();
