import { loadRecipes } from "./storage.js";
import { CLASSIC_RECIPES } from "./classicsData.js";
import { HOUSE_RECIPES } from "./houseRecipes.js";

// Combines the user's own saved recipes with the bundled house recipes and
// the generic classics library. Precedence by name: custom > house > classic
// (e.g. a house recipe overrides a generic classic of the same name, and
// editing either creates a custom copy that overrides both).
export function getAllRecipes() {
  const custom = loadRecipes();
  const customNames = new Set(custom.map((r) => r.name));

  const house = HOUSE_RECIPES.filter((r) => !customNames.has(r.name));
  const houseNames = new Set(HOUSE_RECIPES.map((r) => r.name));

  const classics = CLASSIC_RECIPES.filter((r) => !customNames.has(r.name) && !houseNames.has(r.name));

  return [...custom, ...house, ...classics].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export function getRecipe(name) {
  return getAllRecipes().find((r) => r.name === name) ?? null;
}

export function isCustomRecipe(name) {
  return loadRecipes().some((r) => r.name === name);
}
