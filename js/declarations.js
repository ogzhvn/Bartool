import { t } from "./i18n.js";

// Deklarationsschlüssel für Gerichte (Paket 70): Allergene und
// kennzeichnungspflichtige Zusatzstoffe.
//
// Diese Listen sind identisch mit private.declaration_keys_ok() in
// supabase/schema.sql. Die Datenbank weist jeden anderen Schlüssel ab. Wer
// hier etwas ergänzt, ändert die SQL-Funktion per Migration mit, sonst bietet
// die Oberfläche einen Haken an, den die DB beim Speichern ablehnt.
//
// Die Labels kommen aus i18n ("decl.allergen.<key>", "decl.additive.<key>").
// Die Inhalte der Gerichte bleiben deutsch.
//
// ---------------------------------------------------------------------
// Rechtsgrundlage (nachgeschlagen am 08.10.2026)
//
// Allergene: Verordnung (EU) Nr. 1169/2011 (LMIV), Anhang II „Stoffe oder
//   Erzeugnisse, die Allergien oder Unverträglichkeiten auslösen“.
//   Quelle: EUR-Lex, konsolidierte Fassung 02011R1169-20250401 (Stand
//   01.04.2025), DE und EN. Getreide (Nr. 1) und Schalenfrüchte (Nr. 8) sind
//   „namentlich“ aufgezählt, deshalb hat jede Art einen eigenen Unterschlüssel.
//   Seit der Delegierten VO (EU) 2024/2512 gibt es bei Senf (Nr. 10) eine
//   Ausnahme für Behensäure. Sie betrifft keinen Schlüssel.
//   Pflicht auch bei loser Ware: Art. 44 Abs. 1 Buchst. a LMIV. National
//   umgesetzt in § 4 Abs. 2 und 3 LMIDV (Lebensmittelinformations-
//   Durchführungsverordnung). § 4 Abs. 3 regelt, wie die Angabe bereitgestellt
//   wird: auf der Karte, als Fußnote, per Aushang oder als schriftliche bzw.
//   elektronische Information mit Hinweis darauf.
//   Quelle: gesetze-im-internet.de/lmidv, Stand: zuletzt geändert durch Art. 3
//   V v. 24.11.2025 (BGBl. 2025 I Nr. 280).
//
// Zusatzstoffe: § 5 Abs. 1 LMZDV (Lebensmittelzusatzstoff-
//   Durchführungsverordnung vom 02.06.2021). Sie löst § 9 ZZulV ab: Die ZZulV
//   wurde durch Art. 8 V v. 02.06.2021 aufgehoben.
//   Quelle: gesetze-im-internet.de/lmzdv. § 5 wurde zuletzt durch Art. 4 V v.
//   11.12.2024 (BGBl. 2024 I Nr. 411) geändert, in Kraft seit 01.01.2025.
//   Die letzte Änderung der LMZDV (Art. 4 V v. 24.08.2026, BGBl. 2026 I
//   Nr. 243) betrifft laut Änderungsliste auf buzer.de nur § 6 (Straftaten).
//   Das ist eine Sekundärquelle: gesetze-im-internet führt diese Änderung als
//   „dokumentarisch noch nicht abschließend bearbeitet“.
//   Aufgenommen sind die Angaben nach § 5 Abs. 1 Nr. 1–9, 11 und 12, Nr. 4 als
//   drei Schlüssel (a–c). Nicht aufgenommen ist Nr. 10 (Tafelsüßen), weil sie
//   kein Gericht betrifft. Ebenfalls nicht aufgenommen sind Koffein und Chinin,
//   die alten Speisekarten-Fußnoten: Sie stehen nicht in § 5 LMZDV. Ob sie bei
//   loser Ware noch verpflichtend sind, ist nicht geklärt (Entscheidung mit dem
//   Nutzer, 08.10.2026).
//
// Schreibweise (Entscheidung mit dem Nutzer, 08.10.2026): übliche Schreibweise
// „Sulfite“ und „Cashewnüsse“. Der DE-Text von Anhang II schreibt
// „Schwefeldioxid und Sulphite“ und „Kaschunüsse“. Alle anderen Labels folgen
// dem Wortlaut der Quelle.
// ---------------------------------------------------------------------
//
// Hauptgruppe und Art: Ein Unterschlüssel heißt <hauptgruppe>_<art> und trägt
// seine Hauptgruppe in "parent". So zeigt die Matrix eine Spalte je Gruppe.
// Die DB entfernt die Hauptgruppe, sobald eine Art derselben Gruppe gesetzt
// ist (private.allergens_normalize). Steht "gluten" oder "nuts" danach noch
// allein, fehlt die Art: Speichern geht (Import alter Küchenlisten), einen
// Prüfvermerk lehnt die DB ab.

