const RECIPES_KEY = "bartool.batchRecipes";
const RECIPES_UPDATED_EVENT = "bartool:recipes-updated";
const PRODUCTS_KEY = "bartool.customProducts";
const PRODUCTS_UPDATED_EVENT = "bartool:products-updated";

export function loadRecipes() {
  try {
    const raw = localStorage.getItem(RECIPES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Drop malformed entries (e.g. from an older data shape) so one bad
    // record can't break rendering for every recipe.
    return parsed.filter((r) => r && typeof r.name === "string" && Array.isArray(r.ingredients));
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

export function loadProducts() {
  try {
    const raw = localStorage.getItem(PRODUCTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && typeof p.name === "string");
  } catch {
    return [];
  }
}

export function saveProduct(product) {
  const products = loadProducts();
  const existingIndex = products.findIndex((p) => p.name === product.name);
  if (existingIndex >= 0) {
    products[existingIndex] = product;
  } else {
    products.push(product);
  }
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  window.dispatchEvent(new CustomEvent(PRODUCTS_UPDATED_EVENT));
}

export function deleteProduct(name) {
  const products = loadProducts().filter((p) => p.name !== name);
  localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  window.dispatchEvent(new CustomEvent(PRODUCTS_UPDATED_EVENT));
}

export function onProductsChanged(callback) {
  window.addEventListener(PRODUCTS_UPDATED_EVENT, callback);
}

const INVENTORY_KEY = "bartool.inventory";
const INVENTORY_UPDATED_EVENT = "bartool:inventory-updated";

// Gespeicherte Bar-Inventur für die Bestands-Empfehlungen: die Namen der
// Produkte, die aktuell als vorrätig markiert sind. Startet bewusst leer -
// eine echte Inventur baut man sich einmal auf, statt anzunehmen, dass
// standardmäßig alles vorrätig ist.
export function loadInventory() {
  try {
    const raw = localStorage.getItem(INVENTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n) => typeof n === "string"));
  } catch {
    return new Set();
  }
}

export function saveInventory(inStockNames) {
  localStorage.setItem(INVENTORY_KEY, JSON.stringify([...inStockNames]));
  window.dispatchEvent(new CustomEvent(INVENTORY_UPDATED_EVENT));
}
