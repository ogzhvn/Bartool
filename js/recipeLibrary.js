import { getLocale } from "./i18n.js";
import { loadRecipes } from "./storage.js";

// Einziger Lesezugang auf das Rezeptbuch. Alle Rezepte stehen in der Tabelle
// `recipes`; die frueheren statischen Dateien (classicsData.js,
// houseRecipes.js) sind entfallen, nachdem ihr Inhalt vollstaendig in die
// Datenbank uebernommen war – sie wurden von den DB-Eintraegen ohnehin
// ueberschrieben und liessen sich nur doppelt pflegen.
//
// Offline liefert loadRecipes() den letzten Stand aus dem localStorage-Cache
// (siehe storage.js).
export function getAllRecipes() {
  return [...loadRecipes()].sort((a, b) => a.name.localeCompare(b.name, getLocale()));
}

export function getRecipe(name) {
  return getAllRecipes().find((r) => r.name === name) ?? null;
}

// Heisst seit dem Wegfall der statischen Dateien schlicht: der Eintrag liegt
// in der Datenbank und ist damit aenderbar. Die Aufrufer nutzen das, um
// Loeschen bzw. "Loeschung vorschlagen" anzubieten.
export function isCustomRecipe(name) {
  return loadRecipes().some((r) => r.name === name);
}
