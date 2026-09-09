import { onRecipesChanged } from "./storage.js";
import { getAllRecipes, getRecipe } from "./recipeLibrary.js";
import { UNIT_LABELS } from "./units.js";
import { escapeHtml, formatNumber } from "./utils.js";
import { priceLabelFor, ingredientCost, priceForIngredient } from "./costing.js";
import { applyTranslations, getLocale, onLanguageChanged, t } from "./i18n.js";

const panelEl = document.getElementById("calculation");
const ingredientsEl = document.getElementById("calc-ingredients");
const totalEl = document.getElementById("calc-total");
const totalValueEl = document.getElementById("calc-total-value");
const totalSubEl = document.getElementById("calc-total-sub");
const recipeSelectEl = document.getElementById("calc-recipe-select");
const resultEl = document.getElementById("calc-result");
const targetQuoteEl = document.getElementById("calc-target-quote");
const vatEl = document.getElementById("calc-vat");

function formatEuro(n) {
  return `${n.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function makeRow(data = {}) {
  const row = document.createElement("div");
  row.className = "calc-ingredient-row";
  row.innerHTML = `
    <input class="calc-ing-name" type="text" placeholder="${t("ui.zutat")}" data-i18n-placeholder="ui.zutat" value="${escapeHtml(data.name ?? "")}" />
    <input class="calc-ing-amount" type="number" min="0" step="0.01" placeholder="${t("ui.menge")}" data-i18n-placeholder="ui.menge" value="${escapeHtml(data.amount ?? "")}" />
    <select class="calc-ing-unit">
      ${Object.entries(UNIT_LABELS)
        .map(([val, label]) => `<option value="${val}" ${data.unit === val ? "selected" : ""}>${label}</option>`)
        .join("")}
    </select>
    <input class="calc-ing-price" type="number" min="0" step="0.01" placeholder="${t("ui.preis")}" data-i18n-placeholder="ui.preis" value="${escapeHtml(data.price ?? "")}" />
    <span class="calc-price-label"></span>
    <span class="calc-cost">0,00 €</span>
    <button type="button" class="remove-btn" title="${t("ui.entfernen")}" data-i18n-title="ui.entfernen">✕</button>
  `;

  const nameEl = row.querySelector(".calc-ing-name");
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
  // Autofill the price from the product catalog when a known ingredient name
  // is entered, but only while the field is still empty – never overwrite a
  // price the user already typed or adjusted.
  nameEl.addEventListener("blur", () => {
    if (priceEl.value) return;
    const price = priceForIngredient(nameEl.value.trim());
    if (price !== null) {
      priceEl.value = price;
      updateRow();
    }
  });
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

  if (lines.length === 0) {
    resultEl.hidden = true;
    totalEl.hidden = true;
    return;
  }

  resultEl.hidden = false;

  const tableHtml = `
    <table>
      <thead><tr><th>${t("ui.zutat")}</th><th>${t("ui.menge")}</th><th>${t("ui.kosten")}</th></tr></thead>
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
    resultEl.innerHTML = tableHtml;
    totalEl.hidden = false;
    totalValueEl.textContent = formatEuro(total);
    totalSubEl.textContent = t("ui.wareneinsatz_gesamt_ohne_ziel_quote_kein_cdf4");
    return;
  }

  const vat = parseFloat(vatEl.value) || 0;
  const priceNet = total / (targetQuote / 100);
  const priceGross = priceNet * (1 + vat / 100);
  const margin = priceNet - total;

  resultEl.innerHTML = `
    ${tableHtml}
    <p class="summary">
      ${t("ui.wareneinsatz_gesamt")} ${formatEuro(total)}<br />
      ${t("ui.verkaufspreis_netto")} ${formatEuro(priceNet)}<br />
      ${t("ui.rohertrag_marge")} ${formatEuro(margin)}
    </p>
  `;

  totalEl.hidden = false;
  totalValueEl.textContent = formatEuro(priceGross);
  totalSubEl.textContent = `inkl. ${formatNumber(vat)} ${t("ui.mwst_wareneinsatz")} ${formatEuro(total)} ${t("ui.marge")} ${formatEuro(margin)}`;
}

function populateRecipeSelect() {
  const recipes = getAllRecipes();
  const currentValue = recipeSelectEl.value;
  recipeSelectEl.innerHTML =
    `<option value="">${t("ui.rezept_auswaehlen")}</option>` +
    recipes.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join("");
  if (recipes.some((r) => r.name === currentValue)) {
    recipeSelectEl.value = currentValue;
  }
}

function handleLoadRecipe() {
  const name = recipeSelectEl.value;
  if (!name) {
    alert(t("ui.bitte_zuerst_ein_rezept_auswaehlen"));
    return;
  }
  const recipe = getRecipe(name);
  if (!recipe) return;
  ingredientsEl.innerHTML = "";
  recipe.ingredients.forEach((ing) =>
    addRow({ name: ing.name, amount: ing.amount, unit: ing.unit, price: priceForIngredient(ing.name) ?? "" })
  );
  calculate();
}

function handleClear() {
  ingredientsEl.innerHTML = "";
  addRow();
  recipeSelectEl.value = "";
  resultEl.hidden = true;
  totalEl.hidden = true;
}

export function initCalculation() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    populateRecipeSelect();
    calculate();
    applyTranslations(panelEl);
  });

  addRow();
  populateRecipeSelect();
  onRecipesChanged(populateRecipeSelect);
  document.getElementById("calc-add-ingredient").addEventListener("click", () => addRow());
  document.getElementById("calc-load-recipe").addEventListener("click", handleLoadRecipe);
  document.getElementById("calc-clear").addEventListener("click", handleClear);
  // Live rechnen: jede Eingabe im Panel löst eine Neuberechnung aus.
  const recalcFromEvent = (e) => {
    if (e.target.id === "calc-recipe-select") return;
    calculate();
  };
  panelEl.addEventListener("input", recalcFromEvent);
  panelEl.addEventListener("change", recalcFromEvent);
  // Eine entfernte Zutatenzeile ist kein input-Event – nach dem Klick neu rechnen.
  panelEl.addEventListener("click", (e) => {
    if (e.target.closest(".remove-btn")) calculate();
  });
}
