import { saveRecipe, deleteRecipe, onRecipesChanged } from "./storage.js";
import { createIngredientEditor } from "./ingredientEditor.js";
import { escapeHtml, formatNumber } from "./utils.js";
import { getAllRecipes, isCustomRecipe } from "./recipeLibrary.js";
import { UNIT_LABELS } from "./units.js";
import { exportRecipesToExcel, exportRecipesToWord } from "./recipeExport.js";

const listViewEl = document.getElementById("recipes-list-view");
const editViewEl = document.getElementById("recipes-edit-view");
const nameEl = document.getElementById("recipe-name");
const basePortionsEl = document.getElementById("recipe-base-portions");
const methodEl = document.getElementById("recipe-method");
const glassEl = document.getElementById("recipe-glass");
const garnishEl = document.getElementById("recipe-garnish");
const iceEl = document.getElementById("recipe-ice");
const historyEl = document.getElementById("recipe-history");
const quickPitchEl = document.getElementById("recipe-quick-pitch");
const pairsWithEl = document.getElementById("recipe-pairs-with");
const listEl = document.getElementById("recipe-list");
const ingredientsEl = document.getElementById("recipe-ingredients");
const searchEl = document.getElementById("recipe-search");
const sidebarListEl = document.getElementById("recipe-sidebar-list");
const sidebarSearchEl = document.getElementById("recipe-sidebar-search");
const selectedCountEl = document.getElementById("recipe-selected-count");
const selectAllBtn = document.getElementById("recipe-select-all");
const selectNoneBtn = document.getElementById("recipe-select-none");
const exportExcelBtn = document.getElementById("recipe-export-excel");
const exportWordBtn = document.getElementById("recipe-export-word");

const editor = createIngredientEditor(ingredientsEl);

let editingOriginalName = null;
const selectedNames = new Set();

function showListView() {
  listViewEl.classList.add("active");
  editViewEl.classList.remove("active");
}

function showEditView() {
  editViewEl.classList.add("active");
  listViewEl.classList.remove("active");
}

