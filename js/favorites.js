// Favoriten und zuletzt geöffnete Einträge.
//
// Bewusst nur auf dem Gerät gespeichert, nicht in der Datenbank: das
// Tresen-Tablet gehört der Bar, nicht einer Person. Was dort als Favorit
// markiert ist, soll für alle gelten, die daran arbeiten – und nicht mit
// dem Konto wandern, das sich gerade angemeldet hat.

const FAVORITES_KEY = "bartool:favorites";
const RECENT_KEY = "bartool:recent";
const MAX_RECENT = 8;

const CHANGED_EVENT = "bartool:favorites-changed";

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(key, liste) {
  try {
    localStorage.setItem(key, JSON.stringify(liste));
  } catch {
    // Kein Platz: Favoriten sind Komfort, kein Muss.
  }
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

// Einträge sind { art: "recipe" | "product", name: string }.
function schluessel(art, name) {
  return `${art}::${name}`;
}

export function getFavorites() {
  return read(FAVORITES_KEY);
}

export function isFavorite(art, name) {
  return read(FAVORITES_KEY).some((e) => schluessel(e.art, e.name) === schluessel(art, name));
}

export function toggleFavorite(art, name) {
  const liste = read(FAVORITES_KEY);
  const key = schluessel(art, name);
  const index = liste.findIndex((e) => schluessel(e.art, e.name) === key);
  if (index >= 0) liste.splice(index, 1);
  else liste.push({ art, name });
  write(FAVORITES_KEY, liste);
  return index < 0;
}

export function getRecent() {
  return read(RECENT_KEY);
}

// Neueste zuerst, Duplikate raus, Länge begrenzt.
export function pushRecent(art, name) {
  const key = schluessel(art, name);
  const liste = read(RECENT_KEY).filter((e) => schluessel(e.art, e.name) !== key);
  liste.unshift({ art, name });
  write(RECENT_KEY, liste.slice(0, MAX_RECENT));
}

export function onFavoritesChanged(callback) {
  window.addEventListener(CHANGED_EVENT, callback);
}
