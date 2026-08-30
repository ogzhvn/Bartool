import { loadRecipes, saveRecipe, deleteRecipe, onRecipesChanged } from "./storage.js";
import { createIngredientEditor } from "./ingredientEditor.js";

const nameEl = document.getElementById("recipe-name");
const basePortionsEl = document.getElementById("recipe-base-portions");
const listEl = document.getElementById("recipe-list");
const ingredientsEl = document.getElementById("recipe-ingredients");

const editor = createIngredientEditor(ingredientsEl);

let editingOriginalName = null;

function resetForm() {
  nameEl.value = "";
  basePortionsEl.value = 1;
  editor.setIngredients([]);
  editingOriginalName = null;
}

function loadIntoForm(recipe) {
  nameEl.value = recipe.name;
  basePortionsEl.value = recipe.basePortions;
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
  saveRecipe({ name, basePortions, ingredients });
  editingOriginalName = name;
}

function handleDelete() {
  if (!editingOriginalName) {
    alert("Bitte zuerst ein gespeichertes Rezept zum Bearbeiten laden.");
    return;
  }
  if (!confirm(`Rezept "${editingOriginalName}" wirklich löschen?`)) return;
  deleteRecipe(editingOriginalName);
  resetForm();
}

function renderList() {
  const recipes = loadRecipes();
  if (recipes.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Noch keine Rezepte gespeichert.</p>`;
    return;
  }
  listEl.innerHTML = "";
  recipes.forEach((recipe) => {
    const item = document.createElement("div");
    item.className = "saved-item";
    item.innerHTML = `
      <span>${recipe.name}</span>
      <span class="saved-actions">
        <button type="button" class="btn-secondary edit-btn">Bearbeiten</button>
        <button type="button" class="btn-secondary delete-btn">Löschen</button>
      </span>
    `;
    item.querySelector(".edit-btn").addEventListener("click", () => loadIntoForm(recipe));
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
  onRecipesChanged(renderList);
  renderList();
}
