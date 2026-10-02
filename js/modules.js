import { t } from "./i18n.js";

// Modulkatalog fürs Frontend (Paket 50).
//
// Die Schlüssel sind die data-tab-IDs aus index.html und identisch zu
// department_modules.module_key in der Datenbank. Die Matrix im Adminbereich
// (Paket 52) schreibt genau diese Werte; weicht hier ein Schlüssel ab, steht
// ein Häkchen in der Tabelle, das die Navigation nie liest.
//
// Gruppen und Reihenfolge folgen der Sidebar. Die Labels sind dieselben
// i18n-Schlüssel wie in der Navigation (t(), "ui.*"), die Abteilungs-Labels
// dagegen stehen in der DB und bleiben unübersetzt – wie bei den Rollen.
//
// Nicht im Katalog: "home" ist nie abschaltbar (canSee() gibt immer true),
// und die Admin-Gruppe hängt weiter nur an Rechten, nicht an der Abteilung.

export const ALWAYS_VISIBLE_MODULES = ["home"];

export const MODULE_GROUPS = [
  { key: "rechner", labelKey: "ui.rechner" },
  { key: "betrieb", labelKey: "ui.betrieb" },
  { key: "bibliothek", labelKey: "ui.bibliothek" },
];

export const MODULES = [
  // Rechner
  { key: "batching", group: "rechner", sort: 10, labelKey: "ui.batching" },
  { key: "superjuice", group: "rechner", sort: 20, labelKey: "ui.superjuice" },
  { key: "syrup", group: "rechner", sort: 30, labelKey: "ui.zuckersirup" },
  { key: "dilution", group: "rechner", sort: 40, labelKey: "ui.verduennung_und_abv" },
  { key: "calculation", group: "rechner", sort: 50, labelKey: "ui.kalkulation" },
  { key: "menu-costing", group: "rechner", sort: 60, labelKey: "ui.karte" },
  // Betrieb
  { key: "preparations", group: "betrieb", sort: 10, labelKey: "ui.mise_en_place" },
  { key: "events", group: "betrieb", sort: 20, labelKey: "ui.events" },
  { key: "shift-log", group: "betrieb", sort: 30, labelKey: "ui.uebergabe" },
  { key: "checklists", group: "betrieb", sort: 40, labelKey: "ui.checklisten" },
  { key: "inventory", group: "betrieb", sort: 50, labelKey: "ui.inventur" },
  { key: "losses", group: "betrieb", sort: 60, labelKey: "ui.schwund_und_bruch" },
  { key: "buildable", group: "betrieb", sort: 70, labelKey: "ui.was_kann_ich_bauen" },
  // Bibliothek
  { key: "recipes", group: "bibliothek", sort: 10, labelKey: "ui.rezepte" },
  { key: "products", group: "bibliothek", sort: 20, labelKey: "ui.produkte" },
  { key: "quiz", group: "bibliothek", sort: 30, labelKey: "ui.quiz" },
];

export function moduleLabel(key) {
  const module = MODULES.find((m) => m.key === key);
  return module ? t(module.labelKey) : key;
}

export function moduleGroupLabel(key) {
  const group = MODULE_GROUPS.find((g) => g.key === key);
  return group ? t(group.labelKey) : key;
}

// Module in Gruppenreihenfolge, innerhalb der Gruppe nach sort.
export function modulesByGroup() {
  return MODULE_GROUPS.map((group) => ({
    ...group,
    modules: MODULES.filter((m) => m.group === group.key).sort((a, b) => a.sort - b.sort),
  })).filter((group) => group.modules.length > 0);
}

export function moduleKeys() {
  return MODULES.map((m) => m.key);
}
