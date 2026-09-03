import { escapeHtml, formatNumber } from "./utils.js";
import { alcoholMl, abvAfterWater, parseAbv } from "./abv.js";
import { getAllRecipes, getRecipe } from "./recipeLibrary.js";
import { getAllProducts, getProduct } from "./productLibrary.js";
import { onRecipesChanged, onProductsChanged } from "./storage.js";
import { UNIT_TO_ML, UNIT_LABELS } from "./units.js";

const panelEl = document.getElementById("dilution");
const ingredientsEl = document.getElementById("dil-ingredients");
const resultEl = document.getElementById("dil-result");
const totalEl = document.getElementById("dil-total");
const totalValueEl = document.getElementById("dil-total-value");
const totalSubEl = document.getElementById("dil-total-sub");
const recipeSelectEl = document.getElementById("dil-recipe-select");
const productOptionsEl = document.getElementById("dil-product-options");
const recipeNoteEl = document.getElementById("dil-recipe-note");

function makeIngredientRow(data = {}) {
  const row = document.createElement("div");
  row.className = "ingredient-row";
  row.innerHTML = `
    <input class="ing-name" type="text" placeholder="Zutat" list="dil-product-options" value="${escapeHtml(data.name ?? "")}" />
    <input class="ing-amount" type="number" min="0" step="0.1" placeholder="ml" value="${escapeHtml(data.amount ?? "")}" />
    <input class="ing-abv" type="number" min="0" max="100" step="0.1" placeholder="ABV %" value="${escapeHtml(data.abv ?? "")}" />
    <button type="button" class="remove-btn" title="Entfernen">✕</button>
  `;

  const nameEl = row.querySelector(".ing-name");
  const abvEl = row.querySelector(".ing-abv");

  // Alkoholgehalt aus dem Produktkatalog einsetzen, sobald ein bekannter
  // Name dasteht – aber nie einen selbst eingetragenen Wert überschreiben.
  function abvVorbelegen() {
    if (abvEl.value !== "") return;
    const produkt = getProduct(nameEl.value.trim());
    const wert = produkt ? parseAbv(produkt.abv) : null;
    if (wert !== null) {
      abvEl.value = wert;
      calculate();
    }
  }

  nameEl.addEventListener("blur", abvVorbelegen);
  nameEl.addEventListener("change", abvVorbelegen);

  row.querySelector(".remove-btn").addEventListener("click", () => row.remove());
  return row;
}

function addIngredientRow(data) {
  ingredientsEl.appendChild(makeIngredientRow(data));
}

function getIngredients() {
  return [...ingredientsEl.querySelectorAll(".ingredient-row")]
    .map((row) => ({
      name: row.querySelector(".ing-name").value.trim() || "Zutat",
      amount: parseFloat(row.querySelector(".ing-amount").value),
      abv: parseFloat(row.querySelector(".ing-abv").value),
    }))
    .filter((i) => !Number.isNaN(i.amount) && i.amount > 0 && !Number.isNaN(i.abv));
}

function currentMode() {
  return document.querySelector('input[name="dil-mode"]:checked').value;
}

function updateModeInputs() {
  const mode = currentMode();
  panelEl.querySelectorAll("[data-mode-field]").forEach((el) => {
    el.hidden = el.dataset.modeField !== mode;
  });
  calculate();
}

function showNote(message) {
  resultEl.hidden = false;
  resultEl.innerHTML = `<p class="empty-note">${message}</p>`;
  totalEl.hidden = true;
}

function calculate() {
  const ingredients = getIngredients();
  if (ingredients.length === 0) {
    resultEl.hidden = true;
    totalEl.hidden = true;
    return;
  }

  const preVolume = ingredients.reduce((sum, i) => sum + i.amount, 0);
  const totalAlcohol = alcoholMl(ingredients.map((i) => ({ amountMl: i.amount, abv: i.abv })));
  const preAbv = abvAfterWater(totalAlcohol, preVolume, 0);

  const mode = currentMode();
  let dilutionMl;
  let finalVolume;
  if (mode === "percent") {
    const percent = parseFloat(document.getElementById("dil-percent").value) || 0;
    if (percent >= 100) {
      showNote("Verdünnung muss unter 100 % liegen.");
      return;
    }
    finalVolume = preVolume / (1 - percent / 100);
    dilutionMl = finalVolume - preVolume;
  } else {
    dilutionMl = parseFloat(document.getElementById("dil-ml").value) || 0;
    finalVolume = preVolume + dilutionMl;
  }

  const finalAbv = abvAfterWater(totalAlcohol, preVolume, dilutionMl);
  const dilutionPercentOfFinal = (dilutionMl / finalVolume) * 100;

  resultEl.hidden = false;
  resultEl.innerHTML = `
    <table>
      <thead><tr><th>Zutat</th><th>Menge</th><th>ABV</th></tr></thead>
      <tbody>
        ${ingredients
          .map((i) => `<tr><td>${i.name}</td><td>${formatNumber(i.amount)} ml</td><td>${formatNumber(i.abv)} %</td></tr>`)
          .join("")}
      </tbody>
    </table>
    <p class="summary">
      Vor Verdünnung: ${formatNumber(preVolume)} ml · ${formatNumber(preAbv)} % ABV<br />
      Verdünnung: ${formatNumber(dilutionMl)} ml (${formatNumber(dilutionPercentOfFinal)} % des Endvolumens)
    </p>
  `;

  totalEl.hidden = false;
  totalValueEl.textContent = `${formatNumber(finalAbv)} %`;
  totalSubEl.textContent = `Endvolumen ${formatNumber(finalVolume)} ml · vorher ${formatNumber(preAbv)} %`;
}

