import { onRecipesChanged } from "./storage.js";
import { getAllRecipes, getRecipe } from "./recipeLibrary.js";
import { createIngredientEditor } from "./ingredientEditor.js";
import { UNIT_TO_ML, UNIT_LABELS } from "./units.js";
import { escapeHtml, formatNumber } from "./utils.js";
import { alcoholMl, abvAfterWater } from "./abv.js";
import { prefillPreparation } from "./preparations.js";
import { switchTab } from "./tabs.js";

const panelEl = document.getElementById("batching");
const ingredientsEl = document.getElementById("batch-ingredients");
const resultEl = document.getElementById("batch-result");
const totalEl = document.getElementById("batch-total");
const totalValueEl = document.getElementById("batch-total-value");
const totalSubEl = document.getElementById("batch-total-sub");
const totalLabelEl = document.getElementById("batch-total-label");
const recipeSelectEl = document.getElementById("batch-recipe-select");
const recipeInfoEl = document.getElementById("batch-recipe-info");

const editor = createIngredientEditor(ingredientsEl);

// Kennzahlen der letzten Berechnung – Grundlage für "Als Ansatz".
let letztesErgebnis = { volumeMl: null, abv: null };

function currentMode() {
  return document.querySelector('input[name="batch-mode"]:checked').value;
}

function updateModeInputs() {
  const mode = currentMode();
  panelEl.querySelectorAll("[data-mode-field]").forEach((el) => {
    el.hidden = el.dataset.modeField !== mode;
  });
  // Die Alkohol-Spalte in den Zutatenzeilen wird nur im Flaschen-Modus
  // gebraucht und würde sonst nur verwirren.
  ingredientsEl.classList.toggle("show-abv", mode === "bottles");
  updateDilutionLabel();
  calculateScale();
}

function currentDilutionMode() {
  return document.querySelector('input[name="batch-dilution-mode"]:checked')?.value ?? "percent";
}

function updateDilutionLabel() {
  const el = document.getElementById("batch-dilution-unit");
  if (el) el.textContent = currentDilutionMode() === "percent" ? "% Wasseranteil" : "% Ziel-ABV";
}

function showNote(message) {
  resultEl.hidden = false;
  resultEl.innerHTML = `<p class="empty-note">${message}</p>`;
  totalEl.hidden = true;
}

// Summe der Zutaten in ml. Stückzutaten (Stück, Teile) haben kein Volumen und
// zählen hier nicht mit.
function volumeMlOf(ingredients, factor = 1) {
  return ingredients.reduce((sum, ing) => {
    const toMl = UNIT_TO_ML[ing.unit];
    return toMl ? sum + ing.amount * factor * toMl : sum;
  }, 0);
}

