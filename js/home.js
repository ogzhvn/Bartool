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
  loadUserPreferences,
  saveUserPreferences,
  onUserPreferencesChanged,
} from "./storage.js";
import { getCurrentProfile, getCurrentUser, canSee, onAuthChange } from "./auth.js";
import { getFavorites, getRecent, onFavoritesChanged, zielModul } from "./favorites.js";
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

// ---------------------------------------------------------------------
// Werkzeug-Kacheln anpassen
// ---------------------------------------------------------------------
// Jedes Konto ordnet seine Kacheln selbst (user_preferences.home_tiles,
// Schlüssel = data-tab). Ziehen startet nur nach einem Long-Press, damit ein
// Tap weiter den Tab öffnet und Wischen am Handy weiter scrollt. Ein Long-
// Press schaltet zugleich den Bearbeiten-Modus ein; darin öffnet ein Tap
// nichts, jede Kachel trägt ein Ausblenden-Symbol, und darunter stehen die
// ausgeblendeten Werkzeuge zum Wiederhinzufügen.
//
// Gesperrte Kacheln (Rechte/Abteilung) setzt js/main.js per hidden-Attribut.
// Ausgeblendet wird hier deshalb nur über die Klasse tool-card-off – so
// kann der Nutzer nie etwas einblenden, das ihm die Rechte wegnehmen.
//
// Umsortiert wird immer, indem die *anderen* Kacheln um die gezogene herum
// verschoben werden: die gezogene bleibt im DOM, behält Fokus und Pointer-
// Capture und verliert am Handy nicht den Touch-Strom.

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE_PX = 8;
const LIFT_SCALE = 1.04;
const FLIP_MS = 180;

const toolGridEl = document.getElementById("home-tool-grid");
const tilesEditBtn = document.getElementById("home-tiles-edit");
const tilesResetBtn = document.getElementById("home-tiles-reset");
const tilesDoneBtn = document.getElementById("home-tiles-done");
const tilesHintEl = document.getElementById("home-tiles-hint");
const tilesAddWrapEl = document.getElementById("home-tiles-add-wrap");
const tilesAddListEl = document.getElementById("home-tiles-add");
const tilesAddEmptyEl = document.getElementById("home-tiles-add-empty");
const tilesLiveEl = document.getElementById("home-tiles-live");

let defaultOrder = [];
let editing = false;
let press = null;
let suppressClick = false;
let applyPending = false;

function alleKacheln() {
  return [...toolGridEl.querySelectorAll(".tool-card")];
}

function kachelKey(card) {
  return card.dataset.tab;
}

function kachelName(card) {
  return card.querySelector(".tool-card-title")?.textContent.trim() || kachelKey(card);
}

function istAus(card) {
  return card.classList.contains("tool-card-off");
}

function sichtbareKacheln() {
  return alleKacheln().filter((card) => !card.hidden && !istAus(card));
}

function ankuendigen(text) {
  tilesLiveEl.textContent = text;
}

// Gespeicherter Stand, bereinigt: unbekannte Schlüssel fallen weg, Kacheln
// ohne Eintrag (neu dazugekommen) hängen sichtbar am Ende.
function gespeicherteKacheln() {
  const raw = loadUserPreferences().homeTiles ?? {};
  const bekannt = new Set(defaultOrder);
  const bereinigt = (liste) =>
    [...new Set(Array.isArray(liste) ? liste : [])].filter((key) => typeof key === "string" && bekannt.has(key));
  const order = bereinigt(raw.order);
  defaultOrder.forEach((key) => {
    if (!order.includes(key)) order.push(key);
  });
  return { order, hidden: new Set(bereinigt(raw.hidden)) };
}

function applyTiles() {
  if (press?.dragging) {
    applyPending = true;
    return;
  }
  const { order, hidden } = gespeicherteKacheln();
  const karten = alleKacheln();
  // Nur umhängen, wenn sich wirklich etwas geändert hat – appendChild nimmt
  // der Kachel sonst den Tastaturfokus.
  if (karten.map(kachelKey).join() !== order.join()) {
    const byKey = new Map(karten.map((card) => [kachelKey(card), card]));
    order.forEach((key) => toolGridEl.appendChild(byKey.get(key)));
  }
  karten.forEach((card) => card.classList.toggle("tool-card-off", hidden.has(kachelKey(card))));
  renderTilesEditUi();
}

function speichereKacheln() {
  const karten = alleKacheln();
  saveUserPreferences({
    homeTiles: {
      order: karten.map(kachelKey),
      hidden: karten.filter(istAus).map(kachelKey),
    },
  });
}

