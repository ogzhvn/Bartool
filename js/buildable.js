import { loadInventoryCounts, loadInventoryItems, onInventoryCountsChanged } from "./storage.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { getAllProducts } from "./productLibrary.js";
import { productForIngredient } from "./costing.js";
import { onProductsChanged, onRecipesChanged } from "./storage.js";
import { switchTab } from "./tabs.js";
import { focusRecipe } from "./recipes.js";
import { escapeHtml } from "./utils.js";

// "Was kann ich bauen?" – Zählstand aus der Inventur gegen das Rezeptbuch.
//
// Reine Auswertung, kein eigenes Schema: Grundlage ist eine vorhandene
// Zählung. Die Unterscheidung aus der Inventur bleibt erhalten und ist hier
// entscheidend:
//   quantity === null  -> nicht gezählt (unbekannt, gilt als vorhanden)
//   quantity === 0     -> gezählt und leer  -> Zutat fehlt
// Zutaten ohne Produkttreffer werden nicht stillschweigend als vorhanden
// gewertet, sondern eigens ausgewiesen – das ist die Datenpflege-Liste.

const panelEl = document.getElementById("buildable");
const selectEl = document.getElementById("build-count-select");
const selectWrapEl = document.getElementById("build-count-wrap");
const reloadBtn = document.getElementById("build-reload");
const searchEl = document.getElementById("build-search");
const statusEl = document.getElementById("build-status");
const resultEl = document.getElementById("build-result");

// Zählung, die gerade ausgewertet wird, und ihr Stand
// ({ produktname: { quantity, unit } }).
let gewaehlteId = null;
let stand = null;
let ladeVorgang = 0;

function setStatus(text) {
  statusEl.hidden = !text;
  statusEl.textContent = text ?? "";
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  return `${d}.${m}.${y}`;
}

// ---------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------

// Bewertet ein Rezept gegen den Zählstand.
function bewerteRezept(recipe, produkte, zaehlstand) {
  const fehlend = [];
  const unklar = [];
  const ungezaehlt = [];

  (recipe.ingredients ?? []).forEach((ing) => {
    const name = String(ing?.name ?? "").trim();
    if (!name) return;
    const produkt = productForIngredient(name, produkte);
    if (!produkt) {
      unklar.push(name);
      return;
    }
    const menge = zaehlstand[produkt.name]?.quantity;
    if (menge === null || menge === undefined || menge === "") {
      ungezaehlt.push(produkt.name);
      return;
    }
    if (Number(menge) <= 0) fehlend.push(produkt.name);
  });

  return { name: recipe.name, fehlend, unklar, ungezaehlt };
}

export function auswertenGegenStand(zaehlstand) {
  const produkte = getAllProducts();
  const bewertet = getAllRecipes().map((r) => bewerteRezept(r, produkte, zaehlstand));

  // Rezepte mit nicht zuordenbaren Zutaten landen bewusst nicht bei
  // "machbar": was nicht zugeordnet ist, ist nicht geprüft.
  const machbar = bewertet.filter((b) => b.unklar.length === 0 && b.fehlend.length === 0);
  const eineFehlt = bewertet.filter((b) => b.unklar.length === 0 && b.fehlend.length === 1);
  const mehrereFehlen = bewertet.filter((b) => b.unklar.length === 0 && b.fehlend.length > 1);
  const unklareRezepte = bewertet.filter((b) => b.unklar.length > 0);

  // Nicht zuordenbare Zutaten nach Zutatenname gebündelt – so ist auf einen
  // Blick zu sehen, welcher Katalogeintrag oder welche Schreibweise fehlt.
  const nachZutat = new Map();
  unklareRezepte.forEach((b) => {
    new Set(b.unklar).forEach((zutat) => {
      if (!nachZutat.has(zutat)) nachZutat.set(zutat, []);
      nachZutat.get(zutat).push(b.name);
    });
  });

  const ungezaehlteProdukte = new Set();
  bewertet.forEach((b) => b.ungezaehlt.forEach((p) => ungezaehlteProdukte.add(p)));

  return {
    machbar: machbar.sort((a, b) => a.name.localeCompare(b.name, "de")),
    eineFehlt: eineFehlt.sort((a, b) => a.name.localeCompare(b.name, "de")),
    mehrereFehlen,
    unklareRezepte: unklareRezepte.sort((a, b) => a.name.localeCompare(b.name, "de")),
    unklareZutaten: [...nachZutat.entries()]
      .map(([zutat, rezepte]) => ({ zutat, rezepte: rezepte.sort((a, b) => a.localeCompare(b, "de")) }))
      .sort((a, b) => b.rezepte.length - a.rezepte.length || a.zutat.localeCompare(b.zutat, "de")),
    ungezaehlteProdukte: [...ungezaehlteProdukte],
    rezepteGesamt: bewertet.length,
  };
}

