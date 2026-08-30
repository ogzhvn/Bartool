import { loadRecipes, saveRecipe, deleteRecipe, onRecipesChanged } from "./storage.js";
import { createIngredientEditor } from "./ingredientEditor.js";
import { escapeHtml } from "./utils.js";
import { CLASSIC_RECIPES } from "./classicsData.js";
import { switchTab } from "./tabs.js";

const nameEl = document.getElementById("recipe-name");
const basePortionsEl = document.getElementById("recipe-base-portions");
const methodEl = document.getElementById("recipe-method");
const glassEl = document.getElementById("recipe-glass");
const garnishEl = document.getElementById("recipe-garnish");
const historyEl = document.getElementById("recipe-history");
const listEl = document.getElementById("recipe-list");
const ingredientsEl = document.getElementById("recipe-ingredients");
const searchEl = document.getElementById("recipe-search");

const editor = createIngredientEditor(ingredientsEl);

let editingOriginalName = null;

function resetForm() {
  nameEl.value = "";
  basePortionsEl.value = 1;
  methodEl.value = "";
  glassEl.value = "";
  garnishEl.value = "";
  historyEl.value = "";
  editor.setIngredients([]);
  editingOriginalName = null;
}

function loadIntoForm(recipe) {
  nameEl.value = recipe.name;
  basePortionsEl.value = recipe.basePortions;
  methodEl.value = recipe.method ?? "";
  glassEl.value = recipe.glass ?? "";
  garnishEl.value = recipe.garnish ?? "";
  historyEl.value = recipe.history ?? "";
  editor.setIngredients(recipe.ingredients);
  editingOriginalName = recipe.name;
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

  if (editingOriginalName && editingOriginalName !== name) {
    deleteRecipe(editingOriginalName);
  }
  saveRecipe({
    name,
    basePortions,
    ingredients,
    method: methodEl.value.trim(),
    glass: glassEl.value.trim(),
    garnish: garnishEl.value.trim(),
    history: historyEl.value.trim(),
  });
  editingOriginalName = name;
  switchTab("recipes");
}

function handleDelete() {
  if (!editingOriginalName) {
    alert("Bitte zuerst ein gespeichertes Rezept zum Bearbeiten laden.");
    return;
  }
  if (!confirm(`Rezept "${editingOriginalName}" wirklich löschen?`)) return;
  deleteRecipe(editingOriginalName);
  resetForm();
  switchTab("recipes");
}

function handleImportClassics() {
  if (!confirm(`${CLASSIC_RECIPES.length} Klassiker-Rezepte ins Rezeptbuch übernehmen? Bereits vorhandene Rezepte mit gleichem Namen werden aktualisiert.`)) {
    return;
  }
  CLASSIC_RECIPES.forEach((recipe) => saveRecipe(recipe));
}

function renderList() {
  const query = searchEl.value.trim().toLowerCase();
  const recipes = loadRecipes().filter((r) => r.name.toLowerCase().includes(query));

  if (recipes.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Keine Rezepte gefunden.</p>`;
    return;
  }
  listEl.innerHTML = "";
  recipes.forEach((recipe) => {
    const item = document.createElement("div");
    item.className = "saved-item";
    const details = [recipe.glass, recipe.garnish, recipe.method].filter(Boolean).map(escapeHtml).join(" · ");
    item.innerHTML = `
      <div class="saved-item-top">
        <span>${escapeHtml(recipe.name)}</span>
        <span class="saved-actions">
          <button type="button" class="btn-secondary edit-btn">Bearbeiten</button>
          <button type="button" class="btn-secondary delete-btn">Löschen</button>
        </span>
      </div>
      ${details ? `<p class="recipe-details">${details}</p>` : ""}
    `;
    item.querySelector(".edit-btn").addEventListener("click", () => {
      loadIntoForm(recipe);
      switchTab("recipe-edit");
    });
    item.querySelector(".delete-btn").addEventListener("click", () => {
      if (!confirm(`Rezept "${recipe.name}" wirklich löschen?`)) return;
      if (editingOriginalName === recipe.name) resetForm();
      deleteRecipe(recipe.name);
    });
    listEl.appendChild(item);
  });
}

export function initRecipes() {
  editor.setIngredients([]);
  document.getElementById("recipe-add-ingredient").addEventListener("click", () => editor.addRow());
  document.getElementById("recipe-save").addEventListener("click", handleSave);
  document.getElementById("recipe-new").addEventListener("click", resetForm);
  document.getElementById("recipe-delete").addEventListener("click", handleDelete);
  document.getElementById("recipe-import-classics").addEventListener("click", handleImportClassics);
  document.getElementById("recipe-list-new").addEventListener("click", () => {
    resetForm();
    switchTab("recipe-edit");
  });
  searchEl.addEventListener("input", renderList);
  onRecipesChanged(renderList);
  renderList();
}
