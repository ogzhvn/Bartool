import { t } from "./i18n.js";

// Spaltendefinitionen für die Katalogtabelle (js/adminTable.js).
//
// Eine Spalte beschreibt genau ein Feld des Produkt- bzw. Rezeptobjekts, wie
// es fromProductRow()/fromRecipeRow() in js/storage.js liefert – also
// camelCase, nicht die Spaltennamen der Datenbank.
//
// Die Beschriftungen sind bewusst dieselben i18n-Schlüssel wie in
// js/productExport.js: Wer eine Tabelle exportiert und die Spalten mit der
// Ansicht im Tool vergleicht, soll denselben Wortlaut sehen. Kommt ein Feld
// dazu, gehört es in beide Dateien.
//
// type steuert, wie die Zelle gelesen und (ab Etappe 2) bearbeitet wird:
//   readonly  – nur Anzeige, nie editierbar (Name, Zutaten, pairsWith)
//   text      – einzeiliger Text
//   longtext  – mehrzeiliger Text, in der Tabelle auf eine Zeile gekürzt
//   number    – Zahl, Eingabe mit Komma oder Punkt
//   bool      – ja/nein
//   tags      – Liste kurzer Begriffe, als "a, b, c" dargestellt
//   select    – feste Auswahl (options)
// suggest: true heißt, dass die vorhandenen Werte des Katalogs als
// Vorschlagsliste angeboten werden (Kategorie, Gruppe, Lieferant …).

export const PRODUCT_COLUMNS = [
  { field: "name", labelKey: "ui.name", type: "readonly", width: 220 },
  { field: "category", labelKey: "ui.kategorie_herkunft", type: "text", width: 180, suggest: true },
  { field: "group", labelKey: "ui.gruppe", type: "text", width: 140, suggest: true },
  { field: "subGroup", labelKey: "ui.untergruppe", type: "text", width: 150, suggest: true },
  { field: "abv", labelKey: "ui.alkoholgehalt_006a", type: "text", width: 110 },
  { field: "abvValue", labelKey: "ui.alkoholgehalt_zahl", type: "number", width: 100 },
  { field: "abvMax", labelKey: "ui.alkoholgehalt_bis", type: "number", width: 100 },
  { field: "originCountry", labelKey: "ui.herkunftsland", type: "text", width: 140, suggest: true },
  { field: "originRegion", labelKey: "ui.herkunftsregion", type: "text", width: 150, suggest: true },
  { field: "baseMaterial", labelKey: "ui.grundstoff", type: "text", width: 150, suggest: true },
  { field: "productionMethod", labelKey: "ui.herstellungsverfahren", type: "text", width: 170, suggest: true },
  { field: "ageStatement", labelKey: "ui.altersangabe", type: "text", width: 120 },
  { field: "flavorTags", labelKey: "ui.aroma_schlagworte", type: "tags", width: 220 },
  { field: "region", labelKey: "ui.region", type: "text", width: 160, suggest: true },
  { field: "grapeVariety", labelKey: "ui.rebsorte", type: "text", width: 160, suggest: true },
  { field: "vineyard", labelKey: "ui.lage", type: "text", width: 150 },
  { field: "vintage", labelKey: "ui.jahrgang", type: "text", width: 90 },
  { field: "aging", labelKey: "ui.ausbau", type: "text", width: 160 },
  { field: "drinkingWindow", labelKey: "ui.trinkfenster", type: "text", width: 130 },
  { field: "producer", labelKey: "ui.erzeuger", type: "text", width: 160, suggest: true },
  { field: "sweetness", labelKey: "ui.geschmacksrichtung", type: "text", width: 140, suggest: true },
  { field: "classification", labelKey: "ui.klassifikation", type: "text", width: 150, suggest: true },
  { field: "servingTemp", labelKey: "ui.serviertemperatur", type: "text", width: 140 },
  { field: "body", labelKey: "ui.koerper", type: "text", width: 120, suggest: true },
  { field: "verified", labelKey: "ui.geprueft", type: "bool", width: 90 },
  { field: "tastingNotes", labelKey: "ui.tasting_notes", type: "longtext", width: 260 },
  { field: "foodPairing", labelKey: "ui.speiseempfehlung", type: "longtext", width: 220 },
  { field: "service", labelKey: "ui.serviervorschlag", type: "longtext", width: 220 },
  { field: "alternatives", labelKey: "ui.alternativen", type: "longtext", width: 200 },
  { field: "story", labelKey: "ui.story", type: "longtext", width: 260 },
  { field: "production", labelKey: "ui.herstellung", type: "longtext", width: 260 },
  { field: "allergens", labelKey: "ui.allergene", type: "text", width: 180 },
  { field: "quickPitch", labelKey: "ui.kurzer_pitch", type: "longtext", width: 260 },
  { field: "pairsWith", labelKey: "ui.passt_gut_zu", type: "readonly", width: 200 },
  { field: "priceValue", labelKey: "ui.einkaufspreis", type: "number", width: 110 },
  {
    field: "priceUnit",
    labelKey: "ui.preiseinheit",
    type: "select",
    width: 110,
    options: () => [
      { value: "liter", label: t("ui.liter_3629") },
      { value: "stueck", label: t("ui.stueck_26e1") },
    ],
  },
  { field: "parLevel", labelKey: "ui.soll_bestand", type: "number", width: 110 },
  { field: "supplier", labelKey: "ui.lieferant", type: "text", width: 160, suggest: true },
  { field: "orderUnit", labelKey: "ui.bestelleinheit", type: "text", width: 140, suggest: true },
];

