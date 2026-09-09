import { getAllRecipes } from "./recipeLibrary.js";
import { getAllProducts } from "./productLibrary.js";
import { calculateRecipeCost, ingredientCost } from "./costing.js";
import { getProduct } from "./productLibrary.js";
import { previousPriceFor, onPricesChanged } from "./priceHistory.js";
import { onRecipesChanged, onProductsChanged } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { getLocale, onLanguageChanged, t } from "./i18n.js";

// Kartenkalkulation: mehrere Drinks auf einen Blick.
//
// Der Kalkulations-Rechner rechnet einen Drink. Beim Kartenmachen will man
// aber sehen, welcher Drink die Karte trägt und welcher Geld kostet – also
// Wareneinsatz, Verkaufspreis, Rohertrag und Wareneinsatzquote nebeneinander.

const panelEl = document.getElementById("menu-costing");
const searchEl = document.getElementById("menu-search");
const listEl = document.getElementById("menu-recipe-list");
const resultEl = document.getElementById("menu-result");
const quoteEl = document.getElementById("menu-target-quote");
const vatEl = document.getElementById("menu-vat");
const countEl = document.getElementById("menu-selected-count");
const selectAllBtn = document.getElementById("menu-select-all");
const selectNoneBtn = document.getElementById("menu-select-none");
const exportBtn = document.getElementById("menu-export-excel");
const statusEl = document.getElementById("menu-data-status");

// Überlebt das Neuzeichnen der Liste (z. B. beim Suchen).
const selectedNames = new Set();

// Zielquote: im Betrieb sind 22 % Wareneinsatz die Vorgabe. Der Wert bleibt
// im Feld änderbar und wird pro Gerät gemerkt, damit ihn niemand bei jedem
// Öffnen der Karte neu eintippen muss.
const QUOTE_STORAGE_KEY = "bartool:menu-target-quote";
const DEFAULT_QUOTE = 22;

// Ab wie viel Prozent Anstieg des Wareneinsatzes ein Drink in die Warnliste
// wandert. 10 % ist die Schwelle, ab der sich Nachrechnen lohnt.
const WARN_SCHWELLE_PROZENT = 10;

function ladeZielquote() {
  try {
    const gespeichert = parseFloat(localStorage.getItem(QUOTE_STORAGE_KEY));
    if (Number.isFinite(gespeichert) && gespeichert > 0) return gespeichert;
  } catch {
    // Kein Zugriff auf localStorage: dann eben mit der Vorgabe arbeiten.
  }
  return DEFAULT_QUOTE;
}

function speichereZielquote(wert) {
  try {
    localStorage.setItem(QUOTE_STORAGE_KEY, String(wert));
  } catch {
    // Speichern ist Komfort, kein Muss.
  }
}

