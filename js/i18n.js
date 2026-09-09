// Mehrsprachigkeit der Oberfläche (DE/EN) – ohne Framework, ohne Build.
//
// Grundgedanke: Ein flaches Schlüssel-Wörterbuch pro Sprache. `t(key)` gibt
// den Text der aktiven Sprache zurück; fehlt ein Schlüssel auf Englisch,
// fällt er sichtbar auf Deutsch zurück statt leer zu bleiben. Feste
// Beschriftungen in index.html tragen `data-i18n="key"` und werden beim
// Start und bei jedem Umschalten neu gefüllt. Texte, die in JS entstehen,
// laufen über `t()` und werden von den Modulen bei `onLanguageChanged()`
// neu gerendert – deshalb braucht das Umschalten kein Neuladen.
//
// Bewusst NICHT übersetzt: der Produktkatalog und die Kategorienamen. Für die
// wenigen Inhalte, die im Schichtbetrieb wirklich englisch gebraucht werden,
// gibt es unten localizedContent()/localizedText() (Paket 33).

import { de } from "./i18n/de.js";
import { en } from "./i18n/en.js";

const DICTS = { de, en };
export const AVAILABLE_LANGUAGES = ["de", "en"];
const FALLBACK_LANGUAGE = "de";
const STORAGE_KEY = "bartool-language";

// Intl-Locales je Sprache. Deutsch bleibt de-DE (Komma, 24h, €), Englisch
// wird bewusst en-GB: metrische Gewohnheiten, Tag/Monat/Jahr und 24h passen
// zum Betrieb in Deutschland besser als en-US.
const LOCALES = { de: "de-DE", en: "en-GB" };

let currentLanguage = FALLBACK_LANGUAGE;
const listeners = new Set();

function normalize(lang) {
  const short = String(lang ?? "").trim().toLowerCase().slice(0, 2);
  return AVAILABLE_LANGUAGES.includes(short) ? short : null;
}

function readStoredLanguage() {
  try {
    return normalize(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Privater Modus / blockierter Storage – dann eben ohne Erinnerung.
    return null;
  }
}

function writeStoredLanguage(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Nicht kritisch: die Sprache gilt dann nur für diese Sitzung.
  }
}

export function getLanguage() {
  return currentLanguage;
}

export function getLocale() {
  return LOCALES[currentLanguage] ?? LOCALES[FALLBACK_LANGUAGE];
}

// Platzhalter im Text sind {name} und werden aus `params` gefüllt.
function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

// Übersetzt einen Schlüssel. Reihenfolge: aktive Sprache → Deutsch →
// der Schlüssel selbst. Der letzte Fall ist ein Programmierfehler und soll
// im Betrieb auffallen, statt eine leere Beschriftung zu hinterlassen.
export function t(key, params) {
  const active = DICTS[currentLanguage]?.[key];
  if (typeof active === "string") return interpolate(active, params);
  const fallback = DICTS[FALLBACK_LANGUAGE]?.[key];
  if (typeof fallback === "string") return interpolate(fallback, params);
  return key;
}

// Übersetzt einen Schlüssel in einer bestimmten Sprache, unabhängig von der
// aktiven. Braucht der Excel-Import: eine auf Englisch exportierte Datei muss
// sich auch auf Deutsch wieder einlesen lassen.
export function tIn(lang, key, params) {
  const dict = DICTS[normalize(lang) ?? FALLBACK_LANGUAGE];
  const text = dict?.[key] ?? DICTS[FALLBACK_LANGUAGE]?.[key];
  return typeof text === "string" ? interpolate(text, params) : key;
}

// Für Stellen, die wissen müssen, ob ein Schlüssel überhaupt gepflegt ist.
export function hasTranslation(key) {
  return typeof DICTS[currentLanguage]?.[key] === "string";
}

export function onLanguageChanged(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// Setzt den Text eines Elements, ohne enthaltene Icons zu verlieren:
// `<button><i class="ph ph-house"></i>Start</button>` behält sein <i>,
// weil nur der erste echte Textknoten ersetzt wird. Nur wenn es gar keinen
// Textknoten gibt, wird der gesamte Inhalt gesetzt.
function setElementText(el, text) {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim() !== "") {
      node.nodeValue = text;
      return;
    }
  }
  if (el.childElementCount > 0) {
    el.appendChild(document.createTextNode(text));
  } else {
    el.textContent = text;
  }
}

const ATTRIBUTE_BINDINGS = [
  ["data-i18n-placeholder", "placeholder"],
  ["data-i18n-title", "title"],
  ["data-i18n-aria-label", "aria-label"],
  ["data-i18n-value", "value"],
];

// Füllt alle `data-i18n`-Beschriftungen unterhalb von `root`. Wird beim
// Start, bei jedem Sprachwechsel und von Modulen aufgerufen, die Markup
// nachträglich einhängen.
export function applyTranslations(root = document) {
  const scope = root instanceof Element || root instanceof DocumentFragment ? root : document;
  const all = [];
  if (scope instanceof Element && scope.hasAttribute("data-i18n")) all.push(scope);
  all.push(...scope.querySelectorAll("[data-i18n]"));
  all.forEach((el) => setElementText(el, t(el.dataset.i18n)));

  ATTRIBUTE_BINDINGS.forEach(([dataAttr, target]) => {
    const selector = `[${dataAttr}]`;
    const nodes = [];
    if (scope instanceof Element && scope.hasAttribute(dataAttr)) nodes.push(scope);
    nodes.push(...scope.querySelectorAll(selector));
    nodes.forEach((el) => el.setAttribute(target, t(el.getAttribute(dataAttr))));
  });
}

