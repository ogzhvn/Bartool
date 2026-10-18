import { switchTab } from "./tabs.js";
import { getAllRecipes } from "./recipeLibrary.js";
import {
  loadRecipes,
  loadProducts,
  loadShiftLogs,
  loadPreparations,
  loadEvents,
  loadChecklistTemplates,
  loadChecklistRuns,
  onRecipesChanged,
  onProductsChanged,
  onShiftLogsChanged,
  onPreparationsChanged,
  onEventsChanged,
  onChecklistTemplatesChanged,
  onChecklistRunsChanged,
  loadDishes,
  onDishesChanged,
} from "./storage.js";
import { getCurrentProfile, getCurrentUser, canSee, myDepartment, onAuthChange } from "./auth.js";
import { getFavorites, getRecent, onFavoritesChanged, zielModul } from "./favorites.js";
import { offeneAusLetzterSchicht, ablaufendeAnsaetze } from "./shiftLog.js";
import { aktiveVorlagen, laufStatus } from "./checklists.js";
import { focusRecipe } from "./recipes.js";
import { focusProduct } from "./products.js";
import { focusDish } from "./dishes.js";
import { getAllProducts } from "./productLibrary.js";
import { declarationLabel } from "./declarations.js";
import { escapeHtml } from "./utils.js";
import { t, onLanguageChanged, formatDate, getLocale } from "./i18n.js";
import { initTileGrid } from "./tileGrid.js";

const greetingEl = document.getElementById("home-greeting");
const statsEl = document.getElementById("home-stats");
const favWrapEl = document.getElementById("home-favorites-wrap");
const favListEl = document.getElementById("home-favorites");
const recentWrapEl = document.getElementById("home-recent-wrap");
const recentListEl = document.getElementById("home-recent");
const todayWrapEl = document.getElementById("home-today-wrap");
const todayListEl = document.getElementById("home-today");
const buffetWrapEl = document.getElementById("home-buffet-wrap");
const buffetDayEl = document.getElementById("home-buffet-day");
const buffetEl = document.getElementById("home-buffet");

function renderGreeting() {
  const profile = getCurrentProfile();
  const user = getCurrentUser();
  const name = profile?.display_name || user?.email?.split("@")[0] || "";
  greetingEl.textContent = name ? `${t("ui.willkommen_zurueck")} ${name}` : t("ui.willkommen_bei_bartool");
}

// Bis alle Start-Syncs durch sind (Event aus js/main.js), ist eine 0 noch
// kein Befund: sie steht für „noch nicht geladen“ und wird als „–“ gezeigt.
let syncing = true;

function statValue(count) {
  return syncing && count === 0 ? "–" : count;
}

function renderStats() {
  const stats = [
    [statValue(getAllRecipes().length), t("ui.rezepte_im_buch")],
    [statValue(loadRecipes().length), t("ui.davon_eigene")],
    [statValue(loadProducts().length), t("ui.produkte_im_katalog")],
  ];
  // Die Übergabe ist nicht jeder Abteilung zugeordnet (Paket 51).
  if (canSee("shift-log")) {
    const offen = offeneAusLetzterSchicht(loadShiftLogs()).length;
    const label = offen === 1 ? "ui.offener_punkt_aus_der_letzten_schicht" : "ui.offene_punkte_aus_der_letzten_schicht";
    stats.push([statValue(offen), t(label)]);
  }
  statsEl.innerHTML = stats
    .map(
      ([value, label]) => `
      <div class="stat-tile">
        <span class="stat-value">${value}</span>
        <span class="stat-label">${label}</span>
      </div>`
    )
    .join("");
}

// ---------------------------------------------------------------------
// "Heute anstehend"
// ---------------------------------------------------------------------
// Die Startseite zaehlte bisher nur Bestaende. Wer hinterm Tresen aufsperrt,
// will aber wissen, was zu tun ist – und nicht dafuer durch vier Tabs
// klicken muessen. Gesammelt wird deshalb aus allen Betriebsmodulen, was
// heute faellig ist; steht nichts an, verschwindet der ganze Block.
//
// Bewusst nicht enthalten: der Bestellvorschlag. Der braucht gepflegte
// Soll-Bestaende, und solange die fehlen, waere die Zeile jeden Tag gleich
// und damit blind.

const HEUTE_LIMIT = 6;