// ---------------------------------------------------------------------
// Anzeige
// ---------------------------------------------------------------------

function rezeptChips(eintraege) {
  return eintraege
    .map(
      (b) => `
      <button type="button" class="shortcut-chip build-recipe" data-name="${escapeHtml(b.name)}">
        <i class="ph ph-book-open" aria-hidden="true"></i>
        ${escapeHtml(b.name)}
      </button>`
    )
    .join("");
}

function renderCountSelect() {
  const zaehlungen = loadInventoryCounts();
  const vorhanden = zaehlungen.some((z) => z.id === gewaehlteId);
  if (!vorhanden) gewaehlteId = zaehlungen[0]?.id ?? null;
  selectWrapEl.hidden = zaehlungen.length === 0;
  selectEl.innerHTML = zaehlungen
    .map(
      (z) =>
        `<option value="${escapeHtml(z.id)}"${z.id === gewaehlteId ? " selected" : ""}>${escapeHtml(
          z.title || "Inventur"
        )} · ${formatDate(z.countedOn)} · ${z.status === "abgeschlossen" ? "abgeschlossen" : "offen"}</option>`
    )
    .join("");
}

function render() {
  const suche = searchEl.value.trim().toLowerCase();
  const passt = (name) => !suche || name.toLowerCase().includes(suche);

  if (!stand) {
    resultEl.innerHTML =
      loadInventoryCounts().length === 0
        ? `<p class="empty-note">Es gibt noch keine Inventur. Lege im Tab „Inventur" eine Zählung an und zähle die Produkte – danach steht hier, was sich daraus bauen lässt.</p>`
        : `<p class="empty-note">Noch kein Zählstand geladen.</p>`;
    return;
  }

  const a = auswertenGegenStand(stand);

  const gezaehltePositionen = Object.values(stand).filter(
    (e) => e && e.quantity !== null && e.quantity !== undefined && e.quantity !== ""
  ).length;

  if (gezaehltePositionen === 0) {
    resultEl.innerHTML = `<p class="empty-note">In dieser Zählung ist noch nichts erfasst. Solange nichts gezählt ist, lässt sich nicht sagen, was fehlt.</p>`;
    return;
  }

  const machbar = a.machbar.filter((b) => passt(b.name));
  const eineFehlt = a.eineFehlt.filter((b) => passt(b.name));
  const unklareZutaten = a.unklareZutaten.filter(
    (u) => passt(u.zutat) || u.rezepte.some((r) => passt(r))
  );

  const kacheln = `
    <div class="home-stats">
      <div class="stat-tile"><span class="stat-value">${a.machbar.length}</span><span class="stat-label">machbar</span></div>
      <div class="stat-tile"><span class="stat-value">${a.eineFehlt.length}</span><span class="stat-label">eine Zutat fehlt</span></div>
      <div class="stat-tile"><span class="stat-value">${a.mehrereFehlen.length}</span><span class="stat-label">mehrere Zutaten fehlen</span></div>
      <div class="stat-tile"><span class="stat-value">${a.unklareRezepte.length}</span><span class="stat-label">Bestand unklar</span></div>
    </div>`;

  const hinweis =
    a.ungezaehlteProdukte.length > 0
      ? `<p class="empty-note">${a.ungezaehlteProdukte.length} in Rezepten verwendete Produkte sind in dieser Zählung nicht erfasst. Nicht gezählt ist etwas anderes als leer – sie gelten hier als vorhanden.</p>`
      : "";

  const machbarBlock = `
    <h3 class="prep-group">Machbar (${machbar.length}${machbar.length !== a.machbar.length ? ` von ${a.machbar.length}` : ""})</h3>
    ${
      machbar.length > 0
        ? `<div class="shortcut-list">${rezeptChips(machbar)}</div>`
        : `<p class="empty-note">Kein Drink in dieser Auswahl vollständig auf Bestand.</p>`
    }`;

  const eineFehltBlock = `
    <h3 class="prep-group">Eine Zutat fehlt (${eineFehlt.length}${eineFehlt.length !== a.eineFehlt.length ? ` von ${a.eineFehlt.length}` : ""})</h3>
    ${
      eineFehlt.length > 0
        ? `<div class="table-scroll">
             <table>
               <thead><tr><th>Drink</th><th>fehlt</th></tr></thead>
               <tbody>
                 ${eineFehlt
                   .map(
                     (b) => `
                   <tr>
                     <td><button type="button" class="quality-item-btn build-recipe" data-name="${escapeHtml(b.name)}">${escapeHtml(b.name)}</button></td>
                     <td>${escapeHtml(b.fehlend[0])}</td>
                   </tr>`
                   )
                   .join("")}
               </tbody>
             </table>
           </div>`
        : `<p class="empty-note">Kein Drink, dem genau eine Zutat fehlt.</p>`
    }`;

  const unklarBlock = `
    <h3 class="prep-group">Nicht zuordenbare Zutaten (${unklareZutaten.length}${
      unklareZutaten.length !== a.unklareZutaten.length ? ` von ${a.unklareZutaten.length}` : ""
    })</h3>
    ${
      a.unklareZutaten.length === 0
        ? `<p class="empty-note">Alle Zutaten des Rezeptbuchs sind einem Produkt zugeordnet.</p>`
        : `<p class="hint">Diese Zutaten haben keinen Treffer im Produktkatalog – für sie lässt sich kein Bestand prüfen. Entweder fehlt das Produkt, oder die Schreibweise weicht ab (die Zutat muss den Produktnamen enthalten, z.&nbsp;B. „Bombay Sapphire Gin" statt „Gin").</p>
           <div class="table-scroll">
             <table>
               <thead><tr><th>Zutat</th><th>Drinks</th><th>betroffen</th></tr></thead>
               <tbody>
                 ${unklareZutaten
                   .map(
                     (u) => `
                   <tr>
                     <td>${escapeHtml(u.zutat)}</td>
                     <td>${u.rezepte.length}</td>
                     <td>${u.rezepte
                       .map(
                         (r) =>
                           `<button type="button" class="quality-item-btn build-recipe" data-name="${escapeHtml(r)}">${escapeHtml(r)}</button>`
                       )
                       .join(" ")}</td>
                   </tr>`
                   )
                   .join("")}
               </tbody>
             </table>
           </div>`
    }`;

  resultEl.innerHTML = kacheln + hinweis + machbarBlock + eineFehltBlock + unklarBlock;
}

