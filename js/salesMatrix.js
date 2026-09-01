import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { onProductsChanged, onRecipesChanged } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { groupProducts } from "./products.js";
import {
  FLAVOR_DIMENSIONS,
  FLAVOR_LABELS,
  hasFlavorProfile,
  compatibilityScore,
  deriveRecipeFlavorProfile,
  asFlavorProfileHolder,
} from "./compatibility.js";

const MAX_FLAVORS = 3;

const topButtons = document.querySelectorAll(".sm-top-btn");
const livePanelEl = document.getElementById("sm-live");
const prepPanelEl = document.getElementById("sm-prep");

const modeButtons = document.querySelectorAll(".sm-mode-btn");
const modePanels = {
  1: document.getElementById("sm-mode-1"),
  2: document.getElementById("sm-mode-2"),
  3: document.getElementById("sm-mode-3"),
  4: document.getElementById("sm-mode-4"),
};

const flavorChipsEl = document.getElementById("sm-flavor-chips");
const mode1SearchEl = document.getElementById("sm-mode1-search");
const mode1ResultsEl = document.getElementById("sm-mode1-results");

const mode2SearchEl = document.getElementById("sm-mode2-search");
const mode2ResultsEl = document.getElementById("sm-mode2-results");

const mode3SearchEl = document.getElementById("sm-mode3-search");
const mode3CardEl = document.getElementById("sm-mode3-card");

const mode4SearchEl = document.getElementById("sm-mode4-search");
const mode4ResultsEl = document.getElementById("sm-mode4-results");

const productOptionsEl = document.getElementById("sm-product-options");
const lookupOptionsEl = document.getElementById("sm-lookup-options");

const prepSearchEl = document.getElementById("sm-prep-search");
const prepPrintBtn = document.getElementById("sm-prep-print");
const prepContentEl = document.getElementById("sm-prep-content");

let selectedFlavors = [];

// ---------- Shared helpers ----------

function firstSentence(text) {
  if (!text) return "";
  const match = text.match(/^[^.!?]*[.!?]/);
  return (match ? match[0] : text).trim();
}

// Ein Produkt oder Rezept hat quickPitch (2.4) oft noch nicht gepflegt -
// solange greift ein Fallback auf die erste Aussage aus Story/Tasting
// Notes bzw. Geschichte, statt eine leere Zeile anzuzeigen.
function pitchLineFor(item) {
  if (item.quickPitch) return item.quickPitch;
  const fallback = item.story || item.tastingNotes || item.history || "";
  return firstSentence(fallback) || "(Keine Kurzbeschreibung hinterlegt)";
}

function formatEuro(n) {
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function unitLabel(priceUnit) {
  return priceUnit === "stueck" ? "Stück" : "Liter";
}

function lookupByName(name, products = getAllProducts(), recipes = getAllRecipes()) {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const product = products.find((p) => p.name.toLowerCase() === needle);
  if (product) return { type: "product", item: product };
  const recipe = recipes.find((r) => r.name.toLowerCase() === needle);
  if (recipe) return { type: "recipe", item: recipe };
  return null;
}

function pitchCard(type, item) {
  return `
    <div class="sm-pitch-card">
      <div class="sm-pitch-head">
        <span class="sm-pitch-name">${escapeHtml(item.name)}</span>
        <span class="sm-pitch-type">${type === "product" ? "Produkt" : "Cocktail"}</span>
      </div>
      <p class="sm-pitch-line">${escapeHtml(pitchLineFor(item))}</p>
    </div>
  `;
}

// ---------- Top-level toggle (Live / Vorbereitung) ----------

function setTop(top) {
  topButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.smTop === top));
  livePanelEl.classList.toggle("active", top === "live");
  prepPanelEl.classList.toggle("active", top === "prep");
  if (top === "prep") renderPrep();
}

// ---------- Live-Modus toggle (1-4) ----------

function setMode(mode) {
  modeButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.smMode === mode));
  Object.entries(modePanels).forEach(([id, panel]) => panel.classList.toggle("active", id === mode));
}

// ---------- Modus 1: Guest-Wunsch -> Empfehlung ----------