export const ALLERGENS = [
  { key: "gluten", annex: 1 },
  { key: "gluten_weizen", parent: "gluten" },
  { key: "gluten_dinkel", parent: "gluten" },
  { key: "gluten_khorasan", parent: "gluten" },
  { key: "gluten_roggen", parent: "gluten" },
  { key: "gluten_gerste", parent: "gluten" },
  { key: "gluten_hafer", parent: "gluten" },
  { key: "gluten_hybride", parent: "gluten" },
  { key: "crustaceans", annex: 2 },
  { key: "eggs", annex: 3 },
  { key: "fish", annex: 4 },
  { key: "peanuts", annex: 5 },
  { key: "soy", annex: 6 },
  { key: "milk", annex: 7 },
  { key: "nuts", annex: 8 },
  { key: "nuts_mandel", parent: "nuts" },
  { key: "nuts_haselnuss", parent: "nuts" },
  { key: "nuts_walnuss", parent: "nuts" },
  { key: "nuts_cashew", parent: "nuts" },
  { key: "nuts_pekan", parent: "nuts" },
  { key: "nuts_para", parent: "nuts" },
  { key: "nuts_pistazie", parent: "nuts" },
  { key: "nuts_macadamia", parent: "nuts" },
  { key: "celery", annex: 9 },
  { key: "mustard", annex: 10 },
  { key: "sesame", annex: 11 },
  { key: "sulphites", annex: 12 },
  { key: "lupin", annex: 13 },
  { key: "molluscs", annex: 14 },
];

// lmzdv = Nummer in § 5 Abs. 1 LMZDV.
export const ADDITIVES = [
  { key: "farbstoff", lmzdv: "1" },
  { key: "konservierungsstoff", lmzdv: "2" },
  { key: "antioxidationsmittel", lmzdv: "3" },
  { key: "nitritpoekelsalz", lmzdv: "4a" },
  { key: "nitrat", lmzdv: "4b" },
  { key: "nitritpoekelsalz_nitrat", lmzdv: "4c" },
  { key: "geschmacksverstaerker", lmzdv: "5" },
  { key: "geschwaerzt", lmzdv: "6" },
  { key: "gewachst", lmzdv: "7" },
  { key: "phosphat", lmzdv: "8" },
  { key: "suessungsmittel", lmzdv: "9" },
  { key: "phenylalanin", lmzdv: "11" },
  { key: "abfuehrend", lmzdv: "12" },
];

// Die 14 Hauptgruppen in der Reihenfolge von Anhang II, z. B. als Spalten der Matrix.
export const ALLERGEN_GROUPS = ALLERGENS.filter((a) => !a.parent);

const ALLERGEN_BY_KEY = new Map(ALLERGENS.map((a) => [a.key, a]));
const ADDITIVE_KEYS = new Set(ADDITIVES.map((a) => a.key));

export function isAllergenKey(key) {
  return ALLERGEN_BY_KEY.has(key);
}

export function isAdditiveKey(key) {
  return ADDITIVE_KEYS.has(key);
}

// Hauptgruppe eines Allergenschlüssels ("gluten_weizen" -> "gluten").
export function allergenGroup(key) {
  const entry = ALLERGEN_BY_KEY.get(key);
  return entry ? entry.parent ?? entry.key : null;
}

export function allergenSubtypes(groupKey) {
  return ALLERGENS.filter((a) => a.parent === groupKey);
}

// Hauptgruppen, die ohne Art deklariert sind ("gluten" ohne "gluten_*").
// Solange die Liste nicht leer ist, lehnt die DB den Prüfvermerk ab.
export function missingSubtypes(keys) {
  const set = new Set(keys ?? []);
  return ALLERGEN_GROUPS.filter(
    (g) => set.has(g.key) && allergenSubtypes(g.key).length > 0 && !allergenSubtypes(g.key).some((s) => set.has(s.key))
  ).map((g) => g.key);
}

// kind: "allergen" | "additive"
export function declarationLabel(key, kind = "allergen") {
  return t(`decl.${kind}.${key}`);
}
