const PRESETS = {
  "1:1": { sugar: 1, water: 1 },
  "2:1": { sugar: 2, water: 1 },
  "3:2": { sugar: 3, water: 2 },
  "1:2": { sugar: 1, water: 2 },
};

const presetEl = document.getElementById("syrup-preset");
const sugarPartsEl = document.getElementById("syrup-sugar-parts");
const waterPartsEl = document.getElementById("syrup-water-parts");
const waterAmountEl = document.getElementById("syrup-water-amount");
const sugarAmountEl = document.getElementById("syrup-sugar-amount");
const yieldAmountEl = document.getElementById("syrup-yield-amount");

function applyPreset() {
  const preset = PRESETS[presetEl.value];
  const isCustom = !preset;
  sugarPartsEl.disabled = !isCustom;
  waterPartsEl.disabled = !isCustom;
  if (preset) {
    sugarPartsEl.value = preset.sugar;
    waterPartsEl.value = preset.water;
  }
  calculate();
}

function calculate() {
  const sugarParts = parseFloat(sugarPartsEl.value) || 0;
  const waterParts = parseFloat(waterPartsEl.value) || 0;
  const waterAmount = parseFloat(waterAmountEl.value) || 0;

  if (waterParts <= 0) {
    sugarAmountEl.textContent = "0 g";
    yieldAmountEl.textContent = "0 g";
    return;
  }

  const sugarAmount = waterAmount * (sugarParts / waterParts);
  const totalWeight = waterAmount + sugarAmount;

  sugarAmountEl.textContent = `${Math.round(sugarAmount)} g`;
  yieldAmountEl.textContent = `${Math.round(totalWeight)} g`;
}

export function initSyrup() {
  presetEl.addEventListener("change", applyPreset);
  [sugarPartsEl, waterPartsEl, waterAmountEl].forEach((el) => el.addEventListener("input", calculate));
  applyPreset();
}