export const RECIPE_COLUMNS = [
  { field: "name", labelKey: "ui.name", type: "readonly", width: 220 },
  { field: "category", labelKey: "ui.kategorie", type: "text", width: 170, suggest: true },
  { field: "basePortions", labelKey: "ui.ergibt_portionen_basis", type: "number", width: 110 },
  { field: "ingredients", labelKey: "ui.zutaten", type: "readonly", width: 300 },
  { field: "method", labelKey: "ui.zubereitung", type: "longtext", width: 280 },
  { field: "glass", labelKey: "ui.glas", type: "text", width: 150, suggest: true },
  { field: "garnish", labelKey: "ui.garnitur", type: "text", width: 180 },
  { field: "ice", labelKey: "ui.eis", type: "text", width: 140, suggest: true },
  { field: "quickPitch", labelKey: "ui.kurzer_pitch", type: "longtext", width: 260 },
  { field: "history", labelKey: "ui.geschichte", type: "longtext", width: 300 },
  { field: "methodEn", labelKey: "ui.zubereitung_englisch", type: "longtext", width: 280 },
  { field: "glassEn", labelKey: "ui.glas_englisch", type: "text", width: 150 },
  { field: "garnishEn", labelKey: "ui.garnitur_englisch", type: "text", width: 180 },
  { field: "quickPitchEn", labelKey: "ui.kurzer_pitch_englisch", type: "longtext", width: 260 },
  { field: "pairsWith", labelKey: "ui.passt_gut_zu", type: "readonly", width: 200 },
  { field: "salesPrice", labelKey: "ui.verkaufspreis_brutto_6be7", type: "number", width: 130 },
];

// Spaltensets: der Grund, warum die Tabelle auf einem Tablet benutzbar bleibt.
// Ein Set ist kein Filter, sondern ein Arbeitszweck – "Bestellwesen" zeigt die
// Felder, die man beim Bestellen füllt, und sonst nichts.
//
// "name" steht in jedem Set an erster Stelle: die Spalte bleibt beim
// Querscrollen stehen und ist der Anker der Zeile.
export const PRODUCT_SETS = [
  {
    key: "bestellwesen",
    labelKey: "ui.bestellwesen",
    fields: ["name", "category", "group", "priceValue", "priceUnit", "parLevel", "supplier", "orderUnit"],
  },
  {
    key: "produktwissen",
    labelKey: "ui.produktwissen",
    fields: [
      "name", "group", "subGroup", "abv", "abvValue", "originCountry", "originRegion",
      "baseMaterial", "productionMethod", "ageStatement", "flavorTags", "quickPitch", "verified",
    ],
  },
  {
    key: "wein",
    labelKey: "ui.wein_und_schaumwein",
    fields: [
      "name", "group", "region", "grapeVariety", "vineyard", "vintage", "aging",
      "drinkingWindow", "producer", "sweetness", "classification", "servingTemp", "body", "foodPairing",
    ],
  },
  {
    key: "texte",
    labelKey: "ui.texte",
    fields: ["name", "quickPitch", "tastingNotes", "service", "alternatives", "story", "production", "allergens"],
  },
  { key: "alles", labelKey: "ui.alle_spalten", fields: PRODUCT_COLUMNS.map((c) => c.field) },
];

export const RECIPE_SETS = [
  {
    key: "kern",
    labelKey: "ui.kernfelder",
    fields: ["name", "category", "basePortions", "glass", "ice", "garnish", "method"],
  },
  {
    key: "texte",
    labelKey: "ui.texte",
    fields: ["name", "quickPitch", "method", "garnish", "history"],
  },
  {
    key: "englisch",
    labelKey: "ui.englische_fassung",
    fields: ["name", "quickPitch", "quickPitchEn", "method", "methodEn", "glass", "glassEn", "garnish", "garnishEn"],
  },
  {
    key: "kalkulation",
    labelKey: "ui.kalkulation",
    fields: ["name", "category", "basePortions", "ingredients", "salesPrice"],
  },
  { key: "alles", labelKey: "ui.alle_spalten", fields: RECIPE_COLUMNS.map((c) => c.field) },
];

// Auf schmalen Geräten startet die Tabelle bewusst mit wenigen Spalten – eine
// 40-spaltige Tabelle auf dem Handy ist kein Werkzeug, sondern ein Rätsel.
export const NARROW_SETS = { products: "bestellwesen", recipes: "kern" };

export function columnsFor(kind) {
  return kind === "recipes" ? RECIPE_COLUMNS : PRODUCT_COLUMNS;
}

export function setsFor(kind) {
  return kind === "recipes" ? RECIPE_SETS : PRODUCT_SETS;
}

export function columnByField(kind, field) {
  return columnsFor(kind).find((column) => column.field === field) ?? null;
}