function stepPercent(delta) {
  const input = document.getElementById("dil-percent");
  const next = Math.min(95, Math.max(0, (parseFloat(input.value) || 0) + delta));
  input.value = next;
  calculate();
}

// Alle Produktnamen als Vorschlagsliste für die Zutatenfelder.
function populateProductOptions() {
  productOptionsEl.innerHTML = getAllProducts()
    .map((p) => `<option value="${escapeHtml(p.name)}"></option>`)
    .join("");
}

function populateRecipeSelect() {
  const recipes = getAllRecipes();
  const bisher = recipeSelectEl.value;
  recipeSelectEl.innerHTML =
    `<option value="">– Rezept auswählen –</option>` +
    recipes.map((r) => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join("");
  if (recipes.some((r) => r.name === bisher)) recipeSelectEl.value = bisher;
}

// Lädt ein Rezept in die Zutatenliste. Dieser Rechner arbeitet in ml, also
// werden cl, oz, Barlöffel und Dash umgerechnet. Stückzutaten (Stück, Teile)
// haben kein Volumen und werden übersprungen – das wird sichtbar gemeldet,
// damit niemand mit einer unvollständigen Liste weiterrechnet.
function handleLoadRecipe() {
  const name = recipeSelectEl.value;
  if (!name) {
    alert("Bitte zuerst ein Rezept auswählen.");
    return;
  }
  const recipe = getRecipe(name);
  if (!recipe) return;

  const uebersprungen = [];
  const zeilen = [];
  recipe.ingredients.forEach((ing) => {
    const toMl = UNIT_TO_ML[ing.unit];
    if (!toMl) {
      uebersprungen.push(`${ing.name} (${formatNumber(ing.amount)} ${UNIT_LABELS[ing.unit] ?? ing.unit})`);
      return;
    }
    const produkt = getProduct(ing.name);
    const abv = produkt ? parseAbv(produkt.abv) : null;
    zeilen.push({ name: ing.name, amount: ing.amount * toMl, abv: abv ?? "" });
  });

  ingredientsEl.innerHTML = "";
  if (zeilen.length === 0) {
    addIngredientRow();
  } else {
    zeilen.forEach(addIngredientRow);
  }

  const ohneAbv = zeilen.filter((z) => z.abv === "").map((z) => z.name);
  const hinweise = [];
  if (uebersprungen.length > 0) {
    hinweise.push(`Ohne Volumen und deshalb nicht übernommen: ${uebersprungen.join(", ")}.`);
  }
  if (ohneAbv.length > 0) {
    hinweise.push(`Kein Alkoholgehalt im Produktkatalog gefunden für: ${ohneAbv.join(", ")}. Bitte selbst eintragen.`);
  }
  recipeNoteEl.hidden = hinweise.length === 0;
  recipeNoteEl.textContent = hinweise.join(" ");

  calculate();
}

export function initDilution() {
  populateProductOptions();
  populateRecipeSelect();
  onProductsChanged(populateProductOptions);
  onRecipesChanged(populateRecipeSelect);
  document.getElementById("dil-load-recipe").addEventListener("click", handleLoadRecipe);
  addIngredientRow();
  document.getElementById("dil-add-ingredient").addEventListener("click", addIngredientRow);
  document.getElementById("dil-percent-minus").addEventListener("click", () => stepPercent(-5));
  document.getElementById("dil-percent-plus").addEventListener("click", () => stepPercent(5));
  document
    .querySelectorAll('input[name="dil-mode"]')
    .forEach((el) => el.addEventListener("change", updateModeInputs));
  // Live rechnen: jede Eingabe im Panel löst eine Neuberechnung aus.
  const recalcFromEvent = (e) => {
    if (e.target.id === "dil-recipe-select") return;
    calculate();
  };
  panelEl.addEventListener("input", recalcFromEvent);
  panelEl.addEventListener("change", recalcFromEvent);
  // Eine entfernte Zutatenzeile ist kein input-Event – nach dem Klick neu rechnen.
  panelEl.addEventListener("click", (e) => {
    if (e.target.closest(".remove-btn")) calculate();
  });
  updateModeInputs();
}
