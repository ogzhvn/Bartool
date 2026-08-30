const RECIPES_KEY = "bartool.batchRecipes";
const RECIPES_UPDATED_EVENT = "bartool:recipes-updated";

export function loadRecipes() {
  try {
    const raw = localStorage.getItem(RECIPES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getRecipeByName(name) {
  return loadRecipes().find((r) => r.name === name) ?? null;
}

export function saveRecipe(recipe) {
  const recipes = loadRecipes();
  const existingIndex = recipes.findIndex((r) => r.name === recipe.name);
  if (existingIndex >= 0) {
    recipes[existingIndex] = recipe;
  } else {
    recipes.push(recipe);
  }
  localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
  window.dispatchEvent(new CustomEvent(RECIPES_UPDATED_EVENT));
}

export function deleteRecipe(name) {
  const recipes = loadRecipes().filter((r) => r.name !== name);
  localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
  window.dispatchEvent(new CustomEvent(RECIPES_UPDATED_EVENT));
}

export function onRecipesChanged(callback) {
  window.addEventListener(RECIPES_UPDATED_EVENT, callback);
}
