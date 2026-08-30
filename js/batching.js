import { loadRecipes, saveRecipe, deleteRecipe } from "./storage.js";

const UNIT_TO_ML = {
  ml: 1,
  cl: 10,
  oz: 29.5735,
  bs: 5, // Barlöffel
  dash: 0.9,
};
const NON_VOLUME_UNITS = ["stk", "teile"];
const UNIT_LABELS = {
  ml: "ml",
  cl: "cl",
  oz: "oz",
  bs: "BL",
  dash: "Dash",
  stk: "Stück",
  teile: "Teile",
};

const ingredientsEl = document.getElementById("batch-ingredients");
const resultEl = document.getElementById("batch-result");
const savedListEl = document.getElementById("batch-saved-list");

function makeIngredientRow(data = {}) {
  const row = document.createElement("div");
  row.className = "ingredient-row";
  row.innerHTML = `
    <input class="ing-name" type="text" placeholder="Zutat" value="${data.name ?? ""}" />
    <input class="ing-amount" type="number" min="0" step="0.01" placeholder="Menge" value="${data.amount ?? ""}" />
    <select class="ing-unit">
      ${Object.entries(UNIT_LABELS)
        .map(
          ([val, label]) =>
            `<option value="${val}" ${data.unit === val ? "selected" : ""}>${label}</option>`
        )
        .join("")}
    </select>
    <button type="button" class="remove-btn" title="Entfernen">✕</button>
  `;
  row.querySelector(".remove-btn").addEventListener("click", () => row.remove());
  return row;
}

function addIngredientRow(data) {
  ingredientsEl.appendChild(makeIngredientRow(data));
}

function getIngredients() {
  return [...ingredientsEl.querySelectorAll(".ingredient-row")]
    .map((row) => ({
      name: row.querySelector(".ing-name").value.trim(),
      amount: parseFloat(row.querySelector(".ing-amount").value),
      unit: row.querySelector(".ing-unit").value,
    }))
    .filter((i) => i.name && !Number.isNaN(i.amount) && i.amount > 0);
}

function setIngredients(list) {
  ingredientsEl.innerHTML = "";
  if (!list || list.length === 0) {
    addIngredientRow();
    return;
  }
  list.forEach(addIngredientRow);
}

function updateModeInputs() {
  const mode = document.querySelector('input[name="batch-mode"]:checked').value;
  document.getElementById("batch-target-portions").disabled = mode !== "portions";
  document.getElementById("batch-target-volume").disabled = mode !== "volume";
}

function calculateScale() {
  const ingredients = getIngredients();
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
    factor = targetVolume / baseVolumeMl;
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
              `<tr><td>${ing.name}</td><td>${formatNumber(ing.scaledAmount)} ${UNIT_LABELS[ing.unit]}</td></tr>`
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

function renderSavedRecipes() {
  const recipes = loadRecipes();
  if (recipes.length === 0) {
    savedListEl.innerHTML = `<p class="empty-note">Noch keine Rezepte gespeichert.</p>`;
    return;
  }
  savedListEl.innerHTML = "";
  recipes.forEach((recipe) => {
    const item = document.createElement("div");
    item.className = "saved-item";
    item.innerHTML = `
      <span>${recipe.name}</span>
      <span class="saved-actions">
        <button type="button" class="btn-secondary load-btn">Laden</button>
        <button type="button" class="btn-secondary delete-btn">Löschen</button>
      </span>
    `;
    item.querySelector(".load-btn").addEventListener("click", () => {
      document.getElementById("batch-name").value = recipe.name;
      document.getElementById("batch-base-portions").value = recipe.basePortions;
      setIngredients(recipe.ingredients);
    });
    item.querySelector(".delete-btn").addEventListener("click", () => {
      deleteRecipe(recipe.name);
      renderSavedRecipes();
    });
    savedListEl.appendChild(item);
  });
}

function handleSave() {
  const name = document.getElementById("batch-name").value.trim();
  if (!name) {
    alert("Bitte einen Rezeptnamen eingeben, bevor du speicherst.");
    return;
  }
  const ingredients = getIngredients();
  if (ingredients.length === 0) {
    alert("Bitte mindestens eine gültige Zutat eingeben.");
    return;
  }
  const basePortions = parseFloat(document.getElementById("batch-base-portions").value) || 1;
  saveRecipe({ name, basePortions, ingredients });
  renderSavedRecipes();
}

function handleClear() {
  document.getElementById("batch-name").value = "";
  document.getElementById("batch-base-portions").value = 1;
  setIngredients([]);
  resultEl.hidden = true;
}

export function initBatching() {
  setIngredients([]);
  document.getElementById("batch-add-ingredient").addEventListener("click", () => addIngredientRow());
  document.getElementById("batch-calculate").addEventListener("click", calculateScale);
  document.getElementById("batch-save").addEventListener("click", handleSave);
  document.getElementById("batch-clear").addEventListener("click", handleClear);
  document
    .querySelectorAll('input[name="batch-mode"]')
    .forEach((el) => el.addEventListener("change", updateModeInputs));
  renderSavedRecipes();
}
