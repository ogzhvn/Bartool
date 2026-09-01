import { getAllRecipes } from "./recipeLibrary.js";

export const FLAVOR_DIMENSIONS = [
  "suess",
  "sauer",
  "bitter",
  "herbKraeuterig",
  "fruchtig",
  "wuerzigScharf",
  "floral",
  "rauchig",
  "erdigHolzig",
  "nussig",
  "cremig",
  "salzigMineralisch",
];

export const FLAVOR_LABELS = {
  suess: "Süß",
  sauer: "Sauer",
  bitter: "Bitter",
  herbKraeuterig: "Herb/Kräuterig",
  fruchtig: "Fruchtig",
  wuerzigScharf: "Würzig/Scharf",
  floral: "Floral",
  rauchig: "Rauchig",
  erdigHolzig: "Erdig/Holzig",
  nussig: "Nussig",
  cremig: "Cremig",
  salzigMineralisch: "Salzig/Mineralisch",
};

// Handkuratierte Gewichtung zwischen den Aroma-Dimensionen (0 = passt kaum,
// 1 = passt sehr gut) statt reiner Kosinus-Ähnlichkeit: manche Paarungen
// funktionieren durch Kontrast (z. B. süß x sauer), andere durch
// Übereinstimmung (z. B. fruchtig x fruchtig). Nur die obere Hälfte wird
// gepflegt, weight() spiegelt sie symmetrisch.
const DIMENSION_WEIGHTS = {
  suess: { suess: 0.5, sauer: 1.0, bitter: 0.9, herbKraeuterig: 0.7, fruchtig: 0.8, wuerzigScharf: 0.6, floral: 0.7, rauchig: 0.6, erdigHolzig: 0.6, nussig: 0.8, cremig: 0.8, salzigMineralisch: 0.9 },
  sauer: { sauer: 0.3, bitter: 0.7, herbKraeuterig: 0.7, fruchtig: 0.9, wuerzigScharf: 0.6, floral: 0.6, rauchig: 0.5, erdigHolzig: 0.4, nussig: 0.5, cremig: 0.5, salzigMineralisch: 0.6 },
  bitter: { bitter: 0.4, herbKraeuterig: 0.8, fruchtig: 0.7, wuerzigScharf: 0.6, floral: 0.6, rauchig: 0.5, erdigHolzig: 0.6, nussig: 0.6, cremig: 0.6, salzigMineralisch: 0.5 },
  herbKraeuterig: { herbKraeuterig: 0.6, fruchtig: 0.6, wuerzigScharf: 0.7, floral: 0.7, rauchig: 0.5, erdigHolzig: 0.7, nussig: 0.5, cremig: 0.4, salzigMineralisch: 0.6 },
  fruchtig: { fruchtig: 0.8, wuerzigScharf: 0.7, floral: 0.8, rauchig: 0.3, erdigHolzig: 0.4, nussig: 0.6, cremig: 0.7, salzigMineralisch: 0.5 },
  wuerzigScharf: { wuerzigScharf: 0.5, floral: 0.5, rauchig: 0.6, erdigHolzig: 0.6, nussig: 0.5, cremig: 0.5, salzigMineralisch: 0.6 },
  floral: { floral: 0.5, rauchig: 0.3, erdigHolzig: 0.3, nussig: 0.4, cremig: 0.5, salzigMineralisch: 0.4 },
  rauchig: { rauchig: 0.5, erdigHolzig: 0.7, nussig: 0.5, cremig: 0.4, salzigMineralisch: 0.7 },
  erdigHolzig: { erdigHolzig: 0.5, nussig: 0.7, cremig: 0.4, salzigMineralisch: 0.6 },
  nussig: { nussig: 0.5, cremig: 0.7, salzigMineralisch: 0.5 },
  cremig: { cremig: 0.4, salzigMineralisch: 0.5 },
  salzigMineralisch: { salzigMineralisch: 0.3 },
};

function weight(dimA, dimB) {
  return DIMENSION_WEIGHTS[dimA]?.[dimB] ?? DIMENSION_WEIGHTS[dimB]?.[dimA] ?? 0;
}

// A product "hat" ein Aromaprofil nur, wenn mindestens eine Dimension > 0
// ist – ein leeres/fehlendes Profil gilt als unbekannt statt als "passt zu
// nichts" gewertet zu werden.
export function hasFlavorProfile(product) {
  const profile = product?.flavorProfile;
  if (!profile) return false;
  return FLAVOR_DIMENSIONS.some((dim) => (profile[dim] ?? 0) > 0);
}

