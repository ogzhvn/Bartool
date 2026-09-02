import { formatNumber } from "./utils.js";

const panelEl = document.getElementById("dilution");
const ingredientsEl = document.getElementById("dil-ingredients");
const resultEl = document.getElementById("dil-result");
const totalEl = document.getElementById("dil-total");
const totalValueEl = document.getElementById("dil-total-value");
const totalSubEl = document.getElementById("dil-total-sub");

function makeIngredientRow() {
  const row = document.createElement("div");
  row.className = "ingredient-row";
  row.innerHTML = `
    <input class="ing-name" type="text" placeholder="Zutat" />
    <input class="ing-amount" type="number" min="0" step="0.1" placeholder="ml" />
    <input class="ing-abv" type="number" min="0" max="100" step="0.1" placeholder="ABV %" />
    <button type="button" class="remove-btn" title="Entfernen">✕</button>
  `;
  row.querySelector(".remove-btn").addEventListener("click", () => row.remove());
  return row;
}

function addIngredientRow() {
  ingredientsEl.appendChild(makeIngredientRow());
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
  const totalAlcohol = ingredients.reduce((sum, i) => sum + (i.amount * i.abv) / 100, 0);
  const preAbv = (totalAlcohol / preVolume) * 100;

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

  const finalAbv = (totalAlcohol / finalVolume) * 100;
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

export function initDilution() {
  addIngredientRow();
  document.getElementById("dil-add-ingredient").addEventListener("click", addIngredientRow);
  document.getElementById("dil-percent-minus").addEventListener("click", () => stepPercent(-5));
  document.getElementById("dil-percent-plus").addEventListener("click", () => stepPercent(5));
  document
    .querySelectorAll('input[name="dil-mode"]')
    .forEach((el) => el.addEventListener("change", updateModeInputs));
  // Live rechnen: jede Eingabe im Panel löst eine Neuberechnung aus.
  panelEl.addEventListener("input", calculate);
  panelEl.addEventListener("change", calculate);
  // Eine entfernte Zutatenzeile ist kein input-Event – nach dem Klick neu rechnen.
  panelEl.addEventListener("click", (e) => {
    if (e.target.closest(".remove-btn")) calculate();
  });
  updateModeInputs();
}