function renderFlavorChips() {
  flavorChipsEl.innerHTML = FLAVOR_DIMENSIONS.map(
    (dim) => `<button type="button" class="sm-flavor-chip" data-dim="${dim}">${escapeHtml(FLAVOR_LABELS[dim])}</button>`
  ).join("");
  flavorChipsEl.querySelectorAll(".sm-flavor-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dim = btn.dataset.dim;
      if (selectedFlavors.includes(dim)) {
        selectedFlavors = selectedFlavors.filter((d) => d !== dim);
      } else {
        if (selectedFlavors.length >= MAX_FLAVORS) {
          alert(`Maximal ${MAX_FLAVORS} Aromen gleichzeitig auswählen.`);
          return;
        }
        selectedFlavors.push(dim);
      }
      // Chips und getippter Name sind ein Entweder-oder (siehe Spec 4, Modus 1).
      mode1SearchEl.value = "";
      updateFlavorChipStyles();
      renderMode1Results();
    });
  });
}

function updateFlavorChipStyles() {
  flavorChipsEl.querySelectorAll(".sm-flavor-chip").forEach((btn) => {
    btn.classList.toggle("active", selectedFlavors.includes(btn.dataset.dim));
  });
}

function commitMode1Search() {
  if (mode1SearchEl.value.trim()) {
    selectedFlavors = [];
    updateFlavorChipStyles();
  }
  renderMode1Results();
}

function renderMode1Results() {
  const products = getAllProducts();
  const recipes = getAllRecipes();
  const typedName = mode1SearchEl.value.trim();

  let referenceHolder = null;
  let excludeName = null;

  if (typedName) {
    const found = lookupByName(typedName, products, recipes);
    if (!found) {
      mode1ResultsEl.innerHTML = `<p class="empty-note">Kein bekanntes Produkt oder Rezept mit diesem Namen gefunden.</p>`;
      return;
    }
    excludeName = found.item.name;
    if (found.type === "product") {
      if (!hasFlavorProfile(found.item)) {
        mode1ResultsEl.innerHTML = `<p class="empty-note">Für "${escapeHtml(found.item.name)}" ist noch kein Aromaprofil hinterlegt.</p>`;
        return;
      }
      referenceHolder = found.item;
    } else {
      const derived = deriveRecipeFlavorProfile(found.item, products);
      if (!derived) {
        mode1ResultsEl.innerHTML = `<p class="empty-note">Für "${escapeHtml(found.item.name)}" lässt sich noch kein Aromaprofil aus den Zutaten ableiten.</p>`;
        return;
      }
      referenceHolder = asFlavorProfileHolder(found.item.name, derived);
    }
  } else if (selectedFlavors.length > 0) {
    const profile = {};
    FLAVOR_DIMENSIONS.forEach((dim) => (profile[dim] = selectedFlavors.includes(dim) ? 10 : 0));
    referenceHolder = asFlavorProfileHolder("__wunsch__", profile);
  } else {
    mode1ResultsEl.innerHTML = `<p class="empty-note">Aromen antippen oder einen bekannten Drink eingeben.</p>`;
    return;
  }

  const candidates = [
    ...products.filter(hasFlavorProfile).filter((p) => p.name !== excludeName).map((p) => ({ type: "product", item: p, holder: p })),
    ...recipes
      .filter((r) => r.name !== excludeName)
      .map((r) => {
        const derived = deriveRecipeFlavorProfile(r, products);
        return derived ? { type: "recipe", item: r, holder: asFlavorProfileHolder(r.name, derived) } : null;
      })
      .filter(Boolean),
  ];

  const scored = candidates
    .map((c) => ({ ...c, score: compatibilityScore(referenceHolder, c.holder) }))
    .filter((c) => c.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  mode1ResultsEl.innerHTML =
    scored.length === 0
      ? `<p class="empty-note">Keine Treffer gefunden.</p>`
      : scored.map(({ type, item }) => pitchCard(type, item)).join("");
}

// ---------- Modus 2: Trade-up-Leiter ----------

function renderMode2Results() {
  const name = mode2SearchEl.value.trim();
  if (!name) {
    mode2ResultsEl.innerHTML = `<p class="empty-note">Wähle oben ein Produkt aus.</p>`;
    return;
  }
  const products = getAllProducts();
  const current = products.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!current) {
    mode2ResultsEl.innerHTML = `<p class="empty-note">Kein Produkt mit diesem Namen gefunden.</p>`;
    return;
  }
  const bucket = products.filter(
    (p) => p.group === current.group && (p.subGroup || "") === (current.subGroup || "") && p.priceValue > 0
  );
  if (bucket.length < 2) {
    mode2ResultsEl.innerHTML = `<p class="empty-note">Keine Preisdaten für Trade-up in dieser Kategorie hinterlegt.</p>`;
    return;
  }
  const baseline = current.priceValue || 0;
  const higher = bucket
    .filter((p) => p.name !== current.name && p.priceValue > baseline)
    .sort((a, b) => a.priceValue - b.priceValue)
    .slice(0, 2);
  if (higher.length === 0) {
    mode2ResultsEl.innerHTML = `<p class="empty-note">${escapeHtml(current.name)} ist bereits die teuerste Option in dieser Kategorie.</p>`;
    return;
  }
  mode2ResultsEl.innerHTML = higher
    .map((p) => {
      const delta = p.priceValue - baseline;
      return `
        <div class="sm-pitch-card">
          <div class="sm-pitch-head">
            <span class="sm-pitch-name">${escapeHtml(p.name)}</span>
            <span class="sm-pitch-price">+${formatEuro(delta)} / ${unitLabel(p.priceUnit)}</span>
          </div>
          <p class="sm-pitch-line">${escapeHtml(pitchLineFor(p))}</p>
        </div>
      `;
    })
    .join("");
}

