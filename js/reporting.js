import { formatDate, getLocale, onLanguageChanged, t } from "./i18n.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { ingredientCost, productForIngredient } from "./costing.js";
import { priceHistoryFor, onPricesChanged } from "./priceHistory.js";
import { preisWarnungen } from "./menuCosting.js";
import { auswertung } from "./ordering.js";
import { typLabel } from "./preparations.js";
import { summeJeGrund } from "./losses.js";
import {
  loadPreparations,
  onPreparationsChanged,
  loadInventoryCounts,
  loadInventoryItems,
  onInventoryCountsChanged,
  loadLosses,
  onLossesChanged,
  onRecipesChanged,
  onProductsChanged,
} from "./storage.js";
import { switchTab } from "./tabs.js";
import { escapeHtml, formatNumberLocal } from "./utils.js";

// Reporting-Übersicht: vor der Schicht drei Fragen beantworten. Läuft die
// Wareneinsatzquote weg? Was läuft ab? Was hat die letzte Inventur ergeben?
//
// Alles hier liest nur, was ohnehin schon irgendwo im Tool gepflegt wird –
// keine Kachel schätzt oder erfindet einen Wert. Wo die Datenlage nicht
// reicht (keine zweite Inventur, keine Preishistorie so weit zurück), steht
// das als Text da statt als 0 oder leerer Chart.

const gridEl = document.getElementById("report-grid");
const periodButtons = [...document.querySelectorAll(".report-period-btn")];

const PERIOD_KEY = "bartool:report-period-days";
const DEFAULT_PERIOD_DAYS = 30;
const VAT = 19; // wie in Kalkulation/Karte voreingestellt (js/menuCosting.js, js/calculation.js)
const ZIELQUOTE_KEY = "bartool:menu-target-quote";
const DEFAULT_ZIELQUOTE = 22;

let periodDays = ladePeriode();
// Zählt jeden renderAll()-Lauf hoch, damit eine überholte asynchrone Antwort
// (Bestandswert je Inventurstichtag lädt Positionen nach) keine veraltete
// Kachel mehr überschreiben kann.
let renderToken = 0;

function ladePeriode() {
  try {
    const wert = parseInt(localStorage.getItem(PERIOD_KEY), 10);
    if ([30, 90, 365].includes(wert)) return wert;
  } catch {
    // Kein Zugriff auf localStorage: dann eben mit der Vorgabe arbeiten.
  }
  return DEFAULT_PERIOD_DAYS;
}

function speicherePeriode(tage) {
  try {
    localStorage.setItem(PERIOD_KEY, String(tage));
  } catch {
    // Speichern ist Komfort, kein Muss.
  }
}

function ladeZielquote() {
  try {
    const wert = parseFloat(localStorage.getItem(ZIELQUOTE_KEY));
    if (Number.isFinite(wert) && wert > 0) return wert;
  } catch {
    // Kein Zugriff auf localStorage: dann eben mit der Vorgabe arbeiten.
  }
  return DEFAULT_ZIELQUOTE;
}

