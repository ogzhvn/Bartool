const PRESETS = {
  lime: { citric: 1.0, malic: 0.5, ascorbic: 0, sugar: 0 },
  lemon: { citric: 0.6, malic: 0.4, ascorbic: 0.2, sugar: 0 },
  custom: null,
};

const presetEl = document.getElementById("sj-preset");
const citricEl = document.getElementById("sj-citric");
const malicEl = document.getElementById("sj-malic");
const ascorbicEl = document.getElementById("sj-ascorbic");
const sugarEl = document.getElementById("sj-sugar");
const resultEl = document.getElementById("sj-result");

function applyPreset() {
  const preset = PRESETS[presetEl.value];
  if (!preset) return;
  citricEl.value = preset.citric;
  malicEl.value = preset.malic;
  ascorbicEl.value = preset.ascorbic;
  sugarEl.value = preset.sugar;
}

function formatNumber(n) {
  return Number(n.toFixed(2)).toString();
}

function calculate() {
  const juiceAmount = parseFloat(document.getElementById("sj-juice-amount").value) || 0;
  const citricPct = parseFloat(citricEl.value) || 0;
  const malicPct = parseFloat(malicEl.value) || 0;
  const ascorbicPct = parseFloat(ascorbicEl.value) || 0;
  const sugarPct = parseFloat(sugarEl.value) || 0;

  if (juiceAmount <= 0) {
    resultEl.hidden = false;
    resultEl.innerHTML = `<p class="empty-note">Bitte eine gültige Saftmenge eingeben.</p>`;
    return;
  }

  const citricG = juiceAmount * (citricPct / 100);
  const malicG = juiceAmount * (malicPct / 100);
  const ascorbicG = juiceAmount * (ascorbicPct / 100);
  const sugarG = juiceAmount * (sugarPct / 100);
  const totalAdditives = citricG + malicG + ascorbicG + sugarG;

  const rows = [
    ["Frischer Saft", `${formatNumber(juiceAmount)} ml`],
    ["Zitronensäure", `${formatNumber(citricG)} g`],
  ];
  if (malicPct > 0) rows.push(["Apfelsäure", `${formatNumber(malicG)} g`]);
  if (ascorbicPct > 0) rows.push(["Ascorbinsäure", `${formatNumber(ascorbicG)} g`]);
  if (sugarPct > 0) rows.push(["Zucker", `${formatNumber(sugarG)} g`]);

  resultEl.hidden = false;
  resultEl.innerHTML = `
    <table>
      <thead><tr><th>Zutat</th><th>Menge</th></tr></thead>
      <tbody>
        ${rows.map(([name, amount]) => `<tr><td>${name}</td><td>${amount}</td></tr>`).join("")}
      </tbody>
    </table>
    <p class="summary">Gesamtmenge ca. ${formatNumber(juiceAmount + totalAdditives)} ml/g Superjuice</p>
  `;
}

export function initSuperjuice() {
  presetEl.addEventListener("change", applyPreset);
  document.getElementById("sj-calculate").addEventListener("click", calculate);
  applyPreset();
}
