import { onRecipesChanged } from "./storage.js";
import { getAllRecipes, getRecipe } from "./recipeLibrary.js";
import { createIngredientEditor } from "./ingredientEditor.js";
import { UNIT_TO_ML, UNIT_LABELS } from "./units.js";
import { escapeHtml, formatNumber } from "./utils.js";

const panelEl = document.getElementById("batching");
const ingredientsEl = document.getElementById("batch-ingredients");
const resultEl = document.getElementById("batch-result");
const totalEl = document.getElementById("batch-total");
const totalValueEl = document.getElementById("batch-total-value");
const totalSubEl = document.getElementById("batch-total-sub");
const recipeSelectEl = document.getElementById("batch-recipe-select");
const recipeInfoEl = document.getElementById("batch-recipe-info");

const editor = createIngredientEditor(ingredientsEl);

function currentMode() {
  return document.querySelector('input[name="batch-mode"]:checked').value;
}

function updateModeInputs() {
  const mode = currentMode();
  panelEl.querySelectorAll("[data-mode-field]").forEach((el) => {
    el.hidden = el.dataset.modeField !== mode;
  });
  calculateScale();
}

function showNote(message) {
  resultEl.hidden = false;
  resultEl.innerHTML = `<p class="empty-note">${message}</p>`;
  totalEl.hidden = true;
}

function calculateScale() {
  const ingredients = editor.getIngredients();
  if (ingredients.length === 0) {
    resultEl.hidden = true;
    totalEl.hidden = true;
    return;
  }

  const basePortions = parseFloat(document.getElementById("batch-base-portions").value) || 1;
  const mode = currentMode();

  let factor;
  if (mode === "portions") {
    const targetPortions = parseFloat(document.getElementById("batch-target-portions").value) || 0;
    factor = targetPortions / basePortions;
  } else {
    const targetVolume = parseFloat(document.getElementById("batch-target-volume").value) || 0;
    const baseVolumeMl = ingredients.reduce((sum, ing) => {
      const toMl = UNIT_TO_ML[ing.unit];
      return toMl ? sum + ing.amount * toMl : sum;
    }, 0);
    if (baseVolumeMl === 0) {
      showNote(
        "Für die Skalierung nach Volumen wird mindestens eine Zutat mit einer Volumeneinheit (ml, cl, oz, BL, Dash) benötigt."
      );
      return;
    }
    // Eine Portionszahl wie "14.35" ist nicht umsetzbar: auf die
    // nächstkleinere ganze Portion abrunden und die Zutatenmengen dafür
    // berechnen, statt exakt auf das eingegebene Ziel-Volumen zu skalieren.
    const rawPortions = basePortions * (targetVolume / baseVolumeMl);
    const flooredPortions = Math.floor(rawPortions);
    if (flooredPortions < 1) {
      showNote("Das Ziel-Volumen reicht nicht für eine ganze Portion.");
      return;
    }
    factor = flooredPortions / basePortions;
  }

  if (!(factor > 0)) {
    resultEl.hidden = true;
    totalEl.hidden = true;
    return;
  }

  const scaled = ingredients.map((ing) => ({ ...ing, scaledAmount: ing.amount * factor }));
  const totalVolumeMl = scaled.reduce((sum, ing) => {
    const toMl = UNIT_TO_ML[ing.unit];
    return toMl ? sum + ing.scaledAmount * toMl : sum;
  }, 0);
  const resultingPortions = basePortions * factor;

  resultEl.hidden = false;
  resultEl.innerHTML = `
    <table>
      <thead><tr><th>Zutat</th><th>Menge</th></tr></thead>
      <tbody>
        ${scaled
          .map(
            (ing) =>
              `<tr><td>${escapeHtml(ing.name)}</td><td>${formatNumber(ing.scaledAmount)} ${UNIT_LABELS[ing.unit]}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  if (totalVolumeMl > 0) {
    totalEl.hidden = false;
    totalValueEl.textContent = `${formatNumber(totalVolumeMl)} ml`;
    totalSubEl.textContent = `${formatNumber(totalVolumeMl / 1000)} l · ${formatNumber(resultingPortions)} Portionen`;
  } else {
    totalEl.hidden = false;
    totalValueEl.textContent = `${formatNumber(resultingPortions)} Portionen`;
    totalSubEl.textContent = "Kein Volumen berechenbar – nur Stückzutaten";
  }
}

