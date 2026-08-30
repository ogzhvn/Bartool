const RECIPES_KEY = "bartool.batchRecipes";

export function loadRecipes() {
  try {
    const raw = localStorage.getItem(RECIPES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
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
}

export function deleteRecipe(name) {
  const recipes = loadRecipes().filter((r) => r.name !== name);
  localStorage.setItem(RECIPES_KEY, JSON.stringify(recipes));
}
