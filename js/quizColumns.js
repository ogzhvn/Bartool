import { t } from "./i18n.js";

// Spaltendefinitionen für die Fragentabelle (js/quizTable.js).
//
// Aufbau wie js/catalogColumns.js, damit beide Tabellen gleich gelesen und
// später gemeinsam editierbar gemacht werden können. Eine Spalte beschreibt
// ein Feld des Fragenobjekts aus js/storage.js (fromQuizQuestionRow), also
// camelCase, nicht die Spaltennamen der Datenbank.
//
// `wert` ist optional und liefert einen abgeleiteten Text – die richtige
// Antwort steht nicht in einem eigenen Feld, sondern ist options[correctIndex].

export const QUIZ_COLUMNS = [
  { field: "question", labelKey: "ui.frage", type: "readonly", width: 360 },
  { field: "topic", labelKey: "ui.thema", type: "text", width: 160 },
  { field: "parentTopic", labelKey: "ui.oberthema", type: "text", width: 150 },
  {
    field: "difficulty",
    labelKey: "ui.schwierigkeit",
    type: "select",
    width: 120,
    options: () => [
      { value: 1, label: t("ui.leicht") },
      { value: 2, label: t("ui.mittel") },
      { value: 3, label: t("ui.schwer") },
    ],
  },
  {
    field: "correct",
    labelKey: "ui.richtige_antwort",
    type: "readonly",
    width: 200,
    wert: (frage) => frage.options?.[frage.correctIndex] ?? "",
  },
  {
    field: "options",
    labelKey: "ui.antworten",
    type: "readonly",
    width: 320,
    wert: (frage) => (frage.options ?? []).join(" · "),
  },
  { field: "explanation", labelKey: "ui.erklaerung", type: "longtext", width: 300 },
  { field: "refProduct", labelKey: "ui.produkt", type: "text", width: 180 },
  { field: "refRecipe", labelKey: "ui.rezept", type: "text", width: 180 },
  {
    field: "source",
    labelKey: "ui.quelle",
    type: "select",
    width: 120,
    options: () => [
      { value: "generator", label: t("ui.generiert") },
      { value: "kuratiert", label: t("ui.kuratiert") },
    ],
  },
  { field: "edited", labelKey: "ui.bearbeitet", type: "bool", width: 110 },
  { field: "active", labelKey: "ui.aktiv", type: "bool", width: 90 },
  { field: "updatedAt", labelKey: "ui.zuletzt_geaendert", type: "date", width: 130 },
];

// Sets nach Arbeitszweck – dieselbe Idee wie bei der Katalogtabelle: nicht
// filtern, sondern zeigen, was man für diese eine Aufgabe braucht.
export const QUIZ_SETS = [
  {
    key: "kern",
    labelKey: "ui.kernfelder",
    fields: ["question", "topic", "difficulty", "correct", "active"],
  },
  {
    key: "texte",
    labelKey: "ui.texte",
    fields: ["question", "correct", "options", "explanation"],
  },
  {
    key: "zuordnung",
    labelKey: "ui.zuordnung",
    fields: ["question", "topic", "parentTopic", "refProduct", "refRecipe", "source", "edited"],
  },
  { key: "alles", labelKey: "ui.alle_spalten", fields: QUIZ_COLUMNS.map((c) => c.field) },
];

// Auf dem Handy startet die Tabelle mit den Kernfeldern.
export const QUIZ_NARROW_SET = "kern";
