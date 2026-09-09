import { onRecipesChanged } from "./storage.js";
import { getAllRecipes, getRecipe } from "./recipeLibrary.js";
import { createIngredientEditor } from "./ingredientEditor.js";
import { UNIT_TO_ML, UNIT_LABELS } from "./units.js";
import { escapeHtml, formatNumber } from "./utils.js";
import { alcoholMl, abvAfterWater } from "./abv.js";
import { prefillPreparation } from "./preparations.js";
import { switchTab } from "./tabs.js";
import { applyTranslations, onLanguageChanged, t } from "./i18n.js";

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
  if (el) el.textContent = currentDilutionMode() === "percent" ? t("ui.wasseranteil") : t("ui.ziel_abv_6160");
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
    showNote(t("ui.bitte_flaschengroesse_und_anzahl_eintragen"));
    return;
  }

  const baseVolumeMl = volumeMlOf(ingredients);
  if (baseVolumeMl === 0) {
    showNote(
      t("ui.fuer_den_flaschen_modus_wird_mindestens_7f3d")
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
      showNote(t("ui.der_wasseranteil_muss_unter_100_liegen"));
      return;
    }
    preVolume = finalVolume * (1 - value / 100);
  } else {
    if (value <= 0) {
      showNote(t("ui.bitte_einen_ziel_alkoholgehalt_ueber_0_2467"));
      return;
    }
    if (baseAlcoholMl === 0) {
      showNote(t("ui.ohne_alkoholgehalt_bei_den_zutaten_laesst_341e"));
      return;
    }
    // Nötiger reiner Alkohol für das Ziel, daraus die Menge Rezept.
    const neededAlcohol = (finalVolume * value) / 100;
    preVolume = (neededAlcohol / baseAlcoholMl) * baseVolumeMl;
    if (preVolume > finalVolume) {
      const maxAbv = (baseAlcoholMl / baseVolumeMl) * 100;
      showNote(
        `${t("ui.ziel_nicht_erreichbar_unverduennt_hat_das_61af")} ${formatNumber(maxAbv)} ${t("ui.abv_wasser_kann_nur_verduennen")}`
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
      <thead><tr><th>${t("ui.zutat")}</th><th>${t("ui.menge")}</th></tr></thead>
      <tbody>
        ${scaled
          .map(
            (ing) =>
              `<tr><td>${escapeHtml(ing.name)}</td><td>${formatNumber(ing.scaledAmount)} ${UNIT_LABELS[ing.unit]}</td></tr>`
          )
          .join("")}
        <tr><td><strong>${t("ui.wasser")}</strong></td><td><strong>${formatNumber(waterMl)} ml</strong></td></tr>
      </tbody>
    </table>
    <p class="summary">
      ${t("ui.rezept_unverduennt")} ${formatNumber(preVolume)} ${t("ui.ml_wasser_6ca8")} ${formatNumber(waterMl)} ml
      (${formatNumber((waterMl / finalVolume) * 100)} ${t("ui.vom_endvolumen")}<br />
      ${t("ui.ergibt")} ${formatNumber(bottleCount)} ${t("ui.flaschen_a")} ${formatNumber(bottleSize)} ${t("ui.ml_entspricht")} ${formatNumber(basePortions * factor)} ${t("ui.portionen")}
    </p>
    ${
      ohneAbv.length > 0
        ? `<p class="empty-note">${t("ui.ohne_alkoholgehalt_gerechnet_als_0_bb19")} ${escapeHtml(ohneAbv.join(", "))}${t("ui.wert_in_der_zutatenzeile_ergaenzen_3c11")}</p>`
        : ""
    }
  `;

  letztesErgebnis = { volumeMl: finalVolume, abv: finalAbv };
  totalEl.hidden = false;
  totalLabelEl.textContent = t("ui.alkoholgehalt_006a");
  totalValueEl.textContent = `${formatNumber(finalAbv)} % ABV`;
  totalSubEl.textContent = `${formatNumber(finalVolume)} ${t("ui.ml_gesamt")} ${formatNumber(bottleCount)} × ${formatNumber(bottleSize)} ml`;
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
        t("ui.fuer_die_skalierung_nach_volumen_wird_6dfe")
      );
      return;
    }
    // Eine Portionszahl wie "14.35" ist nicht umsetzbar: auf die
    // nächstkleinere ganze Portion abrunden und die Zutatenmengen dafür
    // berechnen, statt exakt auf das eingegebene Ziel-Volumen zu skalieren.
    const rawPortions = basePortions * (targetVolume / baseVolumeMl);
    const flooredPortions = Math.floor(rawPortions);
    if (flooredPortions < 1) {
      showNote(t("ui.das_ziel_volumen_reicht_nicht_fuer_eine_6d3b"));
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
      <thead><tr><th>${t("ui.zutat")}</th><th>${t("ui.menge")}</th></tr></thead>
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

  totalLabelEl.textContent = t("ui.gesamtvolumen");
  letztesErgebnis = { volumeMl: totalVolumeMl > 0 ? totalVolumeMl : null, abv: null };
  if (totalVolumeMl > 0) {
    totalEl.hidden = false;
    totalValueEl.textContent = `${formatNumber(totalVolumeMl)} ml`;
    totalSubEl.textContent = `${formatNumber(totalVolumeMl / 1000)} l · ${formatNumber(resultingPortions)} ${t("ui.portionen")}`;
  } else {
    totalEl.hidden = false;
    totalValueEl.textContent = `${formatNumber(resultingPortions)} ${t("ui.portionen")}`;
    totalSubEl.textContent = t("ui.kein_volumen_berechenbar_nur_stueckzutaten");
  }
}

// Übernimmt das Ergebnis in die Mise-en-Place-Erfassung. Die Art wird nur
// vorgeschlagen; ob es wirklich ein alkoholischer Batch ist, entscheidet der
// Mensch im Formular.
function handleToPreparation() {
  const name = document.getElementById("batch-name").value.trim();
  if (!name && editor.getIngredients().length === 0) {
    alert(t("ui.erst_ein_rezept_eingeben_oder_laden"));
    return;
  }
  const abv = letztesErgebnis.abv;
  const vorschlag = abv === null ? "sonstiges" : abv >= 15 ? "batch" : "batch_juice";
  switchTab("preparations");
  prefillPreparation({
    label: name || t("ui.batch"),
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
  const name = document.getElementById("batch-name").value || t("ui.batch");
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
  document.getElementById("batch-name").value = recipe.name;
  document.getElementById("batch-base-portions").value = recipe.basePortions;
  editor.setIngredients(recipe.ingredients);
  renderRecipeInfo(recipe);
  calculateScale();
}

function renderRecipeInfo(recipe) {
  const rows = [
    [t("ui.glas"), recipe.glass],
    [t("ui.garnitur"), recipe.garnish],
    ["Eis", recipe.ice],
    [t("ui.zubereitung"), recipe.method],
    [t("ui.geschichte"), recipe.history],
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
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    populateRecipeSelect();
    updateModeInputs();
    applyTranslations(panelEl);
  });

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
