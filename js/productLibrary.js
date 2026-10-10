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

// Ordnet einen Namen (meist eine Rezeptzutat) einem Produkt aus dem Katalog
// zu – die eine Stelle im Tool, an der dieses Matching stattfindet. Erst
// exakt, dann als Teilstring: im Rezeptbuch heißt die Zutat oft
// "Bombay Sapphire Gin 47 %", das Produkt aber nur "Bombay Sapphire Gin".
// Bei mehreren Treffern gewinnt der längste Produktname, damit ein
// generisches "Gin" nicht die Hausmarke verdrängt.
//
// products kann eine schon geladene Produktliste sein. Wer viele Zutaten
// hintereinander auflöst, gibt sie mit, statt den Katalog je Zutat neu zu
// sortieren.
export function getProduct(name, products) {
  const gesucht = String(name ?? "").trim();
  if (!gesucht) return null;
  const liste = products ?? getAllProducts();
  const exakt = liste.find((p) => p.name === gesucht);
  if (exakt) return exakt;

  const zutat = gesucht.toLowerCase();
  let treffer = null;
  let trefferLaenge = 0;
  liste.forEach((p) => {
    const kandidat = String(p.name ?? "").trim().toLowerCase();
    if (!kandidat || !zutat.includes(kandidat)) return;
    if (kandidat.length > trefferLaenge) {
      treffer = p;
      trefferLaenge = kandidat.length;
    }
  });
  return treffer;
}

// Nur der exakte Name – für Stellen, an denen ein bestimmtes Produkt gemeint
// ist (Bearbeiten-Formular, Schwundbuchung) und ein Teilstring-Treffer ein
// falsches Produkt erwischen würde.
export function getProductExact(name) {
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
