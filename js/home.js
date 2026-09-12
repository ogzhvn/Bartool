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
} from "./storage.js";
import { getCurrentProfile, getCurrentUser } from "./auth.js";
import { getFavorites, getRecent, onFavoritesChanged } from "./favorites.js";
import { offeneAusLetzterSchicht, ablaufendeAnsaetze } from "./shiftLog.js";
import { aktiveVorlagen, laufStatus } from "./checklists.js";
import { focusRecipe } from "./recipes.js";
import { focusProduct } from "./products.js";
import { escapeHtml } from "./utils.js";
import { t, onLanguageChanged, formatDate } from "./i18n.js";

const greetingEl = document.getElementById("home-greeting");
const statsEl = document.getElementById("home-stats");
const favWrapEl = document.getElementById("home-favorites-wrap");
const favListEl = document.getElementById("home-favorites");
const recentWrapEl = document.getElementById("home-recent-wrap");
const recentListEl = document.getElementById("home-recent");
const todayWrapEl = document.getElementById("home-today-wrap");
const todayListEl = document.getElementById("home-today");

function renderGreeting() {
  const profile = getCurrentProfile();
  const user = getCurrentUser();
  const name = profile?.display_name || user?.email?.split("@")[0] || "";
  greetingEl.textContent = name ? `${t("ui.willkommen_zurueck")} ${name}` : t("ui.willkommen_bei_bartool");
}

function renderStats() {
  const stats = [
    [getAllRecipes().length, t("ui.rezepte_im_buch")],
    [loadRecipes().length, t("ui.davon_eigene")],
    [loadProducts().length, t("ui.produkte_im_katalog")],
    [offeneAusLetzterSchicht(loadShiftLogs()).length, t("ui.offene_punkte_aus_der_letzten_schicht")],
  ];
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
      text: t("ui.heute_offene_punkte_uebergabe", { anzahl: offen.length }),
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
  ];
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

function renderShortcutList(el, wrapEl, eintraege) {
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
  });

  renderGreeting();
  renderStats();
  renderShortcuts();
  renderToday();
  onRecipesChanged(renderStats);
  onProductsChanged(renderStats);
  onShiftLogsChanged(() => {
    renderStats();
    renderToday();
  });
  onFavoritesChanged(renderShortcuts);
  onPreparationsChanged(renderToday);
  onEventsChanged(renderToday);
  onChecklistTemplatesChanged(renderToday);
  onChecklistRunsChanged(renderToday);

  todayListEl.addEventListener("click", (e) => {
    const item = e.target.closest(".today-item");
    if (item) switchTab(item.dataset.tab);
  });

  [favListEl, recentListEl].forEach((el) =>
    el.addEventListener("click", (e) => {
      const chip = e.target.closest(".shortcut-chip");
      if (chip) oeffne(chip.dataset.art, chip.dataset.name);
    })
  );
  document.querySelectorAll("#home .tool-card").forEach((card) => {
    card.addEventListener("click", () => switchTab(card.dataset.tab));
  });
}
