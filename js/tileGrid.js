import { loadUserPreferences, saveUserPreferences, onUserPreferencesChanged } from "./storage.js";
import { onAuthChange } from "./auth.js";
import { t, onLanguageChanged } from "./i18n.js";

// Anpassbares Kachelraster (Startseite, Admin-Übersicht).
//
// Jedes Konto ordnet seine Kacheln selbst (user_preferences, eine Spalte je
// Raster, Schlüssel = data-tab). Ziehen startet nur nach einem Long-Press,
// damit ein Tap weiter den Tab öffnet und Wischen am Handy weiter scrollt.
// Ein Long-Press schaltet zugleich den Bearbeiten-Modus ein; darin öffnet ein
// Tap nichts, jede Kachel trägt ein Ausblenden-Symbol, und darunter stehen
// die ausgeblendeten Kacheln zum Wiederhinzufügen.
//
// Gesperrte Kacheln (Rechte/Abteilung) tragen das hidden-Attribut – gesetzt
// von js/main.js bzw. vom Modul, das die Kacheln baut. Ausgeblendet wird hier
// deshalb nur über die Klasse tool-card-off – so kann der Nutzer nie etwas
// einblenden, das ihm die Rechte wegnehmen.
//
// Kacheln mit data-tile-default="hidden" sind Angebote: sie stehen anfangs
// nur unter „hinzufügen“. data-tile-group gruppiert diese Liste.
//
// Umsortiert wird immer, indem die *anderen* Kacheln um die gezogene herum
// verschoben werden: die gezogene bleibt im DOM, behält Fokus und Pointer-
// Capture und verliert am Handy nicht den Touch-Strom.
//
// Erwartetes Markup unterhalb von root: .tool-grid-head mit den Knöpfen
// [data-tiles-edit], [data-tiles-reset], [data-tiles-done]; [data-tiles-hint];
// das Raster (Option grid); [data-tiles-add-wrap] mit [data-tiles-add] und
// [data-tiles-add-empty]; [data-tiles-live] für Screenreader-Ansagen.

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE_PX = 8;
const LIFT_SCALE = 1.04;
const FLIP_MS = 180;

// Gruppen der Liste „hinzufügen“ in dieser Reihenfolge (Seitenleiste).
const GROUP_LABELS = {
  rechner: "ui.rechner",
  betrieb: "ui.betrieb",
  bibliothek: "ui.bibliothek",
  verwaltung: "ui.verwaltung",
};