// ---------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------

async function ladeStand() {
  renderCountSelect();
  if (!gewaehlteId) {
    stand = null;
    setStatus("");
    render();
    return;
  }
  const lauf = ++ladeVorgang;
  setStatus("Zählstand wird geladen …");
  try {
    const geladen = await loadInventoryItems(gewaehlteId);
    if (lauf !== ladeVorgang) return; // zwischenzeitlich andere Zählung gewählt
    stand = geladen;
    setStatus("");
  } catch {
    if (lauf !== ladeVorgang) return;
    stand = null;
    setStatus("Zählstand konnte nicht geladen werden – ohne Netz gibt es keine Auswertung.");
  }
  render();
}

// Einstieg aus der Inventur: wertet genau die dort geöffnete Zählung aus.
// Der lokale Stand wird mitgegeben, damit auch noch nicht hochgeladene
// Eingaben zählen.
export function openBuildableForCount(countId, standVorgabe = null) {
  gewaehlteId = countId;
  renderCountSelect();
  if (standVorgabe) {
    ladeVorgang += 1; // einen laufenden Server-Ladevorgang entwerten
    stand = standVorgabe;
    setStatus("");
    render();
    return;
  }
  ladeStand();
}

export function initBuildable() {
  renderCountSelect();
  render();

  selectEl.addEventListener("change", () => {
    gewaehlteId = selectEl.value;
    ladeStand();
  });
  reloadBtn.addEventListener("click", ladeStand);
  searchEl.addEventListener("input", render);

  resultEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".build-recipe");
    if (!btn) return;
    switchTab("recipes");
    focusRecipe(btn.dataset.name);
  });

  // Erst laden, wenn der Tab wirklich geöffnet wird – beim App-Start soll
  // dafür keine zusätzliche Abfrage laufen.
  const ladeWennNoetig = () => {
    if (!stand) ladeStand();
  };
  document
    .querySelectorAll('.tab-btn[data-tab="buildable"], .tool-card[data-tab="buildable"]')
    .forEach((btn) => btn.addEventListener("click", ladeWennNoetig));
  window.addEventListener("hashchange", () => {
    if (location.hash.slice(1) === "buildable") ladeWennNoetig();
  });
  if (panelEl?.classList.contains("active")) ladeWennNoetig();

  onInventoryCountsChanged(renderCountSelect);
  // Neue Produkte oder Rezepte ändern die Zuordnung, deshalb neu bewerten.
  onProductsChanged(() => {
    if (stand) render();
  });
  onRecipesChanged(() => {
    if (stand) render();
  });
}
