import { getAllRecipes } from "./recipeLibrary.js";
import { getAllProducts } from "./productLibrary.js";
import { focusRecipe } from "./recipes.js";
import { focusProduct } from "./products.js";
import { switchTab } from "./tabs.js";
import { closeMobileNav } from "./tabs.js";
import { escapeHtml } from "./utils.js";

// Globale Suche über Rezepte und Produkte in einem Fenster.
//
// Die beiden Bibliotheken haben je eine eigene Suche, aber wer hinterm Tresen
// schnell etwas nachschlägt, weiß oft gar nicht, ob der Begriff ein Rezept
// oder ein Produkt ist. Dieses Fenster sucht in beidem gleichzeitig und
// springt danach an die richtige Stelle.

const MAX_PRO_GRUPPE = 8;

const overlayEl = document.getElementById("quick-search-overlay");
const inputEl = document.getElementById("quick-search-input");
const resultsEl = document.getElementById("quick-search-results");
const openBtn = document.getElementById("quick-search-open");
const closeBtn = document.getElementById("quick-search-close");

// Aktuelle Treffer in Anzeigereihenfolge, damit Pfeiltasten und Klick
// dieselbe Liste benutzen.
let treffer = [];
let markiert = -1;

function passt(text, suchbegriff) {
  return String(text ?? "").toLowerCase().includes(suchbegriff);
}

// Je kleiner, desto weiter oben. Wer "negro" tippt, will "Negroni" sehen und
// nicht "Beery Negroni Sbagliato", nur weil das alphabetisch vorn steht.
function rang(name, suchbegriff) {
  const klein = String(name ?? "").toLowerCase();
  if (klein === suchbegriff) return 0; // exakt
  if (klein.startsWith(suchbegriff)) return 1; // fängt damit an
  if (klein.includes(suchbegriff)) return 2; // kommt im Namen vor
  return 3; // nur Kategorie passt
}

function sortiereNachRelevanz(eintraege, suchbegriff) {
  return eintraege.sort((a, b) => {
    const diff = rang(a.name, suchbegriff) - rang(b.name, suchbegriff);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, "de");
  });
}

function sucheTreffer(suchbegriff) {
  const rezepte = sortiereNachRelevanz(
    getAllRecipes()
      .filter((r) => passt(r.name, suchbegriff) || passt(r.category, suchbegriff))
      .map((r) => ({ art: "recipe", name: r.name, zusatz: r.category })),
    suchbegriff
  ).slice(0, MAX_PRO_GRUPPE);

  const produkte = sortiereNachRelevanz(
    getAllProducts()
      .filter(
        (p) =>
          passt(p.name, suchbegriff) || passt(p.category, suchbegriff) || passt(p.group, suchbegriff)
      )
      .map((p) => ({ art: "product", name: p.name, zusatz: p.group || p.category })),
    suchbegriff
  ).slice(0, MAX_PRO_GRUPPE);

  return { rezepte, produkte };
}

function zeileHtml(eintrag, index) {
  return `
    <button type="button" class="quick-search-item" role="option" data-index="${index}">
      <span class="quick-search-item-name">${escapeHtml(eintrag.name)}</span>
      ${eintrag.zusatz ? `<span class="quick-search-item-meta">${escapeHtml(eintrag.zusatz)}</span>` : ""}
    </button>
  `;
}

function markierungAnwenden() {
  resultsEl.querySelectorAll(".quick-search-item").forEach((el, i) => {
    el.classList.toggle("marked", i === markiert);
    if (i === markiert) el.scrollIntoView({ block: "nearest" });
  });
}

function render() {
  const suchbegriff = inputEl.value.trim().toLowerCase();
  if (suchbegriff.length < 2) {
    treffer = [];
    markiert = -1;
    resultsEl.innerHTML = `<p class="empty-note">Mindestens zwei Zeichen eingeben.</p>`;
    return;
  }

  const { rezepte, produkte } = sucheTreffer(suchbegriff);
  treffer = [...rezepte, ...produkte];

  if (treffer.length === 0) {
    markiert = -1;
    resultsEl.innerHTML = `<p class="empty-note">Nichts gefunden.</p>`;
    return;
  }

  let index = 0;
  let html = "";
  if (rezepte.length > 0) {
    html += `<h4 class="quick-search-group">Rezepte</h4>`;
    html += rezepte.map((e) => zeileHtml(e, index++)).join("");
  }
  if (produkte.length > 0) {
    html += `<h4 class="quick-search-group">Produkte</h4>`;
    html += produkte.map((e) => zeileHtml(e, index++)).join("");
  }
  resultsEl.innerHTML = html;

  markiert = 0;
  markierungAnwenden();
}

function oeffnen() {
  closeMobileNav();
  overlayEl.hidden = false;
  inputEl.value = "";
  render();
  inputEl.focus();
}

function schliessen() {
  overlayEl.hidden = true;
}

function auswaehlen(index) {
  const eintrag = treffer[index];
  if (!eintrag) return;
  schliessen();
  if (eintrag.art === "recipe") {
    switchTab("recipes");
    focusRecipe(eintrag.name);
  } else {
    switchTab("products");
    focusProduct(eintrag.name);
  }
}

export function initQuickSearch() {
  openBtn.addEventListener("click", oeffnen);
  closeBtn.addEventListener("click", schliessen);

  // Klick auf den abgedunkelten Hintergrund schließt, Klick im Fenster nicht.
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) schliessen();
  });

  inputEl.addEventListener("input", render);

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (treffer.length > 0) markiert = (markiert + 1) % treffer.length;
      markierungAnwenden();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (treffer.length > 0) markiert = (markiert - 1 + treffer.length) % treffer.length;
      markierungAnwenden();
    } else if (e.key === "Enter") {
      e.preventDefault();
      auswaehlen(markiert);
    }
  });

  resultsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".quick-search-item");
    if (btn) auswaehlen(Number(btn.dataset.index));
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      oeffnen();
    } else if (e.key === "Escape" && !overlayEl.hidden) {
      schliessen();
    }
  });
}
