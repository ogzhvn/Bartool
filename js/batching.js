import { onRecipesChanged } from "./storage.js";
import { getAllRecipes, getRecipe } from "./recipeLibrary.js";
import { getAllProducts } from "./productLibrary.js";
import { createIngredientEditor } from "./ingredientEditor.js";
import { UNIT_TO_ML, UNIT_LABELS } from "./units.js";
import { escapeHtml, formatNumber } from "./utils.js";
import { alcoholMl, abvAfterWater, waterForTargetAbv, parseAbv } from "./abv.js";

const panelEl = document.getElementById("batching");
const ingredientsEl = document.getElementById("batch-ingredients");
const resultEl = document.getElementById("batch-result");
const totalEl = document.getElementById("batch-total");
const totalLabelEl = totalEl.querySelector(".result-bar-label");
const totalValueEl = document.getElementById("batch-total-value");
const totalSubEl = document.getElementById("batch-total-sub");
const recipeSelectEl = document.getElementById("batch-recipe-select");
const recipeInfoEl = document.getElementById("batch-recipe-info");
const bottleSizeEl = document.getElementById("batch-bottle-size");
const bottleCountEl = document.getElementById("batch-bottle-count");
const bottleDilutionEl = document.getElementById("batch-bottle-dilution");
const bottleTargetAbvEl = document.getElementById("batch-bottle-target-abv");
const bottleAbvListEl = document.getElementById("batch-bottle-abv");

const editor = createIngredientEditor(ingredientsEl);
const DEFAULT_TOTAL_LABEL = totalLabelEl.textContent;

// Manuell überschriebene ABV-Werte je Zutatenname im Bottles-Modus, damit sie
// über Neuberechnungen hinweg erhalten bleiben, bis Formular oder Rezept
// gewechselt wird.
let bottleAbvOverrides = {};
let lastBottleAbvNames = null;

function currentMode() {
  return document.querySelector('input[name="batch-mode"]:checked').value;
}

function currentBottleTarget() {
  return document.querySelector('input[name="batch-bottle-target"]:checked').value;
}

function updateModeInputs() {
  const mode = currentMode();
  panelEl.querySelectorAll("[data-mode-field]").forEach((el) => {
    el.hidden = el.dataset.modeField !== mode;
  });
  totalLabelEl.textContent = mode === "bottles" ? "Gesamtvolumen final" : DEFAULT_TOTAL_LABEL;
  if (mode === "bottles") updateBottleTargetInputs();
  recalc();
}

function updateBottleTargetInputs() {
  const target = currentBottleTarget();
  panelEl.querySelectorAll("[data-bottle-target-field]").forEach((el) => {
    el.hidden = el.dataset.bottleTargetField !== target;
  });
}

function recalc() {
  if (currentMode() === "bottles") calculateBottles();
  else calculateScale();
}

function showNote(message) {
  resultEl.hidden = false;
  resultEl.innerHTML = `<p class="empty-note">${message}</p>`;
  totalEl.hidden = true;
}

// Sucht per striktem Teilstring-Vergleich (Hausmarke, keine generischen
// Namen) das erste Produkt, dessen Name in der Zutatenbezeichnung vorkommt,
// und liest daraus den ABV. Kein Treffer → null (nie stillschweigend 0).
function autoAbvFor(ingredientName) {
  const lower = ingredientName.toLowerCase();
  const product = getAllProducts().find((p) => lower.includes(p.name.toLowerCase()));
  return product ? parseAbv(product.abv) : null;
}