function parsePairsWith(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resetForm() {
  nameEl.value = "";
  basePortionsEl.value = 1;
  methodEl.value = "";
  glassEl.value = "";
  garnishEl.value = "";
  iceEl.value = "";
  historyEl.value = "";
  quickPitchEl.value = "";
  pairsWithEl.value = "";
  editor.setIngredients([]);
  editingOriginalName = null;
  renderSidebarList();
}

function loadIntoForm(recipe) {
  nameEl.value = recipe.name;
  basePortionsEl.value = recipe.basePortions;
  methodEl.value = recipe.method ?? "";
  glassEl.value = recipe.glass ?? "";
  garnishEl.value = recipe.garnish ?? "";
  iceEl.value = recipe.ice ?? "";
  historyEl.value = recipe.history ?? "";
  quickPitchEl.value = recipe.quickPitch ?? "";
  pairsWithEl.value = (recipe.pairsWith ?? []).join(", ");
  editor.setIngredients(recipe.ingredients);
  editingOriginalName = recipe.name;
  renderSidebarList();
}

function handleSave() {
  const name = nameEl.value.trim();
  if (!name) {
    alert("Bitte einen Rezeptnamen eingeben.");
    return;
  }
  const ingredients = editor.getIngredients();
  if (ingredients.length === 0) {
    alert("Bitte mindestens eine gültige Zutat eingeben.");
    return;
  }
  const basePortions = parseFloat(basePortionsEl.value) || 1;

  if (editingOriginalName && editingOriginalName !== name && isCustomRecipe(editingOriginalName)) {
    deleteRecipe(editingOriginalName);
  }
  const recipe = {
    name,
    basePortions,
    ingredients,
    method: methodEl.value.trim(),
    glass: glassEl.value.trim(),
    garnish: garnishEl.value.trim(),
    ice: iceEl.value.trim(),
    history: historyEl.value.trim(),
    quickPitch: quickPitchEl.value.trim(),
  };
  const pairsWith = parsePairsWith(pairsWithEl.value);
  if (pairsWith.length > 0) recipe.pairsWith = pairsWith;
  saveRecipe(recipe);
  editingOriginalName = name;
}

function handleDelete() {
  if (!editingOriginalName) {
    alert("Bitte zuerst ein Rezept auswählen.");
    return;
  }
  if (!isCustomRecipe(editingOriginalName)) {
    alert('Dieses Rezept ist ein Klassiker aus der Bibliothek und wurde noch nicht in deinem Rezeptbuch gespeichert – es gibt nichts zu löschen.');
    return;
  }
  if (!confirm(`Rezept "${editingOriginalName}" wirklich löschen?`)) return;
  deleteRecipe(editingOriginalName);
  resetForm();
  showListView();
}

function renderIngredientRows(ingredients) {
  return ingredients
    .map(
      (ing) =>
        `<tr><td>${escapeHtml(ing.name)}</td><td>${formatNumber(ing.amount)} ${UNIT_LABELS[ing.unit] ?? escapeHtml(ing.unit)}</td></tr>`
    )
    .join("");
}

function recipeMatchesQuery(recipe, query) {
  if (recipe.name.toLowerCase().includes(query)) return true;
  return recipe.ingredients.some((ing) => ing.name.toLowerCase().includes(query));
}

function currentFilteredRecipes() {
  const query = searchEl.value.trim().toLowerCase();
  return getAllRecipes().filter((r) => recipeMatchesQuery(r, query));
}

function updateExportBar() {
  selectedCountEl.textContent = `${selectedNames.size} ausgewählt`;
  exportExcelBtn.disabled = selectedNames.size === 0;
  exportWordBtn.disabled = selectedNames.size === 0;
}

function renderBrowseList() {
  const recipes = currentFilteredRecipes();

  if (recipes.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Keine Rezepte gefunden.</p>`;
    updateExportBar();
    return;
  }
  listEl.innerHTML = "";
  recipes.forEach((recipe) => {
    const metaRows = [
      ["Glas", recipe.glass],
      ["Garnitur", recipe.garnish],
      ["Eis", recipe.ice],
      ["Zubereitung", recipe.method],
      ["Geschichte", recipe.history],
      ["Kurzer Pitch", recipe.quickPitch],
      ["Passt gut zu", (recipe.pairsWith ?? []).join(", ")],
    ].filter(([, value]) => value);

    const item = document.createElement("details");
    item.className = "recipe-item";
    item.innerHTML = `
      <summary>
        <span class="recipe-item-title">
          <input type="checkbox" class="recipe-select-checkbox" ${selectedNames.has(recipe.name) ? "checked" : ""} />
          ${escapeHtml(recipe.name)}
        </span>
      </summary>
      <div class="recipe-item-body">
        <table><tbody>${renderIngredientRows(recipe.ingredients)}</tbody></table>
        ${metaRows.map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join("")}
        <div class="actions">
          <button type="button" class="btn-secondary edit-btn">Bearbeiten</button>
          ${isCustomRecipe(recipe.name) ? `<button type="button" class="btn-secondary delete-btn">Löschen</button>` : ""}
        </div>
      </div>
    `;
    const checkbox = item.querySelector(".recipe-select-checkbox");
    checkbox.addEventListener("click", (e) => e.stopPropagation());
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedNames.add(recipe.name);
      } else {
        selectedNames.delete(recipe.name);
      }
      updateExportBar();
    });
    item.querySelector(".edit-btn").addEventListener("click", (e) => {
      e.preventDefault();
      loadIntoForm(recipe);
      showEditView();
    });
    const deleteBtn = item.querySelector(".delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (!confirm(`Rezept "${recipe.name}" wirklich löschen?`)) return;
        if (editingOriginalName === recipe.name) resetForm();
        deleteRecipe(recipe.name);
      });
    }
    listEl.appendChild(item);
  });
  updateExportBar();
}

function renderSidebarList() {
  const query = sidebarSearchEl.value.trim().toLowerCase();
  const recipes = getAllRecipes().filter((r) => recipeMatchesQuery(r, query));

  if (recipes.length === 0) {
    sidebarListEl.innerHTML = `<p class="empty-note">Keine Rezepte gefunden.</p>`;
    return;
  }
  sidebarListEl.innerHTML = "";
  recipes.forEach((recipe) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recipe-name-btn" + (recipe.name === editingOriginalName ? " active" : "");
    btn.textContent = recipe.name;
    btn.addEventListener("click", () => loadIntoForm(recipe));
    sidebarListEl.appendChild(btn);
  });
}

export function initRecipes() {
  editor.setIngredients([]);
  document.getElementById("recipe-add-ingredient").addEventListener("click", () => editor.addRow());
  document.getElementById("recipe-save").addEventListener("click", handleSave);
  document.getElementById("recipe-new").addEventListener("click", resetForm);
  document.getElementById("recipe-delete").addEventListener("click", handleDelete);
  document.getElementById("recipe-list-new").addEventListener("click", () => {
    resetForm();
    showEditView();
  });
  document.getElementById("recipe-back-to-list").addEventListener("click", showListView);
  document.getElementById("recipe-sidebar-new").addEventListener("click", resetForm);
  searchEl.addEventListener("input", renderBrowseList);
  sidebarSearchEl.addEventListener("input", renderSidebarList);
  selectAllBtn.addEventListener("click", () => {
    currentFilteredRecipes().forEach((r) => selectedNames.add(r.name));
    renderBrowseList();
  });
  selectNoneBtn.addEventListener("click", () => {
    selectedNames.clear();
    renderBrowseList();
  });
  exportExcelBtn.addEventListener("click", () => {
    const recipes = getAllRecipes().filter((r) => selectedNames.has(r.name));
    if (recipes.length > 0) exportRecipesToExcel(recipes);
  });
  exportWordBtn.addEventListener("click", () => {
    const recipes = getAllRecipes().filter((r) => selectedNames.has(r.name));
    if (recipes.length > 0) exportRecipesToWord(recipes);
  });
  onRecipesChanged(() => {
    renderBrowseList();
    renderSidebarList();
  });
  renderBrowseList();
  renderSidebarList();
}
