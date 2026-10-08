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

// Kopf über der Liste: Zurück zu "Alle Themen" + Titel mit Trefferzahl.
export function renderTopicNav(container, title, count, onBack) {
  container.textContent = "";
  const label = t("ui.alle_themen");
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
