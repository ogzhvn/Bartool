import { onRecipesChanged } from "./storage.js";
import { getAllRecipes, getRecipe } from "./recipeLibrary.js";
import { UNIT_LABELS, UNIT_TO_ML } from "./units.js";
import { escapeHtml, formatNumber } from "./utils.js";

const ingredientsEl = document.getElementById("calc-ingredients");
const recipeSelectEl = document.getElementById("calc-recipe-select");
const resultEl = document.getElementById("calc-result");
const targetQuoteEl = document.getElementById("calc-target-quote");
const vatEl = document.getElementById("calc-vat");

const VOLUME_UNITS = new Set(Object.keys(UNIT_TO_ML));

function priceLabelFor(unit) {
  return VOLUME_UNITS.has(unit) ? "€ / Liter" : "€ / Stück";
}

function ingredientCost(amount, unit, price) {
  if (VOLUME_UNITS.has(unit)) {
    const ml = amount * (UNIT_TO_ML[unit] ?? 1);
    return (ml / 1000) * price;
  }
  return amount * price;
}

function formatEuro(n) {
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function makeRow(data = {}) {
  const row = document.createElement("div");
  row.className = "calc-ingredient-row";
  row.innerHTML = `
    <input class="calc-ing-name" type="text" placeholder="Zutat" value="${data.name ?? ""}" />
    <input class="calc-ing-amount" type="number" min="0" step="0.01" placeholder="Menge" value="${data.amount ?? ""}" />
    <select class="calc-ing-unit">
      ${Object.entries(UNIT_LABELS)
        .map(([val, label]) => `<option value="${val}" ${data.unit === val ? "selected" : ""}>${label}</option>`)
        .join("")}
    </select>
    <input class="calc-ing-price" type="number" min="0" step="0.01" placeholder="Preis" value="${data.price ?? ""}" />
    <span class="calc-price-label"></span>
    <span class="calc-cost">0,00 €</span>
    <button type="button" class="remove-btn" title="Entfernen">✕</button>
  `;

  const amountEl = row.querySelector(".calc-ing-amount");
  const unitEl = row.querySelector(".calc-ing-unit");
  const priceEl = row.querySelector(".calc-ing-price");
  const labelEl = row.querySelector(".calc-price-label");
  const costEl = row.querySelector(".calc-cost");

  function updateRow() {
    labelEl.textContent = priceLabelFor(unitEl.value);
    const amount = parseFloat(amountEl.value) || 0;
    const price = parseFloat(priceEl.value) || 0;
    costEl.textContent = formatEuro(ingredientCost(amount, unitEl.value, price));
  }
  [amountEl, unitEl, priceEl].forEach((el) => el.addEventListener("input", updateRow));
  updateRow();

  row.querySelector(".remove-btn").addEventListener("click", () => row.remove());
  return row;
}

function addRow(data) {
  ingredientsEl.appendChild(makeRow(data));
}

function calculate() {
  const rows = [...ingredientsEl.querySelectorAll(".calc-ingredient-row")];
  let total = 0;
  const lines = [];
  rows.forEach((row) => {
    const name = row.querySelector(".calc-ing-name").value.trim();
    const amount = parseFloat(row.querySelector(".calc-ing-amount").value) || 0;
    const unit = row.querySelector(".calc-ing-unit").value;
    const price = parseFloat(row.querySelector(".calc-ing-price").value) || 0;
    if (!name || amount <= 0) return;
    const cost = ingredientCost(amount, unit, price);
    total += cost;
    lines.push({ name, amount, unit, cost });
  });

  resultEl.hidden = false;

  if (lines.length === 0) {
    resultEl.innerHTML = `<p class="empty-note">Bitte mindestens eine gültige Zutat mit Menge eingeben.</p>`;
    return;
  }

  const tableHtml = `
    <table>
      <thead><tr><th>Zutat</th><th>Menge</th><th>Kosten</th></tr></thead>
      <tbody>
        ${lines
          .map(
            (l) =>
              `<tr><td>${escapeHtml(l.name)}</td><td>${formatNumber(l.amount)} ${UNIT_LABELS[l.unit] ?? escapeHtml(l.unit)}</td><td>${formatEuro(l.cost)}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  const targetQuote = parseFloat(targetQuoteEl.value) || 0;
  if (targetQuote <= 0) {
    resultEl.innerHTML = `${tableHtml}<p class="summary">Wareneinsatz gesamt: ${formatEuro(total)}</p>`;
    return;
  }

  const vat = parseFloat(vatEl.value) || 0;
  const priceNet = total / (targetQuote / 100);
  const priceGross = priceNet * (1 + vat / 100);
  const margin = priceNet - total;

  resultEl.innerHTML = `
    ${tableHtml}
    <p class="summary">
      Wareneinsatz gesamt: ${formatEuro(total)}<br />
      Empfohlener Verkaufspreis (netto): ${formatEuro(priceNet)}<br />
      Empfohlener Verkaufspreis (brutto, inkl. ${formatNumber(vat)} % MwSt.): ${formatEuro(priceGross)}<br />
      Rohertrag (Marge): ${formatEuro(margin)}
    </p>
  `;
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
  ingredientsEl.innerHTML = "";
  recipe.ingredients.forEach((ing) => addRow({ name: ing.name, amount: ing.amount, unit: ing.unit }));
  resultEl.hidden = true;
}

function handleClear() {
  ingredientsEl.innerHTML = "";
  addRow();
  recipeSelectEl.value = "";
  resultEl.hidden = true;
}

export function initCalculation() {
  addRow();
  populateRecipeSelect();
  onRecipesChanged(populateRecipeSelect);
  document.getElementById("calc-add-ingredient").addEventListener("click", () => addRow());
  document.getElementById("calc-load-recipe").addEventListener("click", handleLoadRecipe);
  document.getElementById("calc-calculate").addEventListener("click", calculate);
  document.getElementById("calc-clear").addEventListener("click", handleClear);
}
