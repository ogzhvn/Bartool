import { loadRecipes } from "./storage.js";
import { CLASSIC_RECIPES } from "./classicsData.js";

// Combines the user's own saved recipes with the bundled classics library.
// A custom recipe overrides a classic of the same name (e.g. after editing it).
export function getAllRecipes() {
  const custom = loadRecipes();
  const customNames = new Set(custom.map((r) => r.name));
  const classics = CLASSIC_RECIPES.filter((r) => !customNames.has(r.name));
  return [...custom, ...classics].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export function getRecipe(name) {
  return getAllRecipes().find((r) => r.name === name) ?? null;
}

export function isCustomRecipe(name) {
  return loadRecipes().some((r) => r.name === name);
}