function formatEuro(n) {
  return `${n.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function formatProzent(n) {
  return `${n.toLocaleString(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function formatDatum(iso) {
  if (!iso) return "–";
  return formatDate(iso);
}

function isoTag(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function periodenStart(tage) {
  const d = new Date();
  d.setDate(d.getDate() - tage);
  return isoTag(d);
}

function tile(titel, bodyHtml, tabId) {
  return `
    <div class="report-tile no-print" data-tab="${escapeHtml(tabId)}">
      <div class="report-tile-head">
        <h3>${escapeHtml(titel)}</h3>
      </div>
      <div class="report-tile-body">${bodyHtml}</div>
    </div>`;
}

function balken(prozent, klasse = "") {
  const breite = Math.max(0, Math.min(100, prozent));
  return `<span class="report-bar"><span class="report-bar-fill ${klasse}" style="width:${breite}%"></span></span>`;
}

// ── Kachel (a): Wareneinsatzquote je Karte/Kategorie ────────────────────
//
// "Im Zeitverlauf" heißt hier: zwei echte Zeitpunkte, nicht geschätzt. Der
// Wareneinsatz wird für heute und für den Beginn des gewählten Zeitraums aus
// den tatsächlich geloggten Einkaufspreisständen (product_prices) neu
// gerechnet – der Verkaufspreis selbst hat keine Historie und bleibt gleich.
function preisAmDatum(produktName, datumIso) {
  const eintraege = priceHistoryFor(produktName);
  if (eintraege.length === 0) return null;
  const treffer = eintraege.find((e) => e.priceValue != null && e.validFrom <= datumIso);
  if (treffer) return treffer.priceValue;
  // Vor dem ältesten bekannten Preisstand: ältesten bekannten Wert nehmen,
  // statt zu schätzen.
  const mitPreis = [...eintraege].reverse().find((e) => e.priceValue != null);
  return mitPreis ? mitPreis.priceValue : null;
}

function kostenAmDatum(recipe, datumIso) {
  let total = 0;
  for (const ing of recipe.ingredients ?? []) {
    const produkt = productForIngredient(ing.name);
    if (!produkt) return null;
    const preis = preisAmDatum(produkt.name, datumIso);
    if (preis == null) return null;
    total += ingredientCost(ing.amount, ing.unit, preis);
  }
  return total;
}

function quoteFuer(rezepte, datumIso) {
  let sumKosten = 0;
  let sumNetto = 0;
  rezepte.forEach((r) => {
    if (r.salesPrice === "" || r.salesPrice == null) return;
    const kosten = kostenAmDatum(r, datumIso);
    if (kosten == null) return;
    const netto = Number(r.salesPrice) / (1 + VAT / 100);
    if (!(netto > 0)) return;
    sumKosten += kosten;
    sumNetto += netto;
  });
  return sumNetto > 0 ? (sumKosten / sumNetto) * 100 : null;
}

function renderWareneinsatzKachel() {
  const rezepte = getAllRecipes().filter((r) => r.salesPrice !== "" && r.salesPrice != null);
  if (rezepte.length === 0) {
    return tile(
      t("ui.wareneinsatzquote"),
      `<p class="empty-note">${t("ui.noch_kein_drink_mit_verkaufspreis_preise_85ed")}</p>`,
      "menu-costing"
    );
  }

  const heute = isoTag(new Date());
  const start = periodenStart(periodDays);
  const zielquote = ladeZielquote();

  const kategorien = new Map();
  rezepte.forEach((r) => {
    const kat = r.category || t("ui.ohne_kategorie");
    if (!kategorien.has(kat)) kategorien.set(kat, []);
    kategorien.get(kat).push(r);
  });

  function zeile(label, liste) {
    const jetzt = quoteFuer(liste, heute);
    if (jetzt === null) return null;
    const vorher = quoteFuer(liste, start);
    const klasse = jetzt > zielquote ? "is-high" : "is-ok";
    const trend =
      vorher === null
        ? '<span class="report-trend-note">kein Preisstand so weit zurück</span>'
        : `<span class="report-trend-note">vor ${periodDays} ${t("ui.tagen")} ${formatProzent(vorher)}</span>`;
    return `
      <div class="report-quota-row">
        <div class="report-quota-head">
          <span class="report-quota-label">${escapeHtml(label)}</span>
          <span class="report-quota-value">${formatProzent(jetzt)}</span>
        </div>
        ${balken(jetzt, klasse)}
        ${trend}
      </div>`;
  }

  const gesamt = zeile(t("ui.gesamte_karte"), rezepte);
  const proKategorie = [...kategorien.entries()]
    .map(([kat, liste]) => ({ kat, liste, quote: quoteFuer(liste, heute) }))
    .filter((k) => k.quote !== null)
    .sort((a, b) => b.quote - a.quote)
    .map((k) => zeile(k.kat, k.liste))
    .join("");

  return tile(
    t("ui.wareneinsatzquote"),
    `${gesamt ?? ""}${proKategorie}
     <p class="report-tile-hint">${t("ui.zielquote")} ${formatProzent(zielquote)} ${t("ui.aus_der_kartenkalkulation_rot_heisst_bde5")}</p>`,
    "menu-costing"
  );
}

// ── Kachel (b): Bestandswert je Inventurstichtag ────────────────────────
async function bestandswertPunkte() {
  const start = periodenStart(periodDays);
  const zaehlungen = loadInventoryCounts()
    .filter((z) => z.status === "abgeschlossen" && z.countedOn >= start)
    .sort((a, b) => new Date(a.countedOn) - new Date(b.countedOn))
    .slice(-6);

  const punkte = [];
  for (const z of zaehlungen) {
    try {
      const items = await loadInventoryItems(z.id);
      punkte.push({ datum: z.countedOn, wert: auswertung(items).gesamtwert });
    } catch {
      // Einzelne Zählung nicht ladbar (z. B. offline) – einfach auslassen.
    }
  }
  return punkte;
}

function renderBestandswertKachel(punkte) {
  const alleAbgeschlossen = loadInventoryCounts().filter((z) => z.status === "abgeschlossen");
  if (alleAbgeschlossen.length === 0) {
    return tile(t("ui.bestandswert"), `<p class="empty-note">${t("ui.noch_keine_abgeschlossene_inventur")}</p>`, "inventory");
  }
  if (punkte.length === 0) {
    return tile(
      t("ui.bestandswert"),
      `<p class="empty-note">${t("ui.keine_abgeschlossene_inventur_im_cdd5")}</p>`,
      "inventory"
    );
  }

  const max = Math.max(...punkte.map((p) => p.wert), 1);
  const balkenHtml = punkte
    .map(
      (p) => `
      <div class="report-bar-row">
        <span class="report-bar-row-label">${escapeHtml(formatDatum(p.datum))}</span>
        ${balken((p.wert / max) * 100)}
        <span class="report-bar-row-value">${formatEuro(p.wert)}</span>
      </div>`
    )
    .join("");

  const hinweis =
    punkte.length === 1
      ? `<p class="report-tile-hint">${t("ui.noch_keine_zweite_inventur_im_zeitraum_53a9")}</p>`
      : "";

  return tile(t("ui.bestandswert"), balkenHtml + hinweis, "inventory");
}

// ── Kachel (c): Ansätze, die bald ablaufen ───────────────────────────────
//
// Der Ausblick (nächste drei Tage) ist fix – ein Rückblick-Zeitraum passt
// nicht auf "läuft ab". Der Zeitraumfilter wirkt hier trotzdem: er steuert,
// wie weit der zweite Teil zurückschaut ("abgelaufen, aber noch nicht
// abgehakt").
function tageBisAblauf(expiresAt) {
  if (!expiresAt) return null;
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const ziel = new Date(expiresAt);
  ziel.setHours(0, 0, 0, 0);
  return Math.round((ziel - heute) / 86400000);
}

function renderAnsaetzeKachel() {
  const preps = loadPreparations();
  if (preps.length === 0) {
    return tile(t("ui.ablaufende_ansaetze"), `<p class="empty-note">${t("ui.noch_keine_ansaetze_erfasst")}</p>`, "preparations");
  }

  const offen = preps
    .filter((p) => p.status !== "verbraucht" && p.expiresAt)
    .map((p) => ({ p, tage: tageBisAblauf(p.expiresAt) }))
    .filter((e) => e.tage !== null);

  const ablaufend = offen.filter((e) => e.tage >= 0 && e.tage <= 3).sort((a, b) => a.tage - b.tage);
  const ueberfaellig = offen.filter((e) => e.tage < 0 && e.tage >= -periodDays).sort((a, b) => a.tage - b.tage);

  if (ablaufend.length === 0 && ueberfaellig.length === 0) {
    return tile(
      t("ui.ablaufende_ansaetze"),
      `<p class="empty-note">${t("ui.kein_ansatz_laeuft_in_den_naechsten_drei_d7bb")}</p>`,
      "preparations"
    );
  }

  const zeile = ({ p, tage }) => {
    const frist =
      tage < 0
        ? `${t("ui.seit")} ${Math.abs(tage)} ${t("ui.tag_en_abgelaufen")}`
        : tage === 0
          ? t("ui.laeuft_heute_ab")
          : tage === 1
            ? t("ui.laeuft_morgen_ab")
            : `${t("ui.laeuft_in")} ${tage} ${t("ui.tagen_ab")}`;
    return `<div class="report-list-row"><span>${escapeHtml(p.label)} <span class="report-tile-hint">(${escapeHtml(typLabel(p.prepType))})</span></span><span class="menu-quote-high">${escapeHtml(frist)}</span></div>`;
  };

  const zeilen =
    ablaufend.map(zeile).join("") +
    (ueberfaellig.length > 0
      ? `<p class="report-tile-hint">${t("ui.ueberfaellig_noch_nicht_abgehakt")}${periodDays} ${t("ui.tage_zurueck")}</p>` +
        ueberfaellig.map(zeile).join("")
      : "");

  return tile(t("ui.ablaufende_ansaetze"), zeilen, "preparations");
}

// ── Kachel (d): Verluste nach Grund ──────────────────────────────────────
function renderVerlusteKachel() {
  const alle = loadLosses();
  if (alle.length === 0) {
    return tile(t("ui.verluste_nach_grund_b706"), `<p class="empty-note">${t("ui.noch_keine_verluste_erfasst")}</p>`, "losses");
  }

  const start = new Date(periodenStart(periodDays));
  const imZeitraum = alle.filter((l) => new Date(l.occurredAt) >= start);
  if (imZeitraum.length === 0) {
    return tile(
      t("ui.verluste_nach_grund_b706"),
      `<p class="empty-note">${t("ui.keine_verluste_im_gewaehlten_zeitraum")}${periodDays} ${t("ui.tage_f47c")}</p>`,
      "losses"
    );
  }

  // summeJeGrund liefert [reason, {wert, anzahl, ohneWert}], absteigend nach
  // Wert – genau die Reihenfolge, die hier als Balken gebraucht wird.
  const zeilenDaten = summeJeGrund(imZeitraum);
  const max = Math.max(...zeilenDaten.map(([, d]) => d.wert), 1);
  const zeilen = zeilenDaten
    .map(([grund, d]) => {
      const hinweis =
        d.ohneWert > 0 ? ` <span class="report-tile-hint">(${d.ohneWert}${t("ui.ohne_berechenbaren_wert")}</span>` : "";
      return `
        <div class="report-bar-row">
          <span class="report-bar-row-label">${escapeHtml(grund)} (${d.anzahl})</span>
          ${balken((d.wert / max) * 100)}
          <span class="report-bar-row-value">${formatEuro(d.wert)}${hinweis}</span>
        </div>`;
    })
    .join("");

  return tile(`${t("ui.verluste_nach_grund")}${periodDays} ${t("ui.tage")}`, zeilen, "losses");
}

// ── Kachel (e): Preissprünge seit der letzten Kalkulation ───────────────
function renderPreissprungKachel() {
  const alle = preisWarnungen();
  if (alle.length === 0) {
    return tile(
      t("ui.preisspruenge_dd7f"),
      `<p class="empty-note">${t("ui.kein_drink_mit_spuerbarem_wareneinsatz_562d")}</p>`,
      "menu-costing"
    );
  }

  const start = periodenStart(periodDays);
  const imZeitraum = alle.filter((w) => w.seit && w.seit >= start);
  if (imZeitraum.length === 0) {
    return tile(
      t("ui.preisspruenge_dd7f"),
      `<p class="empty-note">${t("ui.keine_preisspruenge_im_gewaehlten_zeitraum")}${periodDays} ${t("ui.tage_4e4d")} ${alle.length} ${t("ui.aeltere_warnung_en_ausserhalb")}</p>`,
      "menu-costing"
    );
  }

  const zeilen = imZeitraum
    .slice(0, 6)
    .map(
      (w) => `
      <div class="report-list-row">
        <span>${escapeHtml(w.name)} <span class="report-tile-hint">seit ${escapeHtml(formatDatum(w.seit))}</span></span>
        <span class="menu-quote-high">+${formatProzent(w.anstieg)}</span>
      </div>`
    )
    .join("");

  return tile(`${t("ui.preisspruenge")}${periodDays} ${t("ui.tage")}`, zeilen, "menu-costing");
}

// ── Zusammenbau ───────────────────────────────────────────────────────────

async function renderAll() {
  const token = ++renderToken;
  // Synchrone Kacheln sofort zeigen, Bestandswert (async) folgt.
  gridEl.innerHTML =
    renderWareneinsatzKachel() +
    tile(t("ui.bestandswert"), `<p class="empty-note">${t("ui.laedt")}</p>`, "inventory") +
    renderAnsaetzeKachel() +
    renderVerlusteKachel() +
    renderPreissprungKachel();

  const punkte = await bestandswertPunkte();
  if (token !== renderToken) return; // Zwischenzeitlich neu gerendert (Filter/Daten geändert).
  const bestandswertHtml = renderBestandswertKachel(punkte);
  const platzhalter = gridEl.querySelector('.report-tile[data-tab="inventory"]');
  if (platzhalter) platzhalter.outerHTML = bestandswertHtml;
}

function setzeAktivenPeriodenButton() {
  periodButtons.forEach((btn) => btn.classList.toggle("active", Number(btn.dataset.days) === periodDays));
}

export function initReporting() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(renderAll);

  setzeAktivenPeriodenButton();
  renderAll();

  periodButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      periodDays = Number(btn.dataset.days);
      speicherePeriode(periodDays);
      setzeAktivenPeriodenButton();
      renderAll();
    });
  });

  gridEl.addEventListener("click", (e) => {
    const kachel = e.target.closest(".report-tile");
    if (!kachel) return;
    switchTab(kachel.dataset.tab);
  });

  onRecipesChanged(renderAll);
  onProductsChanged(renderAll);
  onPricesChanged(renderAll);
  onInventoryCountsChanged(renderAll);
  onPreparationsChanged(renderAll);
  onLossesChanged(renderAll);
}