// grid: das Raster mit den .tool-card-Buttons. prefKey: Feld in
// loadUserPreferences() ("homeTiles", "adminTiles"). onOpen(tab): Tap auf
// eine Kachel außerhalb des Bearbeiten-Modus.
export function initTileGrid({ root, grid, prefKey, onOpen }) {
  const headEl = root.querySelector(".tool-grid-head");
  const editBtn = root.querySelector("[data-tiles-edit]");
  const resetBtn = root.querySelector("[data-tiles-reset]");
  const doneBtn = root.querySelector("[data-tiles-done]");
  const hintEl = root.querySelector("[data-tiles-hint]");
  const addWrapEl = root.querySelector("[data-tiles-add-wrap]");
  const addListEl = root.querySelector("[data-tiles-add]");
  const addEmptyEl = root.querySelector("[data-tiles-add-empty]");
  const liveEl = root.querySelector("[data-tiles-live]");

  let defaultOrder = [];
  let defaultHidden = new Set();
  let editing = false;
  let press = null;
  let suppressClick = false;
  let applyPending = false;

  const alleKacheln = () => [...grid.querySelectorAll(".tool-card")];
  const kachelKey = (card) => card.dataset.tab;
  const kachelName = (card) => card.querySelector(".tool-card-title")?.textContent.trim() || kachelKey(card);
  const istAus = (card) => card.classList.contains("tool-card-off");
  const sichtbareKacheln = () => alleKacheln().filter((card) => !card.hidden && !istAus(card));
  const ankuendigen = (text) => (liveEl.textContent = text);

  // Gespeicherter Stand, bereinigt: unbekannte Schlüssel fallen weg, Kacheln
  // ohne Eintrag (neu dazugekommen) hängen am Ende – sichtbar, außer sie
  // sind als Angebot markiert.
  function gespeicherteKacheln() {
    const raw = loadUserPreferences()[prefKey] ?? {};
    const bekannt = new Set(defaultOrder);
    const bereinigt = (liste) =>
      [...new Set(Array.isArray(liste) ? liste : [])].filter((key) => typeof key === "string" && bekannt.has(key));
    const order = bereinigt(raw.order);
    const hidden = new Set(bereinigt(raw.hidden));
    defaultOrder.forEach((key) => {
      if (order.includes(key)) return;
      order.push(key);
      if (defaultHidden.has(key)) hidden.add(key);
    });
    return { order, hidden };
  }

  function apply() {
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
      order.forEach((key) => grid.appendChild(byKey.get(key)));
    }
    karten.forEach((card) => card.classList.toggle("tool-card-off", hidden.has(kachelKey(card))));
    renderEditUi();
  }

  function speichern() {
    const karten = alleKacheln();
    saveUserPreferences({
      [prefKey]: {
        order: karten.map(kachelKey),
        hidden: karten.filter(istAus).map(kachelKey),
      },
    });
  }

  function chip(card) {
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
  }

  function renderAddList() {
    // Gesperrte Kacheln (hidden) tauchen hier nie auf.
    const aus = alleKacheln().filter((card) => !card.hidden && istAus(card));
    const gruppen = new Map();
    aus.forEach((card) => {
      const gruppe = card.dataset.tileGroup ?? "";
      if (!gruppen.has(gruppe)) gruppen.set(gruppe, []);
      gruppen.get(gruppe).push(card);
    });
    const reihenfolge = Object.keys(GROUP_LABELS);
    const sortiert = [...gruppen.keys()].sort((a, b) => reihenfolge.indexOf(a) - reihenfolge.indexOf(b));
    const mitTitel = sortiert.length > 1 || (sortiert.length === 1 && sortiert[0] !== "");
    addListEl.replaceChildren(
      ...sortiert.flatMap((gruppe) => {
        const liste = document.createElement("div");
        liste.className = "shortcut-list";
        liste.append(...gruppen.get(gruppe).map(chip));
        if (!mitTitel || !GROUP_LABELS[gruppe]) return [liste];
        const titel = document.createElement("p");
        titel.className = "tool-add-group";
        titel.textContent = t(GROUP_LABELS[gruppe]);
        return [titel, liste];
      })
    );
    addEmptyEl.hidden = aus.length > 0;
  }

  function renderEditUi() {
    grid.classList.toggle("tool-grid-editing", editing);
    headEl.classList.toggle("is-editing", editing);
    editBtn.hidden = editing;
    resetBtn.hidden = !editing;
    doneBtn.hidden = !editing;
    hintEl.hidden = !editing;
    addWrapEl.hidden = !editing;

    alleKacheln().forEach((card) => {
      const name = kachelName(card);
      if (editing) card.setAttribute("aria-label", t("ui.kachel_bearbeiten_label", { name }));
      else card.removeAttribute("aria-label");
      const remove = card.querySelector(".tool-card-remove");
      if (remove) remove.title = t("ui.kachel_entfernen", { name });
    });
    if (editing) renderAddList();
  }

  function setEditing(on) {
    editing = on;
    renderEditUi();
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
    speichern();
    ankuendigen(positionText(card));
  }

  function ausblenden(card) {
    const sichtbar = sichtbareKacheln();
    const i = sichtbar.indexOf(card);
    const nachbar = sichtbar[i + 1] ?? sichtbar[i - 1];
    card.classList.add("tool-card-off");
    speichern();
    ankuendigen(t("ui.kachel_entfernt", { name: kachelName(card) }));
    if (nachbar) nachbar.focus();
    else doneBtn.focus();
  }

  function einblenden(key) {
    const card = alleKacheln().find((c) => kachelKey(c) === key);
    if (!card || card.hidden) return;
    card.classList.remove("tool-card-off");
    grid.appendChild(card);
    speichern();
    ankuendigen(t("ui.kachel_hinzugefuegt", { name: kachelName(card) }));
    card.focus();
  }

  // ---- Ziehen per Long-Press (Pointer Events) ------------------------

  // Setzt die gezogene Kachel so, dass der Greifpunkt unter dem Finger
  // bleibt. offsetLeft/-Top ignorieren Transforms, daher kein Zittern durch
  // die eigene Verschiebung (das Raster ist position: relative).
  function positioniere() {
    const { card, x, y, grabX, grabY } = press;
    const rect = grid.getBoundingClientRect();
    const left = rect.left + grid.clientLeft + card.offsetLeft;
    const top = rect.top + grid.clientTop + card.offsetTop;
    card.style.transform = `translate(${x - grabX - left}px, ${y - grabY - top}px) scale(${LIFT_SCALE})`;
  }

  function umsortieren() {
    const { card, x, y } = press;
    const rect = grid.getBoundingClientRect();
    const px = x - rect.left - grid.clientLeft;
    const py = y - rect.top - grid.clientTop;
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

  function onPointerDown(e) {
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

  function onPointerMove(e) {
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

  function onPointerEnd(e) {
    if (!press || e.pointerId !== press.pointerId) return;
    const { card, dragging, orderVorher, timer } = press;
    clearTimeout(timer);
    press = null;
    if (!dragging) return;
    // Einrasten: von der gezogenen Position in den Platz gleiten.
    flip([card], () => card.classList.remove("tool-card-lifted"));
    if (alleKacheln().map(kachelKey).join() !== orderVorher) {
      speichern();
      ankuendigen(positionText(card));
    }
    if (applyPending) {
      applyPending = false;
      apply();
    }
  }

  // Ausblenden-Symbol in jede Kachel; wer Kacheln später nachbaut, ruft
  // refresh() auf.
  function ausstatten() {
    alleKacheln().forEach((card) => {
      if (card.querySelector(".tool-card-remove")) return;
      const remove = document.createElement("span");
      remove.className = "tool-card-remove";
      remove.setAttribute("aria-hidden", "true");
      const icon = document.createElement("i");
      icon.className = "ph ph-x";
      remove.append(icon);
      card.append(remove);
    });
  }

  defaultOrder = alleKacheln().map(kachelKey);
  defaultHidden = new Set(alleKacheln().filter((c) => c.dataset.tileDefault === "hidden").map(kachelKey));
  ausstatten();

  grid.addEventListener("click", (e) => {
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
    onOpen(card.dataset.tab);
  });

  grid.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerEnd);
  window.addEventListener("pointercancel", onPointerEnd);
  // Während des Ziehens darf die Seite nicht mitscrollen. touch-action lässt
  // sich mitten in der Geste nicht mehr ändern, daher touchmove abfangen.
  grid.addEventListener(
    "touchmove",
    (e) => {
      if (press?.dragging) e.preventDefault();
    },
    { passive: false }
  );
  // Long-Press öffnet sonst am Handy das Kontextmenü (Android) bzw. eine
  // Vorschau. Rechtsklick mit der Maus startet kein press und bleibt frei.
  grid.addEventListener("contextmenu", (e) => {
    if (press) e.preventDefault();
  });

  grid.addEventListener("keydown", (e) => {
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

  editBtn.addEventListener("click", () => {
    setEditing(true);
    doneBtn.focus();
  });
  doneBtn.addEventListener("click", () => {
    setEditing(false);
    editBtn.focus();
  });
  resetBtn.addEventListener("click", () => {
    saveUserPreferences({ [prefKey]: {} });
    ankuendigen(t("ui.kacheln_zurueckgesetzt"));
  });
  addListEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".shortcut-chip");
    if (btn) einblenden(btn.dataset.tab);
  });

  onUserPreferencesChanged(apply);
  onLanguageChanged(renderEditUi);
  onAuthChange(renderEditUi);
  apply();

  return {
    refresh() {
      ausstatten();
      renderEditUi();
    },
  };
}