// ---------- Modus 3: Verkaufs-Spickzettel ----------

function renderMode3Card() {
  const name = mode3SearchEl.value.trim();
  if (!name) {
    mode3CardEl.innerHTML = "";
    return;
  }
  const found = lookupByName(name);
  if (!found) {
    mode3CardEl.innerHTML = `<p class="empty-note">Kein Produkt oder Rezept mit diesem Namen gefunden.</p>`;
    return;
  }
  const { type, item } = found;
  const bullets = [pitchLineFor(item)];
  if (type === "product") {
    if (item.service) bullets.push(item.service);
    if (item.abv) bullets.push(item.abv);
  } else {
    const glassGarnish = [item.glass, item.garnish].filter(Boolean).join(" · ");
    if (glassGarnish) bullets.push(glassGarnish);
    if (item.method) bullets.push(item.method);
  }
  mode3CardEl.innerHTML = `
    <div class="sm-cheat-card">
      <div class="sm-cheat-title">${escapeHtml(item.name)}</div>
      <ul class="sm-cheat-bullets">
        ${bullets
          .slice(0, 3)
          .map((b) => `<li>${escapeHtml(b)}</li>`)
          .join("")}
      </ul>
    </div>
  `;
}

// ---------- Modus 4: Cross-Sell ----------

