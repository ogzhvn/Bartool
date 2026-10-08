import { t } from "./i18n.js";

// Themenkacheln für Rezepte und Produkte – gleiche Optik wie die Wissen-Übersicht
// (Klassen .knowledge-topics / .knowledge-topic / .knowledge-nav, siehe styles.css).
// Alle Texte kommen über textContent, nie als HTML.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// tiles: [{ key, name, count }]; onPick(key) beim Klick.
export function renderTopicTiles(container, tiles, onPick, emptyText) {
  container.textContent = "";
  tiles.forEach(({ key, name, count }) => {
    const tile = el("button", "knowledge-topic");
    tile.type = "button";
    tile.append(el("span", "knowledge-topic-name", name), el("span", "knowledge-topic-count", count));
    tile.addEventListener("click", () => onPick(key));
    container.appendChild(tile);
  });
  if (tiles.length === 0 && emptyText) container.appendChild(el("p", "empty-note", emptyText));
}

// Kopf über der Liste: Zurück zu "Alle Themen" (oder `backLabel`) + Titel mit Trefferzahl.
export function renderTopicNav(container, title, count, onBack, backLabel) {
  container.textContent = "";
  const label = backLabel ?? t("ui.alle_themen");
  const back = el("button", "knowledge-back-link");
  back.type = "button";
  back.setAttribute("aria-label", label);
  const icon = el("i", "ph ph-arrow-left");
  icon.setAttribute("aria-hidden", "true");
  back.append(icon, el("span", null, label));
  back.addEventListener("click", onBack);
  const heading = el("h3", "knowledge-nav-title", title);
  heading.appendChild(el("span", "knowledge-nav-count", ` · ${count}`));
  container.append(back, heading);
}

// Mehrfachauswahl wie in Wissen: Leiste mit "Auswählen"; bei aktiver Auswahl
// "Alle auswählen", Zähler, die übergebenen Aktionen und "Fertig". Die Leiste
// hält die Auswahl (Namen); die Liste fragt `selecting` ab und zeigt dann
// Checkboxen. actions: [{ key, icon, label, run(names) }]; onChange() rendert
// die Liste neu, wenn sich der Auswahlmodus ändert.
export function createBulkBar(container, { actions, onChange }) {
  const bar = { selecting: false, selected: new Set(), shown: [] };

  function button(action, icon, label, disabled = false) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "btn-secondary";
    node.dataset.action = action;
    node.disabled = disabled;
    const i = el("i", `ph ${icon}`);
    i.setAttribute("aria-hidden", "true");
    node.append(i, el("span", null, label));
    return node;
  }

  bar.render = (shown) => {
    bar.shown = shown;
    container.textContent = "";
    container.hidden = shown.length === 0;
    if (shown.length === 0) return;
    if (!bar.selecting) {
      container.appendChild(button("select", "ph-check-square", t("ui.wissen_auswaehlen")));
      return;
    }
    const shownSet = new Set(shown);
    [...bar.selected].forEach((name) => !shownSet.has(name) && bar.selected.delete(name));
    const all = bar.selected.size === shown.length;
    container.append(
      button("select-all", all ? "ph-square" : "ph-check-square", all ? t("ui.wissen_alle_abwaehlen") : t("ui.wissen_alle_auswaehlen")),
      el("span", "knowledge-bulk-count", t("ui.wissen_n_ausgewaehlt", { n: bar.selected.size }))
    );
    actions.forEach((a) => container.appendChild(button(a.key, a.icon, a.label(), bar.selected.size === 0)));
    container.appendChild(button("done", "ph-x", t("ui.wissen_auswahl_beenden")));
  };

  bar.refresh = () => bar.render(bar.shown);

  bar.end = () => {
    bar.selecting = false;
    bar.selected.clear();
  };

  container.addEventListener("click", (e) => {
    const target = e.target.closest("button[data-action]");
    if (!target || target.disabled) return;
    const action = target.dataset.action;
    if (action === "select") bar.selecting = true;
    else if (action === "done") bar.end();
    else if (action === "select-all") {
      if (bar.selected.size === bar.shown.length) bar.selected.clear();
      else bar.shown.forEach((name) => bar.selected.add(name));
    } else {
      actions.find((a) => a.key === action)?.run([...bar.selected]);
      return;
    }
    onChange();
  });

  return bar;
}
