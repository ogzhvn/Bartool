import { getLocale } from "./i18n.js";
import { loadProducts } from "./storage.js";
import { getAllRecipes } from "./recipeLibrary.js";

// Einziger Lesezugang auf den Produktkatalog. Alle Produkte stehen in der
// Tabelle `products`; die fruehere statische Datei productsData.js ist
// entfallen, nachdem ihr Inhalt vollstaendig in die Datenbank uebernommen war
// – sie wurde von den DB-Eintraegen ohnehin ueberschrieben und liess sich nur
// doppelt pflegen.
//
// Offline liefert loadProducts() den letzten Stand aus dem localStorage-Cache
// (siehe storage.js).
export function getAllProducts() {
  return [...loadProducts()].sort((a, b) => a.name.localeCompare(b.name, getLocale()));
}

export function getProduct(name) {
  return getAllProducts().find((p) => p.name === name) ?? null;
}

// Heisst seit dem Wegfall der statischen Datei schlicht: der Eintrag liegt in
// der Datenbank und ist damit aenderbar.
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