function heuteIso() {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

// Abgelaufen wiegt schwerer als "laeuft morgen ab": negative Tage zuerst.
function ansatzEintraege() {
  return ablaufendeAnsaetze(loadPreparations())
    .filter((e) => e.tage <= 1)
    .map((e) => ({
      tab: "preparations",
      icon: e.tage < 0 ? "ph-warning" : "ph-timer",
      dringend: e.tage < 0,
      text:
        e.tage < 0
          ? t("ui.heute_ansatz_abgelaufen", { label: e.prep.label })
          : e.tage === 0
            ? t("ui.heute_ansatz_laeuft_heute_ab", { label: e.prep.label })
            : t("ui.heute_ansatz_laeuft_morgen_ab", { label: e.prep.label }),
    }));
}

// Offen ist eine Vorlage, solange es fuer heute keinen abgeschlossenen Lauf
// gibt. Ein angefangener Lauf zaehlt mit Restzahl, damit sichtbar bleibt,
// wie viel noch fehlt.
function checklistEintraege() {
  const heute = heuteIso();
  const runs = loadChecklistRuns();
  return aktiveVorlagen(loadChecklistTemplates())
    .map((vorlage) => {
      const lauf = runs.find((r) => r.templateId === vorlage.id && r.runDate === heute);
      if (lauf?.finishedAt) return null;
      const offen = lauf ? laufStatus(vorlage, lauf).offen : (vorlage.items?.length ?? 0);
      return {
        tab: "checklists",
        icon: "ph-check-square-offset",
        dringend: false,
        text: lauf
          ? t("ui.heute_checkliste_angefangen", { name: vorlage.name, offen })
          : t("ui.heute_checkliste_offen", { name: vorlage.name }),
      };
    })
    .filter(Boolean);
}

function schichtEintraege() {
  const offen = offeneAusLetzterSchicht(loadShiftLogs());
  if (offen.length === 0) return [];
  return [
    {
      tab: "shift-log",
      icon: "ph-notebook",
      dringend: false,
      text: offen.length === 1
        ? t("ui.heute_offener_punkt_uebergabe")
        : t("ui.heute_offene_punkte_uebergabe", { anzahl: offen.length }),
    },
  ];
}

// Nur die naechsten sieben Tage: was weiter weg liegt, ist Planung und
// gehoert nicht auf die Tagesliste.
function eventEintraege() {
  const heute = heuteIso();
  const grenze = new Date();
  grenze.setDate(grenze.getDate() + 7);
  const grenzeIso = grenze.toISOString().slice(0, 10);
  return loadEvents()
    .filter((ev) => ev.eventDate && ev.eventDate >= heute && ev.eventDate <= grenzeIso)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .map((ev) => ({
      tab: "events",
      icon: "ph-calendar-star",
      dringend: ev.eventDate === heute,
      text:
        ev.eventDate === heute
          ? t("ui.heute_event_heute", { name: ev.name })
          : t("ui.heute_event_demnaechst", { name: ev.name, datum: formatDate(ev.eventDate) }),
    }));
}

function renderToday() {
  const eintraege = [
    ...ansatzEintraege(),
    ...checklistEintraege(),
    ...schichtEintraege(),
    ...eventEintraege(),
  ].filter((e) => canSee(e.tab)); // nur Module, die die Abteilung sieht (Paket 51)
  todayWrapEl.hidden = eintraege.length === 0;
  if (eintraege.length === 0) return;

  // Dringendes nach oben, sonst schneidet das Limit ausgerechnet den
  // abgelaufenen Ansatz oder das Event von heute ab. Innerhalb einer Stufe
  // bleibt die Reihenfolge der Quellen erhalten (stabile Sortierung).
  eintraege.sort((a, b) => Number(b.dringend) - Number(a.dringend));

  const sichtbar = eintraege.slice(0, HEUTE_LIMIT);
  const rest = eintraege.length - sichtbar.length;
  todayListEl.innerHTML =
    sichtbar
      .map(
        (e) => `
      <button type="button" class="today-item${e.dringend ? " today-item-urgent" : ""}" data-tab="${escapeHtml(e.tab)}">
        <i class="ph ${escapeHtml(e.icon)}" aria-hidden="true"></i>
        <span>${escapeHtml(e.text)}</span>
      </button>`
      )
      .join("") +
    (rest > 0 ? `<p class="hint">${escapeHtml(t("ui.heute_weitere", { anzahl: rest }))}</p>` : "");
}

// ---------------------------------------------------------------------
// "Buffet heute" (Paket 74, Teil 2)
// ---------------------------------------------------------------------
// Nur für die Abteilung WGR, und nur, wenn deren Modulfreigabe "dishes"
// enthält (Paket 69) – ein eigenes Recht braucht es dafür nicht.
//
// Das Buffetraster hat kein Wochentagsfeld: der Tag steht am Ende des
// description ("…, Montag."). "Buffet Basis" gilt täglich. Der Tag ist das
// Systemdatum in Europe/Berlin, ein Umschalter ist bewusst nicht vorgesehen.
//
// Wein nur zu Hauptgerichten und nur aus offenen Weinen (products.open_wine).
// Zuerst die gepflegte Weinbegleitung des Gerichts, sonst ein Vorschlag aus
// dem Katalogtext food_pairing – als "Vorschlag" gekennzeichnet, nie Vorgabe.
// Erfunden wird nichts: ohne offene Weine gibt es auch keinen Vorschlag.
//
// Gerichtsnamen, Kategorien und Weinnamen sind Nutzereingaben und gehen nur
// per textContent ins DOM (Regel 5).

const BUFFET_DEPARTMENT = "wgr";
const BUFFET_BASIS = "Buffet Basis";
const MAIN_CATEGORIES = ["Fisch", "Fleisch", "Vegan / Plant based", "Pasta", "Aus dem Ofen"];
const WINE_GROUPS = ["Wein", "Schaumwein"];
const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const WEEKDAY_RE = new RegExp(`,\\s(${WEEKDAYS.join("|")})\\.`);
const SUGGESTION_LIMIT = 2;

// Stichworte im Gericht (Name + Kategorie) → Stichworte im food_pairing des
// Weins. Ein Wein bekommt je getroffener Zeile einen Punkt. Im Gericht zählt
// nur der Wortanfang, sonst steckt "braten" in "gebraten" und "creme" in
// jedem Püree.
const PAIRING_TERMS = [
  ["fisch|lachs|scholle|heilbutt|dorsch|kabeljau|zander|forelle|barsch|seelachs|thunfisch|matjes|garnele|shrimp|prawn|meeresfr", /fisch|meeresfr/],
  ["rind|beef|steak|lamm|wild|hirsch|reh|ochs", /rote[mn]? fleisch|rind|lamm|wild|gegrillt/],
  ["schwein|kalb|kassler", /schwein|kalb|helle[mn]? fleisch/],
  ["hähnchen|huhn|geflügel|pute|ente|chicken|poulet", /geflügel|helle[mn]? fleisch|ente/],
  ["pasta|nudel|spaghetti|penne|tagliatelle|gnocchi|lasagne|ravioli|risotto", /pasta|risotto/],
  ["pilz|champignon|saitling|steinpilz", /pilz/],
  ["curry|asia|thai|wok|teriyaki|sushi", /asiat|curry/],
  ["käse|gratin|sahne|carbonara|gorgonzola|parmesan", /käse|sahne|cremig/],
  ["vegan|plant|gemüse|tofu|linsen|kichererbsen|aubergine|kürbis", /vegetar|gemüse|vegan/],
].map(([dishTerms, wineTerm]) => [new RegExp(`(?<![a-zäöüß])(${dishTerms})`), wineTerm]);

// Bei diesen Kategorien muss der Wein zur Hauptsache passen: ein Rotwein
// "zu Schmorgerichten" ist kein Vorschlag zum Fisch, nur weil die Beilage passt.
const REQUIRED_TERMS = {
  Fisch: /fisch|meeresfr/,
  Fleisch: /fleisch|rind|lamm|wild|geflügel|schwein|kalb|ente/,
  "Vegan / Plant based": /vegetar|gemüse|vegan/,
};

let buffetDay = "";

function berlinWeekday(date = new Date()) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "Europe/Berlin" }).format(date);
}