function stepPortions(delta) {
  const input = document.getElementById("batch-target-portions");
  const next = Math.max(1, Math.round((parseFloat(input.value) || 0) + delta));
  input.value = next;
  calculateScale();
}

async function shareResult() {
  const rows = editor
    .getIngredients()
    .map((ing) => `${ing.name}: ${formatNumber(ing.amount)} ${UNIT_LABELS[ing.unit]}`);
  const name = document.getElementById("batch-name").value || "Batch";
  const text = [`${name} – ${totalValueEl.textContent} (${totalSubEl.textContent})`, ...rows].join("\n");
  if (navigator.share) {
    try {
      await navigator.share({ title: name, text });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  if (navigator.clipboard) await navigator.clipboard.writeText(text);
}

function populateRecipeSelect() {
  const recipes = getAllRecipes();
  const currentValue = recipeSelectEl.value;
  recipeSelectEl.innerHTML =
    `<option value="">– Rezept auswählen –</option>` +
    recipes.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join("");
  if (recipes.some((r) => r.name === currentValue)) {
    recipeSelectEl.value = currentValue;
  }
}

function handleLoadRecipe() {
  const name = recipeSelectEl.value;
  if (!name) {
    alert("Bitte zuerst ein Rezept auswählen.");
    return;
  }
  const recipe = getRecipe(name);
  if (!recipe) return;
  document.getElementById("batch-name").value = recipe.name;
  document.getElementById("batch-base-portions").value = recipe.basePortions;
  editor.setIngredients(recipe.ingredients);
  renderRecipeInfo(recipe);
  calculateScale();
}

function renderRecipeInfo(recipe) {
  const rows = [
    ["Glas", recipe.glass],
    ["Garnitur", recipe.garnish],
    ["Eis", recipe.ice],
    ["Zubereitung", recipe.method],
    ["Geschichte", recipe.history],
  ].filter(([, value]) => value);

  if (rows.length === 0) {
    recipeInfoEl.hidden = true;
    return;
  }
  recipeInfoEl.hidden = false;
  recipeInfoEl.innerHTML = rows
    .map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`)
    .join("");
}

function handleClear() {
  document.getElementById("batch-name").value = "";
  document.getElementById("batch-base-portions").value = 1;
  recipeSelectEl.value = "";
  editor.setIngredients([]);
  resultEl.hidden = true;
  totalEl.hidden = true;
  recipeInfoEl.hidden = true;
}

export function initBatching() {
  editor.setIngredients([]);
  populateRecipeSelect();
  onRecipesChanged(populateRecipeSelect);
  document.getElementById("batch-add-ingredient").addEventListener("click", () => editor.addRow());
  document.getElementById("batch-load-recipe").addEventListener("click", handleLoadRecipe);
  document.getElementById("batch-clear").addEventListener("click", handleClear);
  document.getElementById("batch-portions-minus").addEventListener("click", () => stepPortions(-1));
  document.getElementById("batch-portions-plus").addEventListener("click", () => stepPortions(1));
  document.getElementById("batch-share").addEventListener("click", shareResult);
  document.querySelectorAll('input[name="batch-mode"]').forEach((el) => el.addEventListener("change", updateModeInputs));
  // Live rechnen: jede Eingabe im Panel löst eine Neuberechnung aus.
  const recalcFromEvent = (e) => {
    if (e.target.id === "batch-recipe-select") return;
    calculateScale();
  };
  panelEl.addEventListener("input", recalcFromEvent);
  panelEl.addEventListener("change", recalcFromEvent);
  // Eine entfernte Zutatenzeile ist kein input-Event – nach dem Klick neu rechnen.
  panelEl.addEventListener("click", (e) => {
    if (e.target.closest(".remove-btn")) calculateScale();
  });
  updateModeInputs();
}