function applyDocumentLanguage() {
  document.documentElement.lang = currentLanguage;
  const title = t("app.title");
  if (title !== "app.title") document.title = title;
}

// Wechselt die Sprache. `persist: false` unterdrückt das Speichern – das
// braucht der Start, wenn die Sprache aus Profil/Storage nur übernommen
// wird. Das Speichern am Profil übernimmt js/language.js, damit i18n.js
// nicht von Supabase abhängt.
export function setLanguage(lang, { persist = true, force = false } = {}) {
  const next = normalize(lang);
  if (!next) return currentLanguage;
  if (next === currentLanguage && !force) return currentLanguage;
  currentLanguage = next;
  if (persist) writeStoredLanguage(next);
  applyDocumentLanguage();
  applyTranslations(document);
  listeners.forEach((callback) => {
    try {
      callback(currentLanguage);
    } catch (err) {
      // Ein Modul, das beim Neurendern stolpert, darf die anderen nicht
      // mitreissen – sonst bleibt die halbe Oberfläche in der alten Sprache.
      console.error("Sprachwechsel in einem Modul fehlgeschlagen:", err);
    }
  });
  return currentLanguage;
}

// Wird ganz früh aufgerufen (vor dem Login), damit auch der Login-Screen in
// der zuletzt gewählten Sprache erscheint.
export function initI18n() {
  const stored = readStoredLanguage();
  const browser = normalize(navigator.language);
  currentLanguage = stored ?? browser ?? FALLBACK_LANGUAGE;
  applyDocumentLanguage();
  applyTranslations(document);
  return currentLanguage;
}

// ---------------------------------------------------------------------
// Formatierung über Intl – nie von Hand
// ---------------------------------------------------------------------

// Zahl mit bis zu `maxDigits` Nachkommastellen in der aktiven Sprache.
export function formatDecimal(value, maxDigits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "–";
  return new Intl.NumberFormat(getLocale(), { maximumFractionDigits: maxDigits }).format(num);
}

export function formatCurrency(value, currency = "EUR") {
  const num = Number(value);
  if (!Number.isFinite(num)) return "–";
  return new Intl.NumberFormat(getLocale(), { style: "currency", currency }).format(num);
}

// Nimmt "2026-09-09" oder ein Date und gibt ein lesbares Datum zurück.
export function formatDate(value, options = { day: "2-digit", month: "2-digit", year: "numeric" }) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat(getLocale(), options).format(date);
}

export function formatDateTime(value) {
  return formatDate(value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Aufzählungen ("A, B und C" / "A, B and C").
export function formatList(items, type = "conjunction") {
  const list = Array.from(items ?? []).map((item) => String(item));
  if (!list.length) return "";
  try {
    return new Intl.ListFormat(getLocale(), { style: "long", type }).format(list);
  } catch {
    return list.join(", ");
  }
}

// Wochentagsname (0 = Sonntag), für Checklisten- und Eventpläne.
export function weekdayName(index, style = "long") {
  // 2024-01-07 ist ein Sonntag – als fester Anker für den Wochentag.
  const date = new Date(Date.UTC(2024, 0, 7 + (Number(index) % 7)));
  return new Intl.DateTimeFormat(getLocale(), { weekday: style, timeZone: "UTC" }).format(date);
}

export function monthName(index, style = "long") {
  const date = new Date(Date.UTC(2024, Number(index), 1));
  return new Intl.DateTimeFormat(getLocale(), { month: style, timeZone: "UTC" }).format(date);
}

// ---------------------------------------------------------------------
// Inhalte mit englischer Zweitfassung (Paket 33)
// ---------------------------------------------------------------------
//
// Wenige Inhaltsfelder haben eine englische Zweitfassung in der Datenbank
// (Rezept: method/glass/garnish/quickPitch, Checkliste: Vorlagenname und
// Punkte). Sie liegen als eigenes Feld neben dem deutschen, im JS mit dem
// Suffix "En" – `recipe.method` / `recipe.methodEn`.
//
// Regel dabei: auf Englisch wird nie stillschweigend Deutsch angezeigt.
// Fehlt die Zweitfassung, kommt der deutsche Text **mit** dem Zusatz
// "only available in German", damit am Tresen klar ist, dass hier nichts
// übersetzt wurde und nicht etwa der englische Text so lautet.

// Liefert { text, isGermanOnly, hasText } für ein Inhaltsfeld.
// `field` ist der deutsche Feldname, `enField` standardmässig derselbe
// Name mit angehängtem "En".
export function localizedContent(source, field, enField = `${field}En`) {
  const german = String(source?.[field] ?? "").trim();
  const english = String(source?.[enField] ?? "").trim();
  if (currentLanguage === FALLBACK_LANGUAGE) {
    return { text: german, isGermanOnly: false, hasText: german !== "" };
  }
  if (english !== "") return { text: english, isGermanOnly: false, hasText: true };
  return { text: german, isGermanOnly: german !== "", hasText: german !== "" };
}

// Der Hinweistext selbst – auf Deutsch wird er nie angezeigt, steht aber in
// beiden Sprachdateien, damit der Schlüsselsatz identisch bleibt.
export function germanOnlyNote() {
  return t("ui.nur_auf_deutsch_gepflegt");
}

// Reintext-Variante für Druck, Export und alles ohne HTML:
// "Kräftig shaken (only available in German)".
export function localizedText(source, field, enField) {
  const { text, isGermanOnly } = localizedContent(source, field, enField);
  return isGermanOnly ? `${text} (${germanOnlyNote()})` : text;
}
