// Faktoren beziehen sich auf das Gewicht der (übrig gebliebenen) Zitrusschalen.
const RATIOS = {
  lime: { citric: 0.6667, malic: 0.333, water: 16.66 },
  lemon: { citric: 1.0, malic: 0, water: 16.66 },
};

function calcFor(type) {
  const peelWeight = parseFloat(document.getElementById(`sj-${type}-peel`).value) || 0;
  const ratio = RATIOS[type];
  document.getElementById(`sj-${type}-citric`).textContent = `${(peelWeight * ratio.citric).toFixed(2)} g`;
  document.getElementById(`sj-${type}-malic`).textContent = `${(peelWeight * ratio.malic).toFixed(2)} g`;
  document.getElementById(`sj-${type}-water`).textContent = `${Math.round(peelWeight * ratio.water)} g`;
}

export function initSuperjuice() {
  Object.keys(RATIOS).forEach((type) => {
    document.getElementById(`sj-${type}-peel`).addEventListener("input", () => calcFor(type));
    calcFor(type);
  });
}
