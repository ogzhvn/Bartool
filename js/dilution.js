import { formatNumber } from "./utils.js";

const ingredientsEl = document.getElementById("dil-ingredients");
const resultEl = document.getElementById("dil-result");

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

function updateModeInputs() {
  const mode = document.querySelector('input[name="dil-mode"]:checked').value;
  document.getElementById("dil-percent").disabled = mode !== "percent";
  document.getElementById("dil-ml").disabled = mode !== "ml";
}

function calculate() {
  const ingredients = getIngredients();
  if (ingredients.length === 0) {
    resultEl.hidden = false;
    resultEl.innerHTML = `<p class="empty-note">Bitte mindestens eine gültige Zutat (Menge + ABV) eingeben.</p>`;
    return;
  }

  const preVolume = ingredients.reduce((sum, i) => sum + i.amount, 0);
  const totalAlcohol = ingredients.reduce((sum, i) => sum + (i.amount * i.abv) / 100, 0);
  const preAbv = (totalAlcohol / preVolume) * 100;

  const mode = document.querySelector('input[name="dil-mode"]:checked').value;
  let dilutionMl;
  let finalVolume;
  if (mode === "percent") {
    const percent = parseFloat(document.getElementById("dil-percent").value) || 0;
    if (percent >= 100) {
      resultEl.hidden = false;
      resultEl.innerHTML = `<p class="empty-note">Verdünnung muss unter 100 % liegen.</p>`;
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
      Volumen vor Verdünnung: ${formatNumber(preVolume)} ml · ABV vor Verdünnung: ${formatNumber(preAbv)} %<br />
      Verdünnung: ${formatNumber(dilutionMl)} ml (${formatNumber(dilutionPercentOfFinal)} % des Endvolumens)<br />
      Endvolumen: ${formatNumber(finalVolume)} ml · <strong>ABV nach Verdünnung: ${formatNumber(finalAbv)} %</strong>
    </p>
  `;
}

export function initDilution() {
  addIngredientRow();
  document.getElementById("dil-add-ingredient").addEventListener("click", addIngredientRow);
  document.getElementById("dil-calculate").addEventListener("click", calculate);
  document
    .querySelectorAll('input[name="dil-mode"]')
    .forEach((el) => el.addEventListener("change", updateModeInputs));
}
