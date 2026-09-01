import { UNIT_TO_ML } from "./units.js";
import { getProduct } from "./productLibrary.js";

const VOLUME_UNITS = new Set(Object.keys(UNIT_TO_ML));

export function priceLabelFor(unit) {
  return VOLUME_UNITS.has(unit) ? "€ / Liter" : "€ / Stück";
}

export function ingredientCost(amount, unit, price) {
  if (VOLUME_UNITS.has(unit)) {
    const ml = amount * (UNIT_TO_ML[unit] ?? 1);
    return (ml / 1000) * price;
  }
  return amount * price;
}

// Looks up the stored purchase price for an ingredient by matching it against
// the product catalog (custom products override the bundled catalog, same as
// everywhere else). Returns null when the ingredient isn't a known product or
// has no price on file yet, so callers can fall back to manual entry instead
// of silently costing it as free.
export function priceForIngredient(ingredientName) {
  const product = getProduct(ingredientName);
  if (!product || !product.priceValue) return null;
  return product.priceValue;
}

// Costs a full recipe by looking up each ingredient's price automatically.
// Ingredients without a stored price get cost 0 and priceKnown: false, so the
// caller can flag them instead of understating the total silently.
export function calculateRecipeCost(recipe) {
  const lines = recipe.ingredients.map((ing) => {
    const price = priceForIngredient(ing.name);
    const cost = ingredientCost(ing.amount, ing.unit, price ?? 0);
    return { name: ing.name, amount: ing.amount, unit: ing.unit, price: price ?? 0, cost, priceKnown: price !== null };
  });
  const total = lines.reduce((sum, l) => sum + l.cost, 0);
  return { lines, total, allPricesKnown: lines.every((l) => l.priceKnown) };
}