function berlinWeekdayLabel(date = new Date()) {
  return new Intl.DateTimeFormat(getLocale(), { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" }).format(date);
}

function showsBuffet() {
  return myDepartment() === BUFFET_DEPARTMENT && canSee("dishes");
}

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function buffetIcon(name) {
  const i = document.createElement("i");
  i.className = `ph ${name}`;
  i.setAttribute("aria-hidden", "true");
  return i;
}

function openWines() {
  return getAllProducts().filter((p) => p.openWine && WINE_GROUPS.includes(p.group));
}

function suggestWines(dish, wines) {
  const haystack = `${dish.name} ${dish.category}`.toLowerCase();
  const terms = PAIRING_TERMS.filter(([dishTerm]) => dishTerm.test(haystack)).map(([, wineTerm]) => wineTerm);
  if (terms.length === 0) return [];
  const required = REQUIRED_TERMS[dish.category];
  return wines
    .map((wine) => {
      const text = String(wine.foodPairing ?? "").toLowerCase();
      if (!text || (required && !required.test(text))) return { wine, score: 0 };
      return { wine, score: terms.filter((term) => term.test(text)).length };
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.wine.name.localeCompare(b.wine.name, getLocale()))
    .slice(0, SUGGESTION_LIMIT)
    .map((e) => ({ product: e.wine, note: "", suggestion: true }));
}

function winesFor(dish, wines) {
  const pinned = dish.winePairings
    .map((pairing) => ({ product: wines.find((w) => w.id === pairing?.product_id), note: pairing?.note ?? "", suggestion: false }))
    .filter((e) => e.product);
  return pinned.length > 0 ? pinned : suggestWines(dish, wines);
}

function wineLine(entry) {
  const li = makeEl("li", "buffet-wine");
  li.appendChild(buffetIcon("ph-wine"));
  const open = makeEl("button", "knowledge-back-link buffet-wine-name", entry.product.name);
  open.type = "button";
  open.dataset.product = entry.product.name;
  li.appendChild(open);
  if (entry.suggestion) li.appendChild(makeEl("span", "knowledge-badge buffet-suggestion", t("ui.buffet_vorschlag")));
  if (entry.note) li.appendChild(makeEl("span", "hint", entry.note));
  return li;
}

function allergenLine(dish) {
  const wrap = makeEl("div", "dish-chips");
  dish.allergens.forEach((key) => wrap.appendChild(makeEl("span", "dish-chip", declarationLabel(key, "allergen"))));
  // Ohne Prüfvermerk gilt keine Angabe – auch eine leere Liste heißt nicht "frei".
  if (!dish.allergensCheckedAt) {
    const badge = makeEl("span", "knowledge-badge knowledge-badge-draft");
    badge.append(buffetIcon("ph-warning"), makeEl("span", null, t("ui.gerichte_ungeprueft")));
    wrap.appendChild(badge);
  } else if (dish.allergens.length === 0) {
    wrap.appendChild(makeEl("span", "hint", t("ui.buffet_keine_der_14")));
  }
  return wrap;
}

function dishItem(dish, wines) {
  const li = makeEl("li", "buffet-dish");
  const name = makeEl("button", "knowledge-back-link buffet-dish-name", dish.name);
  name.type = "button";
  name.dataset.dish = dish.id;
  li.append(name, allergenLine(dish));
  if (wines && MAIN_CATEGORIES.includes(dish.category)) {
    const list = winesFor(dish, wines);
    if (list.length > 0) {
      const ul = makeEl("ul", "buffet-wines");
      list.forEach((entry) => ul.appendChild(wineLine(entry)));
      li.appendChild(ul);
    } else {
      li.appendChild(makeEl("p", "hint", t("ui.buffet_kein_passender_wein")));
    }
  }
  return li;
}

function dishGroup(category, dishes, wines) {
  const section = makeEl("section", "buffet-group");
  section.appendChild(makeEl("h4", null, category));
  const ul = makeEl("ul", "buffet-dishes");
  dishes.forEach((dish) => ul.appendChild(dishItem(dish, wines)));
  section.appendChild(ul);
  return section;
}

function renderBuffet() {
  buffetDay = berlinWeekday();
  const visible = showsBuffet();
  buffetWrapEl.hidden = !visible;
  if (!visible) return;
  buffetEl.textContent = "";
  buffetDayEl.textContent = berlinWeekdayLabel();

  const ours = loadDishes()
    .filter((d) => d.active && d.departments.includes(BUFFET_DEPARTMENT))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, getLocale()));
  const basis = ours.filter((d) => d.category === BUFFET_BASIS);
  const today = ours.filter((d) => d.category !== BUFFET_BASIS && WEEKDAY_RE.exec(d.description)?.[1] === buffetDay);

  if (today.length === 0 && basis.length === 0) {
    buffetEl.appendChild(makeEl("p", "empty-note", syncing ? "–" : t("ui.buffet_leer")));
    return;
  }

  const wines = openWines();
  if (wines.length === 0) buffetEl.appendChild(makeEl("p", "hint buffet-no-wine", t("ui.buffet_offene_weine_fehlen")));

  // Gruppen in der Reihenfolge des Rasters (sort), nicht alphabetisch.
  const groups = new Map();
  today.forEach((dish) => {
    if (!groups.has(dish.category)) groups.set(dish.category, []);
    groups.get(dish.category).push(dish);
  });
  groups.forEach((dishes, category) => buffetEl.appendChild(dishGroup(category, dishes, wines.length > 0 ? wines : null)));

  if (basis.length > 0) {
    const details = makeEl("details", "buffet-basis");
    details.appendChild(makeEl("summary", null, t("ui.buffet_basis_taeglich", { anzahl: basis.length })));
    const ul = makeEl("ul", "buffet-dishes");
    basis.forEach((dish) => ul.appendChild(dishItem(dish, null)));
    details.appendChild(ul);
    buffetEl.appendChild(details);
  }
}

// Läuft der Tab über Mitternacht offen, wechselt die Karte selbst den Tag.
function renderBuffetIfDayChanged() {
  if (berlinWeekday() !== buffetDay) renderBuffet();
}

// Springt zum Eintrag – in die Leseansicht, nicht ins Formular.
function oeffne(art, name) {
  if (art === "recipe") {
    switchTab("recipes");
    focusRecipe(name);
  } else {
    switchTab("products");
    focusProduct(name);
  }
}

function renderShortcutList(el, wrapEl, alleEintraege) {
  // Einträge, deren Modul die Abteilung nicht sieht, bleiben gespeichert,
  // werden aber nicht angeboten (Paket 51).
  const eintraege = alleEintraege.filter((e) => canSee(zielModul(e.art)));
  // Leere Blöcke ganz ausblenden statt einen leeren Kasten zu zeigen.
  wrapEl.hidden = eintraege.length === 0;
  if (eintraege.length === 0) return;
  el.innerHTML = eintraege
    .map(
      (e) => `
      <button type="button" class="shortcut-chip" data-art="${escapeHtml(e.art)}" data-name="${escapeHtml(e.name)}">
        <i class="ph ${e.art === "recipe" ? "ph-book-open" : "ph-wine"}" aria-hidden="true"></i>
        ${escapeHtml(e.name)}
      </button>`
    )
    .join("");
}

function renderShortcuts() {
  renderShortcutList(favListEl, favWrapEl, getFavorites());
  renderShortcutList(recentListEl, recentWrapEl, getRecent());
}

export function initHome() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    renderGreeting();
    renderStats();
    renderShortcuts();
    renderToday();
    renderBuffet();
  });

  renderGreeting();
  renderStats();
  renderShortcuts();
  renderToday();
  renderBuffet();
  window.addEventListener("bartool:sync-done", () => {
    syncing = false;
    renderStats();
    renderBuffet();
  });
  onDishesChanged(renderBuffet);
  onProductsChanged(renderBuffet);
  setInterval(renderBuffetIfDayChanged, 60000);
  onRecipesChanged(renderStats);
  onProductsChanged(renderStats);
  onShiftLogsChanged(() => {
    renderStats();
    renderToday();
  });
  onFavoritesChanged(renderShortcuts);
  // Profil und Abteilung können nach dem ersten Rendern noch einmal geladen
  // werden (Session-Ereignis von Supabase); dann neu filtern (Paket 51).
  onAuthChange(() => {
    renderGreeting();
    renderStats();
    renderShortcuts();
    renderToday();
    renderBuffet();
  });
  onPreparationsChanged(renderToday);
  onEventsChanged(renderToday);
  onChecklistTemplatesChanged(renderToday);
  onChecklistRunsChanged(renderToday);

  todayListEl.addEventListener("click", (e) => {
    const item = e.target.closest(".today-item");
    if (item) switchTab(item.dataset.tab);
  });

  buffetEl.addEventListener("click", (e) => {
    const dish = e.target.closest("[data-dish]");
    if (dish) {
      focusDish(dish.dataset.dish);
      return;
    }
    const wine = e.target.closest("[data-product]");
    if (wine) oeffne("product", wine.dataset.product);
  });

  [favListEl, recentListEl].forEach((el) =>
    el.addEventListener("click", (e) => {
      const chip = e.target.closest(".shortcut-chip");
      if (chip) oeffne(chip.dataset.art, chip.dataset.name);
    })
  );
  // Werkzeug-Kacheln: Reihenfolge und Auswahl pro Konto (js/tileGrid.js).
  initTileGrid({
    root: document.getElementById("home"),
    grid: document.getElementById("home-tool-grid"),
    prefKey: "homeTiles",
    onOpen: switchTab,
  });
}
