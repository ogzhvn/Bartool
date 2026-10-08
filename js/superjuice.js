import { formatDecimal, onLanguageChanged } from "./i18n.js";
// Faktoren beziehen sich auf das Gewicht der (übrig gebliebenen) Zitrusschalen.
const RATIOS = {
  lime: { citric: 0.6667, malic: 0.333, water: 16.66 },
  lemon: { citric: 1.0, malic: 0, water: 16.66 },
};

function calcFor(type) {
  const peelWeight = parseFloat(document.getElementById(`sj-${type}-peel`).value) || 0;
  const ratio = RATIOS[type];
  document.getElementById(`sj-${type}-citric`).textContent = `${formatDecimal(peelWeight * ratio.citric)} g`;
  document.getElementById(`sj-${type}-malic`).textContent = `${formatDecimal(peelWeight * ratio.malic)} g`;
  document.getElementById(`sj-${type}-water`).textContent = `${formatDecimal(Math.round(peelWeight * ratio.water), 0)} g`;
}

export function initSuperjuice() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => Object.keys(RATIOS).forEach(calcFor));

  Object.keys(RATIOS).forEach((type) => {
    document.getElementById(`sj-${type}-peel`).addEventListener("input", () => calcFor(type));
    calcFor(type);
  });
}
