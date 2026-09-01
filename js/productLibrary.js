import { loadProducts } from "./storage.js";
import { PRODUCTS } from "./productsData.js";
import { getAllRecipes } from "./recipeLibrary.js";

// Combines the user's own saved/edited products with the bundled catalog.
// A custom product overrides a bundled one of the same name.
export function getAllProducts() {
  const custom = loadProducts();
  const customNames = new Set(custom.map((p) => p.name));
  const bundled = PRODUCTS.filter((p) => !customNames.has(p.name));
  return [...custom, ...bundled].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export function getProduct(name) {
  return getAllProducts().find((p) => p.name === name) ?? null;
}

export function isCustomProduct(name) {
  return loadProducts().some((p) => p.name === name);
}

// Cross-references the recipe book: which cocktails use this product by name
// (matches if the product name appears as/within an ingredient name).
export function getRecipesUsingProduct(productName) {
  const needle = productName.trim().toLowerCase();
  if (!needle) return [];
  return getAllRecipes().filter((recipe) =>
    recipe.ingredients.some((ing) => ing.name.toLowerCase().includes(needle))
  );
}
