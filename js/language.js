// Sprachumschalter im Header (DE/EN) und Speicherung der Wahl.
//
// Zwei Ablagen mit Absicht: `localStorage` gilt sofort und auch ohne Login
// (Login-Maske, Offline-Gerät), `profiles.language` gilt geräteübergreifend.
// Beim Anmelden gewinnt das Profil – wer am Tablet auf EN stellt, findet EN
// auch am Handy wieder. Das Schreiben läuft über den eng begrenzten RPC
// `set_my_language`, weil es auf `profiles` kein allgemeines Self-Update gibt.

import { getSupabaseClient } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";
import { AVAILABLE_LANGUAGES, getLanguage, setLanguage, onLanguageChanged } from "./i18n.js";

const LABELS = { de: "DE", en: "EN" };
const TITLES = { de: "Sprache: Deutsch", en: "Language: English" };

let switcherEl = null;

function markActive() {
  const active = getLanguage();
  switcherEl?.querySelectorAll("button[data-lang]").forEach((btn) => {
    const isActive = btn.dataset.lang === active;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
}

async function persistToProfile(lang) {
  if (!getCurrentUser()) return;
  try {
    const { error } = await getSupabaseClient().rpc("set_my_language", { new_language: lang });
    if (error) throw error;
  } catch (err) {
    // Kein Netz oder kein Recht: die Sprache gilt trotzdem lokal weiter.
    console.warn("Sprache konnte nicht am Profil gespeichert werden:", err);
  }
}

export function initLanguageSwitcher() {
  switcherEl = document.getElementById("language-switcher");
  if (!switcherEl) return;
  switcherEl.textContent = "";
  AVAILABLE_LANGUAGES.forEach((lang) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lang-btn";
    btn.dataset.lang = lang;
    btn.textContent = LABELS[lang] ?? lang.toUpperCase();
    btn.title = TITLES[lang] ?? lang;
    btn.addEventListener("click", () => {
      if (getLanguage() === lang) return;
      setLanguage(lang);
      persistToProfile(lang);
    });
    switcherEl.appendChild(btn);
  });
  onLanguageChanged(markActive);
  markActive();
}

// Wird nach dem Login aufgerufen: die am Profil hinterlegte Sprache gewinnt
// gegenüber der lokal gemerkten, damit die Wahl auf jedem Gerät gilt. Ist am
// Profil nichts gepflegt, bleibt es bei der lokalen Einstellung – und die
// wird einmal ans Profil nachgereicht.
export function applyProfileLanguage(profile) {
  const fromProfile = profile?.language;
  if (fromProfile && AVAILABLE_LANGUAGES.includes(fromProfile)) {
    setLanguage(fromProfile);
    return;
  }
  persistToProfile(getLanguage());
}