// Vorgemischte Flaschen: Der Nutzer gibt vor, wieviele Flaschen welcher Größe
// am Ende dastehen sollen und wie stark verdünnt wird. Daraus ergibt sich
// rückwärts, wieviel Rezept und wieviel Wasser hineingehört.
function calculateBottles(ingredients, basePortions) {
  const bottleSize = parseFloat(document.getElementById("batch-bottle-size").value) || 0;
  const bottleCount = parseFloat(document.getElementById("batch-bottle-count").value) || 0;
  const value = parseFloat(document.getElementById("batch-dilution-value").value) || 0;
  const dilutionMode = currentDilutionMode();

  const finalVolume = bottleSize * bottleCount;
  if (finalVolume <= 0) {
    showNote("Bitte Flaschengröße und Anzahl eintragen.");
    return;
  }

  const baseVolumeMl = volumeMlOf(ingredients);
  if (baseVolumeMl === 0) {
    showNote(
      "Für den Flaschen-Modus wird mindestens eine Zutat mit einer Volumeneinheit (ml, cl, oz, BL, Dash) benötigt."
    );
    return;
  }

  const baseAlcoholMl = alcoholMl(
    ingredients.map((ing) => ({
      amountMl: (UNIT_TO_ML[ing.unit] ?? 0) * ing.amount,
      abv: ing.abv ?? 0,
    }))
  );

  // preVolume = das unverdünnte Rezept, das in die Flaschen soll.
  let preVolume;
  if (dilutionMode === "percent") {
    if (value >= 100) {
      showNote("Der Wasseranteil muss unter 100 % liegen.");
      return;
    }
    preVolume = finalVolume * (1 - value / 100);
  } else {
    if (value <= 0) {
      showNote("Bitte einen Ziel-Alkoholgehalt über 0 % eintragen.");
      return;
    }
    if (baseAlcoholMl === 0) {
      showNote("Ohne Alkoholgehalt bei den Zutaten lässt sich kein Ziel-ABV berechnen.");
      return;
    }
    // Nötiger reiner Alkohol für das Ziel, daraus die Menge Rezept.
    const neededAlcohol = (finalVolume * value) / 100;
    preVolume = (neededAlcohol / baseAlcoholMl) * baseVolumeMl;
    if (preVolume > finalVolume) {
      const maxAbv = (baseAlcoholMl / baseVolumeMl) * 100;
      showNote(
        `Ziel nicht erreichbar: unverdünnt hat das Rezept nur ${formatNumber(maxAbv)} % ABV. Wasser kann nur verdünnen.`
      );
      return;
    }
  }

  const factor = preVolume / baseVolumeMl;
  const waterMl = finalVolume - preVolume;
  const finalAbv = abvAfterWater(baseAlcoholMl * factor, preVolume, waterMl);
  const ohneAbv = ingredients.filter((ing) => ing.abv === null).map((ing) => ing.name);

  const scaled = ingredients.map((ing) => ({ ...ing, scaledAmount: ing.amount * factor }));

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
        <tr><td><strong>Wasser</strong></td><td><strong>${formatNumber(waterMl)} ml</strong></td></tr>
      </tbody>
    </table>
    <p class="summary">
      Rezept unverdünnt: ${formatNumber(preVolume)} ml · Wasser: ${formatNumber(waterMl)} ml
      (${formatNumber((waterMl / finalVolume) * 100)} % vom Endvolumen)<br />
      Ergibt ${formatNumber(bottleCount)} Flaschen à ${formatNumber(bottleSize)} ml
      · entspricht ${formatNumber(basePortions * factor)} Portionen
    </p>
    ${
      ohneAbv.length > 0
        ? `<p class="empty-note">Ohne Alkoholgehalt gerechnet (als 0 % angenommen): ${escapeHtml(ohneAbv.join(", "))}. Wert in der Zutatenzeile ergänzen, sonst stimmt der ABV nicht.</p>`
        : ""
    }
  `;

  letztesErgebnis = { volumeMl: finalVolume, abv: finalAbv };
  totalEl.hidden = false;
  totalLabelEl.textContent = "Alkoholgehalt";
  totalValueEl.textContent = `${formatNumber(finalAbv)} % ABV`;
  totalSubEl.textContent = `${formatNumber(finalVolume)} ml gesamt · ${formatNumber(bottleCount)} × ${formatNumber(bottleSize)} ml`;
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

  if (mode === "bottles") {
    calculateBottles(ingredients, basePortions);
    return;
  }

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

  totalLabelEl.textContent = "Gesamtvolumen";
  letztesErgebnis = { volumeMl: totalVolumeMl > 0 ? totalVolumeMl : null, abv: null };
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

// Übernimmt das Ergebnis in die Mise-en-Place-Erfassung. Die Art wird nur
// vorgeschlagen; ob es wirklich ein alkoholischer Batch ist, entscheidet der
// Mensch im Formular.
function handleToPreparation() {
  const name = document.getElementById("batch-name").value.trim();
  if (!name && editor.getIngredients().length === 0) {
    alert("Erst ein Rezept eingeben oder laden.");
    return;
  }
  const abv = letztesErgebnis.abv;
  const vorschlag = abv === null ? "sonstiges" : abv >= 15 ? "batch" : "batch_juice";
  switchTab("preparations");
  prefillPreparation({
    label: name || "Batch",
    prepType: vorschlag,
    batchSizeMl: letztesErgebnis.volumeMl ?? "",
    abv: abv === null ? "" : Number(abv.toFixed(1)),
    recipeName: name,
  });
}

function stepPortions(delta) {
  const input = document.getElementById("batch-target-portions");
  const next = Math.max(1, Math.round((parseFloat(input.value) || 0) + delta));
  input.value = next;
  calculateScale();
}

async function shareResult() {
  // Geteilt wird, was auch auf dem Bildschirm steht: im Ergebnisblock stehen
  // bereits die hochgerechneten Mengen (inklusive Wasser im Flaschen-Modus).
  const rows = [...resultEl.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()).join(": ")
  );
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
  calculateScale();
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
  document.getElementById("batch-to-prep").addEventListener("click", handleToPreparation);
  document.querySelectorAll('input[name="batch-mode"]').forEach((el) => el.addEventListener("change", updateModeInputs));
  document.querySelectorAll('input[name="batch-dilution-mode"]').forEach((el) =>
    el.addEventListener("change", () => {
      updateDilutionLabel();
      calculateScale();
    })
  );
  // Live rechnen: jede Eingabe im Panel löst eine Neuberechnung aus.
  const recalcFromEvent = (e) => {
    if (e.target.id === "batch-recipe-select") return;
    calculateScale();
  };
  panelEl.addEventListener("input", recalcFromEvent);
  panelEl.addEventListener("change", recalcFromEvent);
  // Eine entfernte Zutatenzeile ist kein input-Event – nach dem Klick neu rechnen.
  panelEl.addEventListener("click", (e) => {
    if (e.target.closest(".remove-btn")) calculateScale();
  });
  updateModeInputs();
}