function currentBottleAbv(name) {
  const override = bottleAbvOverrides[name];
  if (override !== undefined && override !== "") {
    const parsed = parseFloat(override);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return autoAbvFor(name);
}

// Rendert die überschreibbare ABV-Zeile je Zutat. Wird nur bei geänderter
// Zutatenliste neu aufgebaut, damit Tippen in einem ABV-Feld nicht durch
// eine Neuberechnung unterbrochen wird (panelEl "input" löst calculateBottles
// aus, das denselben Zutatennamen-Satz wieder vorfindet und daher nicht neu
// rendert).
function renderBottleAbvList(ingredients) {
  const names = ingredients.map((i) => i.name);
  if (lastBottleAbvNames && names.length === lastBottleAbvNames.length && names.every((n, i) => n === lastBottleAbvNames[i])) {
    return;
  }
  lastBottleAbvNames = names;
  bottleAbvListEl.innerHTML = names
    .map((name) => {
      const auto = autoAbvFor(name);
      const value = bottleAbvOverrides[name] ?? (auto !== null ? auto : "");
      return `
        <div class="bottle-abv-row">
          <span class="bottle-abv-name">${escapeHtml(name)}</span>
          <input type="number" class="bottle-abv-input" min="0" max="100" step="0.1" placeholder="ABV %" data-name="${escapeHtml(name)}" value="${escapeHtml(value)}" />
          ${auto === null ? `<span class="bottle-abv-unknown">ABV unbekannt</span>` : `<span></span>`}
        </div>
      `;
    })
    .join("");
  bottleAbvListEl.querySelectorAll(".bottle-abv-input").forEach((input) => {
    input.addEventListener("input", () => {
      bottleAbvOverrides[input.dataset.name] = input.value;
    });
  });
}

function calculateScale() {
  const ingredients = editor.getIngredients();
  if (ingredients.length === 0) {
    resultEl.hidden = true;
    totalEl.hidden = true;
    return;
  }

  const basePortions = parseFloat(document.getElementById("batch-base-portions").value) || 1;
  const mode = currentMode();

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
      showNote(
        "Für die Skalierung nach Volumen wird mindestens eine Zutat mit einer Volumeneinheit (ml, cl, oz, BL, Dash) benötigt."
      );
      return;
    }
    // Eine Portionszahl wie "14.35" ist nicht umsetzbar: auf die
    // nächstkleinere ganze Portion abrunden und die Zutatenmengen dafür
    // berechnen, statt exakt auf das eingegebene Ziel-Volumen zu skalieren.
    const rawPortions = basePortions * (targetVolume / baseVolumeMl);
    const flooredPortions = Math.floor(rawPortions);
    if (flooredPortions < 1) {
      showNote("Das Ziel-Volumen reicht nicht für eine ganze Portion.");
      return;
    }
    factor = flooredPortions / basePortions;
  }

  if (!(factor > 0)) {
    resultEl.hidden = true;
    totalEl.hidden = true;
    return;
  }

  const scaled = ingredients.map((ing) => ({ ...ing, scaledAmount: ing.amount * factor }));
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
              `<tr><td>${escapeHtml(ing.name)}</td><td>${formatNumber(ing.scaledAmount)} ${UNIT_LABELS[ing.unit]}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  if (totalVolumeMl > 0) {
    totalEl.hidden = false;
    totalValueEl.textContent = `${formatNumber(totalVolumeMl)} ml`;
    totalSubEl.textContent = `${formatNumber(totalVolumeMl / 1000)} l · ${formatNumber(resultingPortions)} Portionen`;
  } else {
    totalEl.hidden = false;
    totalValueEl.textContent = `${formatNumber(resultingPortions)} Portionen`;
    totalSubEl.textContent = "Kein Volumen berechenbar – nur Stückzutaten";
  }
}

// Bottled-Cocktail-Modus: Zutaten werden (wie im Volumen-Modus, auf ganze
// Portionen abgerundet) auf die Zielmenge Flaschengröße × Anzahl Flaschen
// skaliert – das ist das unverdünnte Konzentrat. Die Verdünnung (fester
// Prozentsatz oder Ziel-ABV) kommt danach als Zuschlag oben drauf, das
// Endvolumen kann also größer sein als Flaschengröße × Anzahl Flaschen.
function calculateBottles() {
  const ingredients = editor.getIngredients();
  if (ingredients.length === 0) {
    resultEl.hidden = true;
    totalEl.hidden = true;
    bottleAbvListEl.innerHTML = "";
    lastBottleAbvNames = null;
    return;
  }

  renderBottleAbvList(ingredients);

  const basePortions = parseFloat(document.getElementById("batch-base-portions").value) || 1;
  const baseVolumeMl = ingredients.reduce((sum, ing) => {
    const toMl = UNIT_TO_ML[ing.unit];
    return toMl ? sum + ing.amount * toMl : sum;
  }, 0);
  if (baseVolumeMl === 0) {
    showNote(
      "Für den Bottles-Modus wird mindestens eine Zutat mit einer Volumeneinheit (ml, cl, oz, BL, Dash) benötigt."
    );
    return;
  }

  const bottleSize = parseFloat(bottleSizeEl.value) || 0;
  const bottleCount = parseFloat(bottleCountEl.value) || 0;
  if (!(bottleSize > 0) || !(bottleCount > 0)) {
    showNote("Flaschengröße und Anzahl Flaschen müssen größer als 0 sein.");
    return;
  }

  const targetConcentrateVolume = bottleSize * bottleCount;
  const rawPortions = basePortions * (targetConcentrateVolume / baseVolumeMl);
  const flooredPortions = Math.floor(rawPortions);
  if (flooredPortions < 1) {
    showNote("Die Zielmenge reicht nicht für eine ganze Portion.");
    return;
  }
  const factor = flooredPortions / basePortions;

  const scaled = ingredients.map((ing) => ({ ...ing, scaledAmount: ing.amount * factor, abv: currentBottleAbv(ing.name) }));
  const preVolumeMl = scaled.reduce((sum, ing) => {
    const toMl = UNIT_TO_ML[ing.unit];
    return toMl ? sum + ing.scaledAmount * toMl : sum;
  }, 0);
  const unmatchedNames = scaled.filter((ing) => UNIT_TO_ML[ing.unit] && ing.abv === null).map((ing) => ing.name);
  const totalAlcoholMl = alcoholMl(
    scaled.map((ing) => {
      const toMl = UNIT_TO_ML[ing.unit];
      return { amountMl: toMl ? ing.scaledAmount * toMl : 0, abv: ing.abv ?? 0 };
    })
  );

  const target = currentBottleTarget();
  let waterMl;
  let hint = "";
  if (target === "dilution") {
    const percent = parseFloat(bottleDilutionEl.value) || 0;
    if (percent >= 100) {
      showNote("Verdünnung muss unter 100 % liegen.");
      return;
    }
    const finalVolumeAtPercent = preVolumeMl / (1 - percent / 100);
    waterMl = finalVolumeAtPercent - preVolumeMl;
  } else {
    const targetAbv = parseFloat(bottleTargetAbvEl.value) || 0;
    if (!(targetAbv > 0)) {
      showNote("Ziel-ABV muss größer als 0 sein.");
      return;
    }
    waterMl = waterForTargetAbv(totalAlcoholMl, preVolumeMl, targetAbv);
    if (waterMl === 0) {
      hint = "Ziel-ABV liegt über dem unverdünnten ABV – keine Verdünnung nötig oder möglich.";
    }
  }

  const finalVolumeMl = preVolumeMl + waterMl;
  const finalAbv = abvAfterWater(totalAlcoholMl, preVolumeMl, waterMl);
  const fullBottles = Math.floor(finalVolumeMl / bottleSize);
  const restMl = finalVolumeMl - fullBottles * bottleSize;

  resultEl.hidden = false;
  resultEl.innerHTML = `
    <table>
      <thead><tr><th>Zutat</th><th>Menge</th><th>ABV</th></tr></thead>
      <tbody>
        ${scaled
          .map(
            (ing) =>
              `<tr><td>${escapeHtml(ing.name)}</td><td>${formatNumber(ing.scaledAmount)} ${UNIT_LABELS[ing.unit]}</td><td>${ing.abv === null ? "unbekannt" : formatNumber(ing.abv) + " %"}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>
    <p class="summary">
      Gesamtvolumen unverdünnt: ${formatNumber(preVolumeMl)} ml<br />
      Wasserzugabe: ${formatNumber(waterMl)} ml<br />
      Gesamtvolumen final: ${formatNumber(finalVolumeMl)} ml<br />
      End-ABV: ${formatNumber(finalAbv)} %<br />
      Füllmenge je Flasche: ${formatNumber(bottleSize)} ml<br />
      Anzahl voller Flaschen: ${fullBottles}<br />
      Rest: ${formatNumber(restMl)} ml
    </p>
    ${hint ? `<p class="empty-note">${escapeHtml(hint)}</p>` : ""}
    ${unmatchedNames.length > 0 ? `<p class="empty-note">ABV unbekannt: ${escapeHtml(unmatchedNames.join(", "))}</p>` : ""}
  `;

  totalEl.hidden = false;
  totalValueEl.textContent = `${formatNumber(finalVolumeMl)} ml`;
  totalSubEl.textContent = `End-ABV ${formatNumber(finalAbv)} % · ${fullBottles} Flaschen à ${formatNumber(bottleSize)} ml · Rest ${formatNumber(restMl)} ml`;
}

function stepPortions(delta) {
  const input = document.getElementById("batch-target-portions");
  const next = Math.max(1, Math.round((parseFloat(input.value) || 0) + delta));
  input.value = next;
  recalc();
}

async function shareResult() {
  const rows = editor
    .getIngredients()
    .map((ing) => `${ing.name}: ${formatNumber(ing.amount)} ${UNIT_LABELS[ing.unit]}`);
  const name = document.getElementById("batch-name").value || "Batch";
  const text = [`${name} – ${totalValueEl.textContent} (${totalSubEl.textContent})`, ...rows].join("\n");
  if (navigator.share) {
    try {
      await navigator.share({ title: name, text });
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
  }
  if (navigator.clipboard) await navigator.clipboard.writeText(text);
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
  document.getElementById("batch-name").value = recipe.name;
  document.getElementById("batch-base-portions").value = recipe.basePortions;
  editor.setIngredients(recipe.ingredients);
  renderRecipeInfo(recipe);
  bottleAbvOverrides = {};
  lastBottleAbvNames = null;
  recalc();
}

function renderRecipeInfo(recipe) {
  const rows = [
    ["Glas", recipe.glass],
    ["Garnitur", recipe.garnish],
    ["Eis", recipe.ice],
    ["Zubereitung", recipe.method],
    ["Geschichte", recipe.history],
  ].filter(([, value]) => value);

  if (rows.length === 0) {
    recipeInfoEl.hidden = true;
    return;
  }
  recipeInfoEl.hidden = false;
  recipeInfoEl.innerHTML = rows
    .map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`)
    .join("");
}

function handleClear() {
  document.getElementById("batch-name").value = "";
  document.getElementById("batch-base-portions").value = 1;
  recipeSelectEl.value = "";
  editor.setIngredients([]);
  resultEl.hidden = true;
  totalEl.hidden = true;
  recipeInfoEl.hidden = true;
  bottleAbvOverrides = {};
  lastBottleAbvNames = null;
  bottleAbvListEl.innerHTML = "";
}

export function initBatching() {
  editor.setIngredients([]);
  populateRecipeSelect();
  onRecipesChanged(populateRecipeSelect);
  document.getElementById("batch-add-ingredient").addEventListener("click", () => editor.addRow());
  document.getElementById("batch-load-recipe").addEventListener("click", handleLoadRecipe);
  document.getElementById("batch-clear").addEventListener("click", handleClear);
  document.getElementById("batch-portions-minus").addEventListener("click", () => stepPortions(-1));
  document.getElementById("batch-portions-plus").addEventListener("click", () => stepPortions(1));
  document.getElementById("batch-share").addEventListener("click", shareResult);
  document.querySelectorAll('input[name="batch-mode"]').forEach((el) => el.addEventListener("change", updateModeInputs));
  document
    .querySelectorAll('input[name="batch-bottle-target"]')
    .forEach((el) => el.addEventListener("change", updateBottleTargetInputs));
  // Live rechnen: jede Eingabe im Panel löst eine Neuberechnung aus.
  const recalcFromEvent = (e) => {
    if (e.target.id === "batch-recipe-select") return;
    recalc();
  };
  panelEl.addEventListener("input", recalcFromEvent);
  panelEl.addEventListener("change", recalcFromEvent);
  // Eine entfernte Zutatenzeile ist kein input-Event – nach dem Klick neu rechnen.
  panelEl.addEventListener("click", (e) => {
    if (e.target.closest(".remove-btn")) recalc();
  });
  updateModeInputs();
}