function profileCompatibility(profileA, profileB) {
  let raw = 0;
  let normA = 0;
  let normB = 0;
  for (const dimA of FLAVOR_DIMENSIONS) {
    const a = profileA[dimA] ?? 0;
    normA += a * a;
    for (const dimB of FLAVOR_DIMENSIONS) {
      raw += a * (profileB[dimB] ?? 0) * weight(dimA, dimB);
    }
  }
  for (const dimB of FLAVOR_DIMENSIONS) {
    const b = profileB[dimB] ?? 0;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, raw / (Math.sqrt(normA) * Math.sqrt(normB))));
}

function recipeUsesIngredient(recipe, productName) {
  const needle = productName.trim().toLowerCase();
  if (!needle) return false;
  return recipe.ingredients.some((ing) => ing.name.toLowerCase().includes(needle));
}

// Wie oft zwei Produkte bereits gemeinsam in einem Rezept vorkommen, als
// 0..1-Bonus gedeckelt bei 2 gemeinsamen Rezepten – die Rezeptdatenbank ist
// zu klein, um das stärker zu gewichten.
function coOccurrenceScore(nameA, nameB, recipes) {
  const count = recipes.filter((r) => recipeUsesIngredient(r, nameA) && recipeUsesIngredient(r, nameB)).length;
  return Math.min(1, count / 2);
}

export function recipesUsingBoth(nameA, nameB, recipes = getAllRecipes()) {
  return recipes.filter((r) => recipeUsesIngredient(r, nameA) && recipeUsesIngredient(r, nameB));
}

// Aroma-Dimensionen, in denen beide Produkte vertreten sind, absteigend nach
// kombinierter Intensität – für die Detailansicht ("warum passen die?").
export function sharedDimensions(profileA, profileB) {
  return FLAVOR_DIMENSIONS.filter((dim) => (profileA[dim] ?? 0) > 0 && (profileB[dim] ?? 0) > 0)
    .map((dim) => ({ dim, label: FLAVOR_LABELS[dim], a: profileA[dim], b: profileB[dim] }))
    .sort((x, y) => y.a + y.b - (x.a + x.b));
}

// Ordnet eine Rezeptzutat dem passenden Produkt mit Aromaprofil zu (per
// Namens-Teilstring, dasselbe Muster wie überall sonst in der App, z. B.
// getRecipesUsingProduct). Gibt null zurück, wenn keins gefunden wird.
export function resolveIngredientProduct(ingredientName, products) {
  const name = ingredientName.toLowerCase();
  return products.find((p) => hasFlavorProfile(p) && name.includes(p.name.toLowerCase())) ?? null;
}

// Rezepte haben selbst kein gepflegtes Aromaprofil (das gibt es nur an
// Produkten, siehe 2.1) – hier wird grob eines aus den erkannten Zutaten
// abgeleitet (einfacher Durchschnitt über alle Zutaten, die auf ein Produkt
// mit Aromaprofil matchen). Gibt null zurück, wenn keine einzige Zutat
// zugeordnet werden konnte, statt ein irreführendes Nullprofil zu liefern.
export function deriveRecipeFlavorProfile(recipe, products) {
  const matched = recipe.ingredients.map((ing) => resolveIngredientProduct(ing.name, products)).filter(Boolean);
  if (matched.length === 0) return null;
  const profile = {};
  FLAVOR_DIMENSIONS.forEach((dim) => {
    profile[dim] = matched.reduce((sum, p) => sum + (p.flavorProfile[dim] ?? 0), 0) / matched.length;
  });
  return profile;
}

// Verpackt ein beliebiges Aromaprofil (z. B. von deriveRecipeFlavorProfile
// oder aus manuell angetippten Aroma-Chips) als Pseudo-Produkt, damit
// compatibilityScore() wiederverwendet werden kann statt eine zweite
// Score-Funktion zu pflegen.
export function asFlavorProfileHolder(name, flavorProfile) {
  return { name, flavorProfile };
}

// 0-100 Kompatibilitäts-Score zwischen zwei Produkten: 70 % Aromaprofil-
// Kompatibilität (Kontrast/Übereinstimmung je Dimensionspaar), 30 % Bonus
// dafür, wie oft beide bereits gemeinsam in einem Rezept stehen. Gibt null
// zurück, wenn eines der beiden Produkte kein (bekanntes) Aromaprofil hat,
// statt es fälschlich als "passt schlecht" zu werten.
export function compatibilityScore(productA, productB, recipes = getAllRecipes()) {
  if (!productA || !productB || productA.name === productB.name) return null;
  if (!hasFlavorProfile(productA) || !hasFlavorProfile(productB)) return null;
  const profileScore = profileCompatibility(productA.flavorProfile, productB.flavorProfile);
  const coScore = coOccurrenceScore(productA.name, productB.name, recipes);
  return Math.round((0.7 * profileScore + 0.3 * coScore) * 100);
}
