import { loadInventoryCounts, loadInventoryItems, onInventoryCountsChanged } from "./storage.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { getAllProducts } from "./productLibrary.js";
import { productForIngredient } from "./costing.js";
import { onProductsChanged, onRecipesChanged } from "./storage.js";
import { switchTab } from "./tabs.js";
import { focusRecipe } from "./recipes.js";
import { escapeHtml } from "./utils.js";
import { formatDate, getLocale, onLanguageChanged, t } from "./i18n.js";

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
    machbar: machbar.sort((a, b) => a.name.localeCompare(b.name, getLocale())),
    eineFehlt: eineFehlt.sort((a, b) => a.name.localeCompare(b.name, getLocale())),
    mehrereFehlen,
    unklareRezepte: unklareRezepte.sort((a, b) => a.name.localeCompare(b.name, getLocale())),
    unklareZutaten: [...nachZutat.entries()]
      .map(([zutat, rezepte]) => ({ zutat, rezepte: rezepte.sort((a, b) => a.localeCompare(b, getLocale())) }))
      .sort((a, b) => b.rezepte.length - a.rezepte.length || a.zutat.localeCompare(b.zutat, getLocale())),
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
          z.title || t("ui.inventur")
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
        ? `<p class="empty-note">${t("ui.es_gibt_noch_keine_inventur_lege_im_tab_b07d")}</p>`
        : `<p class="empty-note">${t("ui.noch_kein_zaehlstand_geladen")}</p>`;
    return;
  }

  const a = auswertenGegenStand(stand);

  const gezaehltePositionen = Object.values(stand).filter(
    (e) => e && e.quantity !== null && e.quantity !== undefined && e.quantity !== ""
  ).length;

  if (gezaehltePositionen === 0) {
    resultEl.innerHTML = `<p class="empty-note">${t("ui.in_dieser_zaehlung_ist_noch_nichts_erfasst_974c")}</p>`;
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
      <div class="stat-tile"><span class="stat-value">${a.eineFehlt.length}</span><span class="stat-label">${t("ui.eine_zutat_fehlt_980e")}</span></div>
      <div class="stat-tile"><span class="stat-value">${a.mehrereFehlen.length}</span><span class="stat-label">${t("ui.mehrere_zutaten_fehlen")}</span></div>
      <div class="stat-tile"><span class="stat-value">${a.unklareRezepte.length}</span><span class="stat-label">${t("ui.bestand_unklar")}</span></div>
    </div>`;

  const hinweis =
    a.ungezaehlteProdukte.length > 0
      ? `<p class="empty-note">${a.ungezaehlteProdukte.length} ${t("ui.in_rezepten_verwendete_produkte_sind_in_7870")}</p>`
      : "";

  const machbarBlock = `
    <h3 class="prep-group">${t("ui.machbar")}${machbar.length}${machbar.length !== a.machbar.length ? ` von ${a.machbar.length}` : ""})</h3>
    ${
      machbar.length > 0
        ? `<div class="shortcut-list">${rezeptChips(machbar)}</div>`
        : `<p class="empty-note">${t("ui.kein_drink_in_dieser_auswahl_vollstaendig_e221")}</p>`
    }`;

  const eineFehltBlock = `
    <h3 class="prep-group">${t("ui.eine_zutat_fehlt")}${eineFehlt.length}${eineFehlt.length !== a.eineFehlt.length ? ` von ${a.eineFehlt.length}` : ""})</h3>
    ${
      eineFehlt.length > 0
        ? `<div class="table-scroll">
             <table>
               <thead><tr><th>${t("ui.drink")}</th><th>fehlt</th></tr></thead>
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
        : `<p class="empty-note">${t("ui.kein_drink_dem_genau_eine_zutat_fehlt")}</p>`
    }`;

  const unklarBlock = `
    <h3 class="prep-group">${t("ui.nicht_zuordenbare_zutaten")}${unklareZutaten.length}${
      unklareZutaten.length !== a.unklareZutaten.length ? ` von ${a.unklareZutaten.length}` : ""
    })</h3>
    ${
      a.unklareZutaten.length === 0
        ? `<p class="empty-note">${t("ui.alle_zutaten_des_rezeptbuchs_sind_einem_24f9")}</p>`
        : `<p class="hint">${t("ui.diese_zutaten_haben_keinen_treffer_im_9298")}</p>
           <div class="table-scroll">
             <table>
               <thead><tr><th>${t("ui.zutat")}</th><th>${t("ui.drinks")}</th><th>betroffen</th></tr></thead>
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
  setStatus(t("ui.zaehlstand_wird_geladen"));
  try {
    const geladen = await loadInventoryItems(gewaehlteId);
    if (lauf !== ladeVorgang) return; // zwischenzeitlich andere Zählung gewählt
    stand = geladen;
    setStatus("");
  } catch {
    if (lauf !== ladeVorgang) return;
    stand = null;
    setStatus(t("ui.zaehlstand_konnte_nicht_geladen_werden_afc0"));
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
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    renderCountSelect();
    render();
  });

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
