import { getAllProducts } from "./productLibrary.js";

// Sucht per striktem Teilstring-Vergleich (wie überall im Bartool: die
// Zutatenbezeichnung muss den vollen Produktnamen der Hausmarke enthalten –
// ein generischer Name wie "Gin" matcht nicht) das passende Produkt.
function matchProduct(ingredientName) {
  const lower = ingredientName.toLowerCase();
  return getAllProducts().find((p) => lower.includes(p.name.toLowerCase())) ?? null;
}

// Rechnet die Allergene eines Rezepts aus den Produktangaben der Zutaten
// hoch. Zutaten ohne Produkt-Treffer landen in "unmatched", statt
// stillschweigend als allergenfrei zu gelten.
export function allergensForRecipe(recipe) {
  const allergens = new Set();
  const unmatched = [];

  recipe.ingredients.forEach((ing) => {
    const product = matchProduct(ing.name);
    if (!product) {
      unmatched.push(ing.name);
      return;
    }
    const text = (product.allergens ?? "").trim();
    if (text && text !== "Keine bekannten") {
      allergens.add(text);
    }
  });

  return { allergens: [...allergens], unmatched };
}