function renderMode4Results() {
  const name = mode4SearchEl.value.trim();
  if (!name) {
    mode4ResultsEl.innerHTML = `<p class="empty-note">Wähle oben, was der Gast bestellt hat.</p>`;
    return;
  }
  const products = getAllProducts();
  const recipes = getAllRecipes();
  const found = lookupByName(name, products, recipes);
  if (!found) {
    mode4ResultsEl.innerHTML = `<p class="empty-note">Kein Produkt oder Rezept mit diesem Namen gefunden.</p>`;
    return;
  }
  const { type, item } = found;

  // (a) manuell gepflegtes "Passt gut zu" ist immer genauer als jede Heuristik.
  if (item.pairsWith && item.pairsWith.length > 0) {
    const entries = item.pairsWith.map((n) => lookupByName(n, products, recipes)).filter(Boolean);
    mode4ResultsEl.innerHTML =
      entries.length > 0
        ? entries.map(({ type: t, item: i }) => pitchCard(t, i)).join("")
        : `<p class="empty-note">Die hinterlegten "Passt gut zu"-Namen wurden nicht gefunden.</p>`;
    return;
  }

  // (b) algorithmischer Fallback: compatibilityScore + andere Kategorie als das Ausgangsprodukt.
  let holder;
  if (type === "product") {
    if (!hasFlavorProfile(item)) {
      mode4ResultsEl.innerHTML = `<p class="empty-note">Für "${escapeHtml(item.name)}" ist weder "Passt gut zu" noch ein Aromaprofil hinterlegt.</p>`;
      return;
    }
    holder = item;
  } else {
    const derived = deriveRecipeFlavorProfile(item, products);
    if (!derived) {
      mode4ResultsEl.innerHTML = `<p class="empty-note">Für "${escapeHtml(item.name)}" ist weder "Passt gut zu" noch ein ableitbares Aromaprofil hinterlegt.</p>`;
      return;
    }
    holder = asFlavorProfileHolder(item.name, derived);
  }

  const candidates = products
    .filter(hasFlavorProfile)
    .filter((p) => p.name !== item.name && (type !== "product" || p.group !== item.group));
  const scored = candidates
    .map((p) => ({ item: p, score: compatibilityScore(holder, p) }))
    .filter((c) => c.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  mode4ResultsEl.innerHTML =
    scored.length === 0
      ? `<p class="empty-note">Keine passenden Vorschläge gefunden.</p>`
      : scored.map(({ item: p }) => pitchCard("product", p)).join("");
}

// ---------- Vorbereitung / Schicht-Briefing ----------

function renderPrep() {
  const query = prepSearchEl.value.trim().toLowerCase();
  const products = getAllProducts();
  const recipes = getAllRecipes();

  const filteredProducts = products.filter(
    (p) => !query || p.name.toLowerCase().includes(query) || (p.category ?? "").toLowerCase().includes(query)
  );

  const groupsHtml = groupProducts(filteredProducts)
    .map(({ groupName, subgroups }) => {
      const subHtml = subgroups
        .map(([subGroupName, items]) => {
          const priced = items.filter((p) => p.priceValue > 0).sort((a, b) => a.priceValue - b.priceValue);
          const ordered = priced.length > 0 ? priced : [...items].sort((a, b) => a.name.localeCompare(b.name, "de"));
          const rows = ordered
            .map(
              (p) => `
              <div class="sm-prep-row">
                <span class="sm-prep-row-name">${escapeHtml(p.name)}</span>
                ${p.priceValue > 0 ? `<span class="sm-prep-row-price">${formatEuro(p.priceValue)} / ${unitLabel(p.priceUnit)}</span>` : ""}
                <span class="sm-prep-row-pitch">${escapeHtml(pitchLineFor(p))}</span>
              </div>
            `
            )
            .join("");
          return `
            <div class="sm-prep-subgroup">
              ${subGroupName ? `<h4 class="product-subgroup-header">${escapeHtml(subGroupName)}</h4>` : ""}
              ${rows}
            </div>
          `;
        })
        .join("");
      return `
        <div class="sm-prep-group">
          <h3 class="product-group-header">${escapeHtml(groupName)}</h3>
          ${subHtml}
        </div>
      `;
    })
    .join("");

  const filteredRecipes = recipes
    .filter((r) => r.quickPitch || (r.pairsWith && r.pairsWith.length > 0))
    .filter((r) => !query || r.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const recipesHtml =
    filteredRecipes.length === 0
      ? ""
      : `
      <div class="sm-prep-group">
        <h3 class="product-group-header">Cocktails</h3>
        ${filteredRecipes
          .map(
            (r) => `
            <div class="sm-prep-row">
              <span class="sm-prep-row-name">${escapeHtml(r.name)}</span>
              <span class="sm-prep-row-pitch">
                ${escapeHtml(pitchLineFor(r))}
                ${r.pairsWith?.length ? ` — Passt gut zu: ${escapeHtml(r.pairsWith.join(", "))}` : ""}
              </span>
            </div>
          `
          )
          .join("")}
      </div>
    `;

  const combined = groupsHtml + recipesHtml;
  prepContentEl.innerHTML = combined || `<p class="empty-note">Keine Treffer.</p>`;
}

// ---------- Init ----------

function populateOptions() {
  const products = getAllProducts();
  const recipes = getAllRecipes();
  productOptionsEl.innerHTML = products
    .map((p) => p.name)
    .sort((a, b) => a.localeCompare(b, "de"))
    .map((n) => `<option value="${escapeHtml(n)}"></option>`)
    .join("");
  const names = [...new Set([...products.map((p) => p.name), ...recipes.map((r) => r.name)])].sort((a, b) =>
    a.localeCompare(b, "de")
  );
  lookupOptionsEl.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
}

export function initSalesMatrix() {
  renderFlavorChips();
  populateOptions();

  topButtons.forEach((btn) => btn.addEventListener("click", () => setTop(btn.dataset.smTop)));
  modeButtons.forEach((btn) => btn.addEventListener("click", () => setMode(btn.dataset.smMode)));

  mode1SearchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitMode1Search();
    }
  });
  mode1SearchEl.addEventListener("change", commitMode1Search);

  mode2SearchEl.addEventListener("change", renderMode2Results);
  mode2SearchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      renderMode2Results();
    }
  });

  mode3SearchEl.addEventListener("change", renderMode3Card);
  mode3SearchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      renderMode3Card();
    }
  });

  mode4SearchEl.addEventListener("change", renderMode4Results);
  mode4SearchEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      renderMode4Results();
    }
  });

  prepSearchEl.addEventListener("input", renderPrep);
  prepPrintBtn.addEventListener("click", () => window.print());

  onProductsChanged(() => {
    populateOptions();
    renderMode1Results();
    renderMode2Results();
    renderMode3Card();
    renderMode4Results();
    if (prepPanelEl.classList.contains("active")) renderPrep();
  });
  onRecipesChanged(() => {
    populateOptions();
    renderMode1Results();
    renderMode4Results();
    if (prepPanelEl.classList.contains("active")) renderPrep();
  });

  renderMode1Results();
}