function formatEuro(n) {
  return `${n.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

// Deutsches Zahlenformat mit Komma – sonst stünde neben "14,50 €" ein
// "13.91 %", was auf einem Blatt nebeneinander unsauber aussieht.
function formatProzent(n) {
  return `${n.toLocaleString(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function gefilterteRezepte() {
  const suche = searchEl.value.trim().toLowerCase();
  const alle = getAllRecipes();
  if (!suche) return alle;
  return alle.filter(
    (r) =>
      r.name.toLowerCase().includes(suche) ||
      String(r.category ?? "").toLowerCase().includes(suche)
  );
}

function renderList() {
  const rezepte = gefilterteRezepte();
  listEl.innerHTML = rezepte
    .map(
      (r) => `
      <label class="menu-pick">
        <input type="checkbox" value="${escapeHtml(r.name)}" ${selectedNames.has(r.name) ? "checked" : ""} />
        <span>${escapeHtml(r.name)}</span>
        ${r.salesPrice !== "" && r.salesPrice != null ? `<span class="menu-pick-price">${formatEuro(Number(r.salesPrice))}</span>` : `<span class="menu-pick-price menu-pick-missing">${t("ui.kein_preis")}</span>`}
      </label>`
    )
    .join("");
  countEl.textContent = `${selectedNames.size} ${t("ui.ausgewaehlt")}`;
}

// Rechnet eine Zeile. Der Verkaufspreis am Rezept ist ein Bruttopreis, der
// Wareneinsatz netto – zum Vergleich wird der Bruttopreis auf netto
// zurückgerechnet, sonst sähe jede Quote zu gut aus.
function berechneZeile(recipe, vat) {
  const kosten = calculateRecipeCost(recipe);
  const brutto = recipe.salesPrice === "" || recipe.salesPrice == null ? null : Number(recipe.salesPrice);
  const netto = brutto === null ? null : brutto / (1 + vat / 100);
  return {
    name: recipe.name,
    wareneinsatz: kosten.total,
    preisKomplett: kosten.allPricesKnown,
    fehlendePreise: kosten.lines.filter((l) => !l.priceKnown).map((l) => l.name),
    brutto,
    netto,
    rohertrag: netto === null ? null : netto - kosten.total,
    quote: netto === null || netto === 0 ? null : (kosten.total / netto) * 100,
  };
}

// Wareneinsatz eines Rezepts, wahlweise mit den aktuellen Einkaufspreisen
// oder mit dem jeweils vorherigen gespeicherten Preisstand. Der Vergleich
// beider Werte zeigt, welcher Drink durch Preiserhöhungen teurer geworden ist.
// Zutaten ohne Vorwert werden mit dem aktuellen Preis gerechnet, sonst sähe
// jede Preiserhöhung größer aus, als sie ist.
// "seit" ist das jüngste Vorher-Datum unter den Zutaten mit Preishistorie –
// die Reporting-Übersicht (Paket 29) nutzt es, um Preissprünge auf den
// gewählten Zeitraum einzugrenzen.
function wareneinsatzMitVorpreisen(recipe) {
  let total = 0;
  let hatVorwert = false;
  let seit = null;
  for (const ing of recipe.ingredients ?? []) {
    const produkt = getProduct(ing.name);
    const aktuell = produkt && produkt.priceValue ? Number(produkt.priceValue) : 0;
    const vorher = produkt ? previousPriceFor(produkt.name) : null;
    if (vorher) {
      hatVorwert = true;
      if (!seit || vorher.validFrom > seit) seit = vorher.validFrom;
    }
    total += ingredientCost(ing.amount, ing.unit, vorher ? vorher.priceValue : aktuell);
  }
  return hatVorwert ? { total, seit } : null;
}

export function preisWarnungen() {
  return getAllRecipes()
    .map((recipe) => {
      const vorher = wareneinsatzMitVorpreisen(recipe);
      if (vorher === null || vorher.total <= 0) return null;
      const jetzt = calculateRecipeCost(recipe).total;
      const anstieg = ((jetzt - vorher.total) / vorher.total) * 100;
      return anstieg > WARN_SCHWELLE_PROZENT
        ? { name: recipe.name, jetzt, vorher: vorher.total, anstieg, seit: vorher.seit }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.anstieg - a.anstieg);
}

// Steht bewusst unabhängig von der Auswahl unter der Tabelle: die Frage
// "welcher Drink muss neu kalkuliert werden" stellt sich für die ganze Karte,
// nicht nur für die gerade angehakten Drinks.
function renderPreisWarnungen() {
  const warnungen = preisWarnungen();
  if (warnungen.length === 0) return "";
  const zeilen = warnungen
    .map(
      (w) => `
      <tr>
        <td>${escapeHtml(w.name)}</td>
        <td>${formatEuro(w.vorher)}</td>
        <td>${formatEuro(w.jetzt)}</td>
        <td><span class="menu-quote-high">+${formatProzent(w.anstieg)}</span></td>
      </tr>`
    )
    .join("");
  return `
    <p class="summary">${t("ui.kalkulation_pruefen_bei")} ${warnungen.length} ${t("ui.drink_s_ist_der_wareneinsatz_seit_dem_7a93")} ${WARN_SCHWELLE_PROZENT} % gestiegen.</p>
    <div class="table-scroll">
      <table>
        <thead><tr><th>${t("ui.drink")}</th><th>${t("ui.wareneinsatz_vorher")}</th><th>${t("ui.wareneinsatz_jetzt")}</th><th>${t("ui.anstieg")}</th></tr></thead>
        <tbody>${zeilen}</tbody>
      </table>
    </div>`;
}

// Ohne gepflegte Preise rechnet die Karte lauter Nullen. Statt das
// unkommentiert anzuzeigen, steht oben, wie vollständig die Datenbasis ist.
function renderDataStatus() {
  const produkte = getAllProducts();
  const mitEK = produkte.filter((p) => p.priceValue !== "" && p.priceValue != null).length;
  const rezepte = getAllRecipes();
  const mitVK = rezepte.filter((r) => r.salesPrice !== "" && r.salesPrice != null).length;

  const luecken = [];
  if (mitEK < produkte.length) {
    luecken.push(`${produkte.length - mitEK} ${t("ui.von")} ${produkte.length} ${t("ui.produkten_ohne_einkaufspreis")}`);
  }
  if (mitVK < rezepte.length) {
    luecken.push(`${rezepte.length - mitVK} ${t("ui.von")} ${rezepte.length} ${t("ui.drinks_ohne_verkaufspreis")}`);
  }

  if (luecken.length === 0) {
    statusEl.hidden = true;
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent =
    t("ui.datenbasis_noch_unvollstaendig") +
    luecken.join(" · ") +
    t("ui.einkaufspreise_stehen_im_produkt_1a01");
}

function berechnen() {
  const vat = parseFloat(vatEl.value) || 0;
  const zielQuote = parseFloat(quoteEl.value) || 0;
  const rezepte = getAllRecipes().filter((r) => selectedNames.has(r.name));

  if (rezepte.length === 0) {
    resultEl.innerHTML = `<p class="empty-note">${t("ui.noch_keine_drinks_ausgewaehlt")}</p>${renderPreisWarnungen()}`;
    return;
  }

  const zeilen = rezepte.map((r) => berechneZeile(r, vat));

  const summeWareneinsatz = zeilen.reduce((s, z) => s + z.wareneinsatz, 0);
  const mitPreis = zeilen.filter((z) => z.netto !== null);
  const summeNetto = mitPreis.reduce((s, z) => s + z.netto, 0);
  const summeRohertrag = mitPreis.reduce((s, z) => s + z.rohertrag, 0);
  const gesamtQuote = summeNetto > 0 ? (mitPreis.reduce((s, z) => s + z.wareneinsatz, 0) / summeNetto) * 100 : null;

  const rows = zeilen
    .map((z) => {
      const zielPreisBrutto =
        zielQuote > 0 ? (z.wareneinsatz / (zielQuote / 100)) * (1 + vat / 100) : null;
      const quoteText =
        z.quote === null
          ? "–"
          : `<span class="${z.quote > zielQuote ? "menu-quote-high" : "menu-quote-ok"}">${formatProzent(z.quote)}</span>`;
      return `
        <tr>
          <td>${escapeHtml(z.name)}${z.preisKomplett ? "" : ` <span class="menu-pick-missing" title="Ohne Einkaufspreis: ${escapeHtml(z.fehlendePreise.join(", "))}">${t("ui.unvollstaendig")}</span>`}</td>
          <td>${formatEuro(z.wareneinsatz)}</td>
          <td>${z.brutto === null ? "–" : formatEuro(z.brutto)}</td>
          <td>${z.rohertrag === null ? "–" : formatEuro(z.rohertrag)}</td>
          <td>${quoteText}</td>
          <td>${zielPreisBrutto === null ? "–" : formatEuro(zielPreisBrutto)}</td>
        </tr>`;
    })
    .join("");

  const ohnePreis = zeilen.filter((z) => z.netto === null).length;
  const unvollstaendig = zeilen.filter((z) => !z.preisKomplett).length;

  resultEl.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>${t("ui.drink")}</th><th>${t("ui.wareneinsatz")}</th><th>${t("ui.verkauf_brutto")}</th>
            <th>${t("ui.rohertrag_netto")}</th><th>${t("ui.quote_3090")}</th><th>${t("ui.zielpreis_brutto")}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <th>${t("ui.summe")}${zeilen.length})</th>
            <th>${formatEuro(summeWareneinsatz)}</th>
            <th>${formatEuro(mitPreis.reduce((s, z) => s + z.brutto, 0))}</th>
            <th>${formatEuro(summeRohertrag)}</th>
            <th>${gesamtQuote === null ? "–" : formatProzent(gesamtQuote)}</th>
            <th>–</th>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="summary">
      ${t("ui.quote_wareneinsatz_im_verhaeltnis_zum_5da2")} ${formatProzent(zielQuote)}.
      ${t("ui.der_zielpreis_zeigt_was_der_drink_5f2a")}
    </p>
    ${
      ohnePreis > 0
        ? `<p class="empty-note">${ohnePreis} ${t("ui.drink_s_ohne_verkaufspreis_preis_im_rezept_de83")}</p>`
        : ""
    }
    ${
      unvollstaendig > 0
        ? `<p class="empty-note">${unvollstaendig} ${t("ui.drink_s_mit_unvollstaendigem_wareneinsatz_42fe")}</p>`
        : ""
    }
    ${renderPreisWarnungen()}
  `;
}

function exportExcel() {
  const vat = parseFloat(vatEl.value) || 0;
  const zielQuote = parseFloat(quoteEl.value) || 0;
  const rezepte = getAllRecipes().filter((r) => selectedNames.has(r.name));
  if (rezepte.length === 0) return;

  const rows = rezepte.map((r) => {
    const z = berechneZeile(r, vat);
    return {
      [t("ui.drink")]: z.name,
      [t("ui.wareneinsatz")]: Number(z.wareneinsatz.toFixed(2)),
      [t("ui.verkauf_brutto")]: z.brutto ?? "",
      [t("ui.rohertrag_netto")]: z.rohertrag === null ? "" : Number(z.rohertrag.toFixed(2)),
      [t("ui.quote")]: z.quote === null ? "" : Number(z.quote.toFixed(2)),
      [t("ui.zielpreis_brutto")]: zielQuote > 0 ? Number(((z.wareneinsatz / (zielQuote / 100)) * (1 + vat / 100)).toFixed(2)) : "",
      [t("ui.wareneinsatz_vollstaendig")]: z.preisKomplett ? t("ui.ja") : t("ui.nein"),
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 15 }, { wch: 16 }, { wch: 10 }, { wch: 17 }, { wch: 22 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, t("ui.karte"));
  XLSX.writeFile(workbook, `${t("ui.bartool_karte")}${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function initMenuCosting() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    renderList();
    renderDataStatus();
    berechnen();
  });

  quoteEl.value = ladeZielquote();
  renderList();
  renderDataStatus();
  berechnen();

  searchEl.addEventListener("input", renderList);

  listEl.addEventListener("change", (e) => {
    const box = e.target.closest('input[type="checkbox"]');
    if (!box) return;
    if (box.checked) selectedNames.add(box.value);
    else selectedNames.delete(box.value);
    countEl.textContent = `${selectedNames.size} ${t("ui.ausgewaehlt")}`;
    berechnen();
  });

  selectAllBtn.addEventListener("click", () => {
    gefilterteRezepte().forEach((r) => selectedNames.add(r.name));
    renderList();
    berechnen();
  });

  selectNoneBtn.addEventListener("click", () => {
    selectedNames.clear();
    renderList();
    berechnen();
  });

  exportBtn.addEventListener("click", exportExcel);

  [quoteEl, vatEl].forEach((el) => el.addEventListener("input", berechnen));

  quoteEl.addEventListener("change", () => {
    const wert = parseFloat(quoteEl.value);
    if (Number.isFinite(wert) && wert > 0) speichereZielquote(wert);
  });

  // Preise können sich jederzeit ändern (anderes Gerät, anderer Nutzer).
  onRecipesChanged(() => {
    renderList();
    renderDataStatus();
    berechnen();
  });
  onProductsChanged(() => {
    renderDataStatus();
    berechnen();
  });
  // Ein neuer Preisstand verschiebt die Warnliste, auch wenn sich am Produkt
  // sonst nichts geändert hat.
  onPricesChanged(berechnen);
}
