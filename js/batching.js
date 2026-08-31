import { onRecipesChanged } from "./storage.js";
import { getAllRecipes, getRecipe } from "./recipeLibrary.js";
import { createIngredientEditor } from "./ingredientEditor.js";
import { UNIT_TO_ML, UNIT_LABELS } from "./units.js";
import { escapeHtml } from "./utils.js";

const ingredientsEl = document.getElementById("batch-ingredients");
const resultEl = document.getElementById("batch-result");
const recipeSelectEl = document.getElementById("batch-recipe-select");
const recipeInfoEl = document.getElementById("batch-recipe-info");

const editor = createIngredientEditor(ingredientsEl);

function updateModeInputs() {
  const mode = document.querySelector('input[name="batch-mode"]:checked').value;
  document.getElementById("batch-target-portions").disabled = mode !== "portions";
  document.getElementById("batch-target-volume").disabled = mode !== "volume";
}

function calculateScale() {
  const ingredients = editor.getIngredients();
  if (ingredients.length === 0) {
    resultEl.hidden = false;
    resultEl.innerHTML = `<p class="empty-note">Bitte mindestens eine gültige Zutat eingeben.</p>`;
    return;
  }

  const basePortions = parseFloat(document.getElementById("batch-base-portions").value) || 1;
  const mode = document.querySelector('input[name="batch-mode"]:checked').value;

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
      resultEl.hidden = false;
      resultEl.innerHTML = `<p class="empty-note">Für die Skalierung nach Volumen wird mindestens eine Zutat mit einer Volumeneinheit (ml, cl, oz, BL, Dash) benötigt.</p>`;
      return;
    }
    // Eine Portionszahl wie "14.35" ist nicht umsetzbar: auf die
    // nächstkleinere ganze Portion abrunden und die Zutatenmengen dafür
    // berechnen, statt exakt auf das eingegebene Ziel-Volumen zu skalieren.
    const rawPortions = basePortions * (targetVolume / baseVolumeMl);
    const flooredPortions = Math.floor(rawPortions);
    if (flooredPortions < 1) {
      resultEl.hidden = false;
      resultEl.innerHTML = `<p class="empty-note">Das Ziel-Volumen reicht nicht für eine ganze Portion.</p>`;
      return;
    }
    factor = flooredPortions / basePortions;
  }

  const scaled = ingredients.map((ing) => ({
    ...ing,
    scaledAmount: ing.amount * factor,
  }));

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
    <p class="summary">Ergibt ca. ${formatNumber(resultingPortions)} Portionen${
    totalVolumeMl > 0 ? ` · Gesamtvolumen: ${formatNumber(totalVolumeMl)} ml (${formatNumber(totalVolumeMl / 1000)} l)` : ""
  }</p>
  `;
}

function formatNumber(n) {
  return Number(n.toFixed(2)).toString();
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
  resultEl.hidden = true;
  renderRecipeInfo(recipe);
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
  recipeInfoEl.hidden = true;
}

export function initBatching() {
  editor.setIngredients([]);
  populateRecipeSelect();
  onRecipesChanged(populateRecipeSelect);
  document.getElementById("batch-add-ingredient").addEventListener("click", () => editor.addRow());
  document.getElementById("batch-load-recipe").addEventListener("click", handleLoadRecipe);
  document.getElementById("batch-calculate").addEventListener("click", calculateScale);
  document.getElementById("batch-clear").addEventListener("click", handleClear);
  document
    .querySelectorAll('input[name="batch-mode"]')
    .forEach((el) => el.addEventListener("change", updateModeInputs));
}