function renderTilesEditUi() {
  toolGridEl.classList.toggle("tool-grid-editing", editing);
  tilesEditBtn.closest(".tool-grid-head").classList.toggle("is-editing", editing);
  tilesEditBtn.hidden = editing;
  tilesResetBtn.hidden = !editing;
  tilesDoneBtn.hidden = !editing;
  tilesHintEl.hidden = !editing;
  tilesAddWrapEl.hidden = !editing;

  alleKacheln().forEach((card) => {
    const name = kachelName(card);
    if (editing) card.setAttribute("aria-label", t("ui.kachel_bearbeiten_label", { name }));
    else card.removeAttribute("aria-label");
    card.querySelector(".tool-card-remove").title = t("ui.kachel_entfernen", { name });
  });
  if (!editing) return;

  // Gesperrte Kacheln (hidden) tauchen hier nie auf.
  const aus = alleKacheln().filter((card) => !card.hidden && istAus(card));
  tilesAddListEl.replaceChildren(
    ...aus.map((card) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shortcut-chip";
      btn.dataset.tab = kachelKey(card);
      btn.setAttribute("aria-label", t("ui.werkzeug_hinzufuegen_label", { name: kachelName(card) }));
      const icon = document.createElement("i");
      icon.className = "ph ph-plus";
      icon.setAttribute("aria-hidden", "true");
      btn.append(icon, document.createTextNode(kachelName(card)));
      return btn;
    })
  );
  tilesAddEmptyEl.hidden = aus.length > 0;
}

function setEditing(on) {
  editing = on;
  renderTilesEditUi();
  if (on) ankuendigen(t("ui.kacheln_bearbeiten_an"));
}

// FLIP: Kacheln springen nicht an den neuen Platz, sondern gleiten von der
// alten (sichtbaren) Position dorthin.
function flip(cards, mutate) {
  const vorher = new Map(cards.map((card) => [card, card.getBoundingClientRect()]));
  mutate();
  cards.forEach((card) => {
    const a = vorher.get(card);
    card.style.transition = "none";
    card.style.transform = "";
    const b = card.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) {
      card.style.transition = "";
      return;
    }
    card.style.transform = `translate(${dx}px, ${dy}px)`;
    card.getBoundingClientRect();
    card.style.transition = `transform ${FLIP_MS}ms var(--ease-out)`;
    card.style.transform = "";
    card.addEventListener("transitionend", () => (card.style.transition = ""), { once: true });
  });
}

function positionText(card) {
  const sichtbar = sichtbareKacheln();
  return t("ui.kachel_position", {
    name: kachelName(card),
    pos: sichtbar.indexOf(card) + 1,
    anzahl: sichtbar.length,
  });
}

// Tastatur: eine Stelle nach vorn/hinten unter den sichtbaren Kacheln.
function verschiebe(card, richtung) {
  const sichtbar = sichtbareKacheln();
  const ziel = sichtbar[sichtbar.indexOf(card) + richtung];
  if (!ziel) return;
  flip([card, ziel], () => (richtung < 0 ? card.after(ziel) : card.before(ziel)));
  speichereKacheln();
  ankuendigen(positionText(card));
}

function ausblenden(card) {
  const sichtbar = sichtbareKacheln();
  const i = sichtbar.indexOf(card);
  const nachbar = sichtbar[i + 1] ?? sichtbar[i - 1];
  card.classList.add("tool-card-off");
  speichereKacheln();
  ankuendigen(t("ui.kachel_entfernt", { name: kachelName(card) }));
  if (nachbar) nachbar.focus();
  else tilesDoneBtn.focus();
}

function einblenden(key) {
  const card = alleKacheln().find((c) => kachelKey(c) === key);
  if (!card || card.hidden) return;
  card.classList.remove("tool-card-off");
  toolGridEl.appendChild(card);
  speichereKacheln();
  ankuendigen(t("ui.kachel_hinzugefuegt", { name: kachelName(card) }));
  card.focus();
}

// ---- Ziehen per Long-Press (Pointer Events) --------------------------

// Setzt die gezogene Kachel so, dass der Greifpunkt unter dem Finger bleibt.
// offsetLeft/-Top ignorieren Transforms, daher kein Zittern durch die
// eigene Verschiebung.
function positioniere() {
  const { card, x, y, grabX, grabY } = press;
  const grid = toolGridEl.getBoundingClientRect();
  const left = grid.left + toolGridEl.clientLeft + card.offsetLeft;
  const top = grid.top + toolGridEl.clientTop + card.offsetTop;
  card.style.transform = `translate(${x - grabX - left}px, ${y - grabY - top}px) scale(${LIFT_SCALE})`;
}

function umsortieren() {
  const { card, x, y } = press;
  const grid = toolGridEl.getBoundingClientRect();
  const px = x - grid.left - toolGridEl.clientLeft;
  const py = y - grid.top - toolGridEl.clientTop;
  const sichtbar = sichtbareKacheln();
  const ziel = sichtbar.find(
    (c) =>
      c !== card &&
      px >= c.offsetLeft &&
      px < c.offsetLeft + c.offsetWidth &&
      py >= c.offsetTop &&
      py < c.offsetTop + c.offsetHeight
  );
  if (!ziel) return;
  const alle = alleKacheln();
  const i = alle.indexOf(card);
  const j = alle.indexOf(ziel);
  flip(
    sichtbar.filter((c) => c !== card),
    () => (j > i ? card.before(...alle.slice(i + 1, j + 1)) : card.after(...alle.slice(j, i)))
  );
  positioniere();
}

function anheben() {
  const { card } = press;
  // Greifpunkt vor dem Umschalten messen: der Bearbeiten-Modus blendet den
  // Hinweis ein und verschiebt das Raster – die Kachel soll trotzdem unter
  // dem Finger bleiben.
  const rect = card.getBoundingClientRect();
  press.grabX = press.startX - rect.left;
  press.grabY = press.startY - rect.top;
  press.dragging = true;
  press.orderVorher = alleKacheln().map(kachelKey).join();
  suppressClick = true;
  if (!editing) setEditing(true);
  card.classList.add("tool-card-lifted");
  try {
    card.setPointerCapture(press.pointerId);
  } catch {
    // Pointer schon weg: das folgende pointerup/-cancel räumt auf.
  }
  try {
    navigator.vibrate?.(15);
  } catch {
    // Kein Vibrationsmotor oder gesperrt – Feedback ist optional.
  }
  positioniere();
}

function onTilePointerDown(e) {
  if (press) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const card = e.target.closest(".tool-card");
  if (!card) return;
  if (editing && e.target.closest(".tool-card-remove")) return;
  suppressClick = false;
  press = {
    card,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX,
    y: e.clientY,
    dragging: false,
    timer: setTimeout(anheben, LONG_PRESS_MS),
  };
}

function onTilePointerMove(e) {
  if (!press || e.pointerId !== press.pointerId) return;
  press.x = e.clientX;
  press.y = e.clientY;
  if (!press.dragging) {
    // Vor Ablauf der Haltezeit bewegt: das war Scrollen, kein Ziehen.
    if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) > MOVE_TOLERANCE_PX) {
      clearTimeout(press.timer);
      press = null;
    }
    return;
  }
  e.preventDefault();
  positioniere();
  umsortieren();
}

function onTilePointerEnd(e) {
  if (!press || e.pointerId !== press.pointerId) return;
  const { card, dragging, orderVorher, timer } = press;
  clearTimeout(timer);
  press = null;
  if (!dragging) return;
  // Einrasten: von der gezogenen Position in den Platz gleiten.
  flip([card], () => card.classList.remove("tool-card-lifted"));
  if (alleKacheln().map(kachelKey).join() !== orderVorher) {
    speichereKacheln();
    ankuendigen(positionText(card));
  }
  if (applyPending) {
    applyPending = false;
    applyTiles();
  }
}

function initTiles() {
  defaultOrder = alleKacheln().map(kachelKey);
  alleKacheln().forEach((card) => {
    const remove = document.createElement("span");
    remove.className = "tool-card-remove";
    remove.setAttribute("aria-hidden", "true");
    const icon = document.createElement("i");
    icon.className = "ph ph-x";
    remove.append(icon);
    card.append(remove);
  });

  toolGridEl.addEventListener("click", (e) => {
    const card = e.target.closest(".tool-card");
    if (!card) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (editing) {
      if (e.target.closest(".tool-card-remove")) ausblenden(card);
      return;
    }
    switchTab(card.dataset.tab);
  });

  toolGridEl.addEventListener("pointerdown", onTilePointerDown);
  window.addEventListener("pointermove", onTilePointerMove);
  window.addEventListener("pointerup", onTilePointerEnd);
  window.addEventListener("pointercancel", onTilePointerEnd);
  // Während des Ziehens darf die Seite nicht mitscrollen. touch-action lässt
  // sich mitten in der Geste nicht mehr ändern, daher touchmove abfangen.
  toolGridEl.addEventListener(
    "touchmove",
    (e) => {
      if (press?.dragging) e.preventDefault();
    },
    { passive: false }
  );
  // Long-Press öffnet sonst am Handy das Kontextmenü (Android) bzw. eine
  // Vorschau. Rechtsklick mit der Maus startet kein press und bleibt frei.
  toolGridEl.addEventListener("contextmenu", (e) => {
    if (press) e.preventDefault();
  });

  toolGridEl.addEventListener("keydown", (e) => {
    if (!editing || press) return;
    const card = e.target.closest(".tool-card");
    if (!card) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") verschiebe(card, -1);
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") verschiebe(card, 1);
    else if (e.key === "Delete" || e.key === "Backspace") ausblenden(card);
    else return;
    e.preventDefault();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editing && !press) setEditing(false);
  });

  tilesEditBtn.addEventListener("click", () => {
    setEditing(true);
    tilesDoneBtn.focus();
  });
  tilesDoneBtn.addEventListener("click", () => {
    setEditing(false);
    tilesEditBtn.focus();
  });
  tilesResetBtn.addEventListener("click", () => {
    saveUserPreferences({ homeTiles: {} });
    ankuendigen(t("ui.kacheln_zurueckgesetzt"));
  });
  tilesAddListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".shortcut-chip");
    if (btn) einblenden(btn.dataset.tab);
  });

  onUserPreferencesChanged(applyTiles);
  onLanguageChanged(renderTilesEditUi);
  onAuthChange(renderTilesEditUi);
  applyTiles();
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
  window.addEventListener("bartool:sync-done", () => {
    syncing = false;
    renderStats();
  });
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
  });
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
  initTiles();
}
