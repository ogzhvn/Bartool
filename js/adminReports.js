import { formatDate, getLocale, localizedText, onLanguageChanged, t } from "./i18n.js";
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
  loadChecklistTemplates,
  loadChecklistRuns,
  onChecklistTemplatesChanged,
  onChecklistRunsChanged,
  loadShiftLogs,
  onShiftLogsChanged,
} from "./storage.js";
import { aktiveVorlagen, laufStatus } from "./checklists.js";
import { offenePunkte, shiftLabel } from "./shiftLog.js";
import { switchTab } from "./tabs.js";
import { escapeHtml, formatNumberLocal } from "./utils.js";
import { getSupabaseClient } from "./supabaseClient.js";
import { can } from "./auth.js";

// Reporting unter Admin (Sub-Tab "admin-reports", Paket 37).
//
// Aus js/reporting.js umgezogen (war Paket 29 als eigener Hauptpunkt) und um
// Betrieb, Team und Datenpflege ergänzt. Alles hier liest nur, was ohnehin
// schon irgendwo im Tool gepflegt wird – keine Kachel schätzt oder erfindet
// einen Wert. Wo die Datenlage nicht reicht, steht das als Text da statt als
// 0 oder leerer Chart.
//
// Team (Quiz-Team-Übersicht + Heatmap) ist aus js/adminQuiz.js hierher
// umgezogen und übernimmt die dortige Aggregat-Abfrage unverändert. Die
// Datenpflege-Kacheln (Vorschläge, Änderungsverlauf) hängen zusätzlich zu
// reports.view an requests.review bzw. audit.view: die RLS-Policies auf
// change_requests/audit_log lesen genau diese Rechte, nicht reports.view –
// ohne das jeweilige Recht stünde sonst eine unvollständige, aber wie
// vollständig aussehende Zahl da. Lieber ein Hinweis als ein falscher Wert.

const gridEl = document.getElementById("report-grid");
const gridBetriebEl = document.getElementById("report-grid-betrieb");
const gridDataEl = document.getElementById("report-grid-data");
const exportBtn = document.getElementById("report-export-btn");
const periodButtons = [...document.querySelectorAll(".report-period-btn")];

const PERIOD_KEY = "bartool:report-period-days";
const DEFAULT_PERIOD_DAYS = 30;
const VAT = 19; // wie in Kalkulation/Karte voreingestellt (js/menuCosting.js, js/calculation.js)
const ZIELQUOTE_KEY = "bartool:menu-target-quote";
const DEFAULT_ZIELQUOTE = 22;

let periodDays = ladePeriode();
// Zählt jeden renderAll()-Lauf hoch, damit eine überholte asynchrone Antwort
// (Bestandswert je Inventurstichtag, Vorschläge, Änderungsverlauf) keine
// veraltete Kachel mehr überschreiben kann.
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
        ? `<span class="report-trend-note">${t("ui.kein_preisstand_so_weit_zurueck")}</span>`
        : `<span class="report-trend-note">${t("ui.vor_x_tagen_wert", {
            tage: periodDays,
            wert: formatProzent(vorher),
          })}</span>`;
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

// ── Kachel (c): Ansätze, die bald ablaufen (inkl. überfällig) ───────────
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
        <span>${escapeHtml(w.name)} <span class="report-tile-hint">${escapeHtml(t("ui.seit_datum", { datum: formatDatum(w.seit) }))}</span></span>
        <span class="menu-quote-high">+${formatProzent(w.anstieg)}</span>
      </div>`
    )
    .join("");

  return tile(`${t("ui.preisspruenge")}${periodDays} ${t("ui.tage")}`, zeilen, "menu-costing");
}

// ── Betrieb (f): Checklisten-Erfüllungsquote ─────────────────────────────
function renderChecklistenKachel() {
  const vorlagen = aktiveVorlagen(loadChecklistTemplates());
  if (vorlagen.length === 0) {
    return tile(t("ui.checklisten_erfuellungsquote"), `<p class="empty-note">${t("ui.noch_keine_checklisten_vorlage_angelegt")}</p>`, "checklists");
  }

  const start = periodenStart(periodDays);
  const laeufeImZeitraum = loadChecklistRuns().filter((r) => r.runDate >= start);
  if (laeufeImZeitraum.length === 0) {
    return tile(
      t("ui.checklisten_erfuellungsquote"),
      `<p class="empty-note">${t("ui.keine_laeufe_im_gewaehlten_zeitraum")}${periodDays} ${t("ui.tage")}</p>`,
      "checklists"
    );
  }

  const zeilen = vorlagen
    .map((vorlage) => {
      const laeufe = laeufeImZeitraum.filter((r) => r.templateId === vorlage.id);
      if (laeufe.length === 0) return null;
      let gesamt = 0;
      let erledigt = 0;
      let offenAbgeschlossen = 0;
      let abgeschlosseneLaeufe = 0;
      laeufe.forEach((run) => {
        const status = laufStatus(vorlage, run);
        gesamt += status.gesamt;
        erledigt += status.erledigt;
        if (run.finishedAt) {
          abgeschlosseneLaeufe += 1;
          offenAbgeschlossen += status.offen;
        }
      });
      const quote = gesamt > 0 ? (erledigt / gesamt) * 100 : null;
      if (quote === null) return null;
      const klasse = quote >= 90 ? "is-ok" : quote >= 70 ? "" : "is-high";
      const luecke =
        abgeschlosseneLaeufe > 0
          ? `<span class="report-trend-note">${offenAbgeschlossen} ${t("ui.offene_punkte_in")} ${abgeschlosseneLaeufe} ${t("ui.abgeschlossenen_laeufen")}</span>`
          : "";
      return `
        <div class="report-quota-row">
          <div class="report-quota-head">
            <span class="report-quota-label">${escapeHtml(localizedText(vorlage, "name"))}</span>
            <span class="report-quota-value">${formatProzent(quote)}</span>
          </div>
          ${balken(quote, klasse)}
          ${luecke}
        </div>`;
    })
    .filter(Boolean)
    .join("");

  if (!zeilen) {
    return tile(
      t("ui.checklisten_erfuellungsquote"),
      `<p class="empty-note">${t("ui.keine_laeufe_im_gewaehlten_zeitraum")}${periodDays} ${t("ui.tage")}</p>`,
      "checklists"
    );
  }

  return tile(t("ui.checklisten_erfuellungsquote"), zeilen, "checklists");
}

// ── Betrieb (g): Übergaben je Schicht ────────────────────────────────────
function renderUebergabenKachel() {
  const start = periodenStart(periodDays);
  const logs = loadShiftLogs().filter((l) => l.shiftDate >= start);
  if (logs.length === 0) {
    return tile(
      t("ui.uebergaben_je_schicht"),
      `<p class="empty-note">${t("ui.keine_uebergaben_im_gewaehlten_zeitraum")}${periodDays} ${t("ui.tage")}</p>`,
      "shift-log"
    );
  }
  // Erfolgs-Titel nutzt eine eigene, klammer-offene Übersetzung – gleiches
  // Muster wie ui.verluste_nach_grund/_b706 weiter oben in dieser Datei.

  const jeSchicht = new Map();
  logs.forEach((log) => {
    const eintrag = jeSchicht.get(log.shift) ?? { gesamt: 0, mitLuecken: 0 };
    eintrag.gesamt += 1;
    if (offenePunkte(log).length > 0) eintrag.mitLuecken += 1;
    jeSchicht.set(log.shift, eintrag);
  });

  const zeilen = [...jeSchicht.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([schicht, eintrag]) => {
      const quote = (eintrag.mitLuecken / eintrag.gesamt) * 100;
      return `
        <div class="report-bar-row">
          <span class="report-bar-row-label">${escapeHtml(shiftLabel(schicht))}</span>
          ${balken(quote, quote > 0 ? "is-high" : "is-ok")}
          <span class="report-bar-row-value">${eintrag.mitLuecken} / ${eintrag.gesamt}</span>
        </div>`;
    })
    .join("");

  return tile(
    `${t("ui.uebergaben_je_schicht_zeitraum")}${periodDays} ${t("ui.tage")}`,
    zeilen + `<p class="report-tile-hint">${t("ui.uebergaben_mit_offenen_punkten_von_gesamt")}</p>`,
    "shift-log"
  );
}

// ── Datenpflege (h): Änderungsvorschläge im Zeitraum ─────────────────────
async function renderVorschlaegeKachel() {
  if (!can("requests.review")) {
    return tile(
      t("ui.aenderungsvorschlaege"),
      `<p class="empty-note">${t("ui.nur_mit_dem_recht_vorschlaege_pruefen_sichtbar")}</p>`,
      "admin-requests"
    );
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("change_requests").select("status, created_at, reviewed_at");
  if (error) {
    return tile(t("ui.aenderungsvorschlaege"), `<p class="empty-note">${escapeHtml(error.message)}</p>`, "admin-requests");
  }

  const start = periodenStart(periodDays);
  const eingegangen = data.filter((r) => r.created_at >= start).length;
  const angenommen = data.filter((r) => r.status === "approved" && r.reviewed_at && r.reviewed_at >= start).length;
  const abgelehnt = data.filter((r) => r.status === "rejected" && r.reviewed_at && r.reviewed_at >= start).length;
  const offenListe = data.filter((r) => r.status === "pending").sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const alterAelteste =
    offenListe.length > 0 ? Math.round((Date.now() - new Date(offenListe[0].created_at).getTime()) / 86400000) : null;

  const zeile = (label, wert) =>
    `<div class="report-list-row"><span>${escapeHtml(label)}</span><span class="report-quota-value">${wert}</span></div>`;

  const alterText =
    alterAelteste === null
      ? ""
      : `<p class="report-tile-hint">${t("ui.aeltester_offener_vorschlag")} ${alterAelteste} ${t("ui.tag_en_alt")}</p>`;

  return tile(
    `${t("ui.aenderungsvorschlaege_zeitraum")}${periodDays} ${t("ui.tage")}`,
    zeile(t("ui.eingegangen"), eingegangen) +
      zeile(t("ui.angenommen"), angenommen) +
      zeile(t("ui.abgelehnt"), abgelehnt) +
      zeile(t("ui.offen"), offenListe.length) +
      alterText,
    "admin-requests"
  );
}

// ── Datenpflege (i): Aktivität aus dem Änderungsverlauf ─────────────────
async function renderAuditKachel() {
  if (!can("audit.view")) {
    return tile(
      t("ui.aktivitaet_aenderungsverlauf"),
      `<p class="empty-note">${t("ui.nur_mit_dem_recht_aenderungsverlauf_sichtbar")}</p>`,
      "admin-audit"
    );
  }

  const supabase = getSupabaseClient();
  const start = new Date(periodenStart(periodDays)).toISOString();
  const { data, error } = await supabase
    .from("audit_log")
    .select("table_name, changed_at, changed_by_profile:profiles!audit_log_changed_by_fkey(username, display_name)")
    .gte("changed_at", start)
    .limit(2000);
  if (error) {
    return tile(t("ui.aktivitaet_aenderungsverlauf"), `<p class="empty-note">${escapeHtml(error.message)}</p>`, "admin-audit");
  }

  if (data.length === 0) {
    return tile(
      t("ui.aktivitaet_aenderungsverlauf"),
      `<p class="empty-note">${t("ui.keine_aenderungen_im_gewaehlten_zeitraum")}${periodDays} ${t("ui.tage")}</p>`,
      "admin-audit"
    );
  }

  function topListe(zaehler, anzahl = 5) {
    return [...zaehler.entries()].sort(([, a], [, b]) => b - a).slice(0, anzahl);
  }

  const jePerson = new Map();
  const jeTabelle = new Map();
  data.forEach((row) => {
    const person = row.changed_by_profile?.display_name || row.changed_by_profile?.username || t("ui.unbekannt");
    jePerson.set(person, (jePerson.get(person) ?? 0) + 1);
    jeTabelle.set(row.table_name, (jeTabelle.get(row.table_name) ?? 0) + 1);
  });

  const liste = (eintraege) =>
    eintraege
      .map(
        ([label, anzahl]) =>
          `<div class="report-list-row"><span>${escapeHtml(label)}</span><span class="report-quota-value">${anzahl}</span></div>`
      )
      .join("");

  return tile(
    `${t("ui.aktivitaet_aenderungsverlauf_zeitraum")}${periodDays} ${t("ui.tage")}`,
    `<p class="report-tile-hint">${t("ui.nach_person")}</p>${liste(topListe(jePerson))}` +
      `<p class="report-tile-hint">${t("ui.nach_tabelle")}</p>${liste(topListe(jeTabelle))}`,
    "admin-audit"
  );
}

// ── Team: Quiz-Team-Übersicht und Themen-Heatmap ─────────────────────────
//
// Aus js/adminQuiz.js hierher umgezogen (Paket 37). Beide Listen kommen aus
// SECURITY-DEFINER-Funktionen, die selbst auf das Recht reports.view prüfen
// und ausschließlich Summen zurückgeben. Auf die Tabelle quiz_attempts hat
// auch die Barleitung keinen Lesezugriff – einzelne Antworten einer Person
// bleiben deren Sache.
const teamRefreshBtn = document.getElementById("quiz-team-refresh");
const teamErrorEl = document.getElementById("quiz-team-error");
const teamListEl = document.getElementById("quiz-team-list");
const teamHeatmapEl = document.getElementById("quiz-team-heatmap");

function teamSetError(text) {
  teamErrorEl.hidden = !text;
  teamErrorEl.textContent = text ?? "";
}

function teamEmptyNote(container, text) {
  container.textContent = "";
  const p = document.createElement("p");
  p.className = "empty-note";
  p.textContent = text;
  container.appendChild(p);
}

function teamQuoteBar(prozent) {
  const balkenEl = document.createElement("span");
  balkenEl.className = "quiz-quota-bar";
  const fuellung = document.createElement("span");
  fuellung.className =
    prozent >= 80 ? "quiz-quota-fill is-good" : prozent >= 50 ? "quiz-quota-fill" : "quiz-quota-fill is-weak";
  fuellung.style.width = `${Math.max(2, prozent)}%`;
  balkenEl.appendChild(fuellung);
  return balkenEl;
}

function teamPersonName(row) {
  const name = String(row.display_name ?? "").trim();
  if (name) return name;
  // Ohne Anzeigenamen bleibt nur die Mailadresse als Kennung.
  return String(row.email ?? "").trim() || t("ui.unbekannt");
}

function teamRenderOverview(rows) {
  teamListEl.textContent = "";
  const aktiv = rows.filter((row) => Number(row.attempts ?? 0) > 0);
  if (aktiv.length === 0) {
    teamEmptyNote(teamListEl, t("ui.noch_hat_niemand_eine_quizrunde_gespielt"));
    return;
  }

  aktiv.forEach((row) => {
    const item = document.createElement("div");
    item.className = "quiz-team-item";

    const kopf = document.createElement("div");
    kopf.className = "quiz-team-head";

    const name = document.createElement("span");
    name.className = "quiz-team-name";
    name.textContent = teamPersonName(row);
    kopf.appendChild(name);

    const quote = Number(row.accuracy ?? 0);
    const quoteEl = document.createElement("span");
    quoteEl.className = "quiz-quota-value";
    quoteEl.textContent = `${quote} %`;
    kopf.appendChild(quoteEl);
    item.appendChild(kopf);

    item.appendChild(teamQuoteBar(quote));

    const runden = Number(row.rounds ?? 0);
    const versuche = Number(row.attempts ?? 0);
    const richtig = Number(row.correct ?? 0);
    const meta = document.createElement("p");
    meta.className = "quiz-team-meta";
    const zuletzt = row.last_answered_at ? new Date(row.last_answered_at) : null;
    const zuletztText = zuletzt && !Number.isNaN(zuletzt.getTime()) ? ` · ${t("ui.zuletzt")} ${formatDate(zuletzt)}` : "";
    meta.textContent = `${runden} ${runden === 1 ? t("ui.runde") : t("ui.runden")} · ${richtig} ${t("ui.von")} ${versuche} ${t("ui.fragen_richtig_71e0")}${zuletztText}`;
    item.appendChild(meta);

    const schwach = Array.isArray(row.weakest_topics) ? row.weakest_topics : [];
    const themen = document.createElement("p");
    themen.className = "quiz-team-topics";
    themen.textContent =
      schwach.length === 0
        ? t("ui.schwaechste_themen_noch_zu_wenige_dada")
        : t("ui.schwaechste_themen") +
          schwach.map((thema) => `${thema.topic} (${thema.accuracy} %, ${thema.attempts} ${t("ui.fragen")}`).join(" · ");
    item.appendChild(themen);

    teamListEl.appendChild(item);
  });
}

function teamRenderHeatmap(rows) {
  teamHeatmapEl.textContent = "";
  if (rows.length === 0) {
    teamEmptyNote(teamHeatmapEl, t("ui.noch_keine_antworten_die_heatmap_fuellt_9261"));
    return;
  }
  rows.forEach((row) => {
    const zeile = document.createElement("div");
    zeile.className = "quiz-quota-row";

    const kopf = document.createElement("span");
    kopf.className = "quiz-quota-head";
    const label = document.createElement("span");
    label.className = "quiz-quota-label";
    label.textContent = row.topic ?? "";
    const wert = document.createElement("span");
    wert.className = "quiz-quota-value";
    wert.textContent = `${Number(row.accuracy ?? 0)} %`;
    kopf.appendChild(label);
    kopf.appendChild(wert);
    zeile.appendChild(kopf);

    zeile.appendChild(teamQuoteBar(Number(row.accuracy ?? 0)));

    const lernende = Number(row.learners ?? 0);
    const meta = document.createElement("span");
    meta.className = "quiz-quota-meta";
    meta.textContent = `${Number(row.correct ?? 0)} ${t("ui.von")} ${Number(row.attempts ?? 0)} ${t("ui.fragen_richtig")} ${lernende} ${lernende === 1 ? t("ui.person") : t("ui.personen")}`;
    zeile.appendChild(meta);

    teamHeatmapEl.appendChild(zeile);
  });
}

async function teamLoad() {
  teamSetError("");
  const supabase = getSupabaseClient();
  try {
    const [uebersicht, heatmap] = await Promise.all([
      supabase.rpc("quiz_team_overview"),
      supabase.rpc("quiz_topic_heatmap"),
    ]);
    if (uebersicht.error) throw uebersicht.error;
    if (heatmap.error) throw heatmap.error;
    teamRenderOverview(uebersicht.data ?? []);
    teamRenderHeatmap(heatmap.data ?? []);
  } catch (error) {
    teamSetError(t("ui.die_team_auswertung_konnte_nicht_geladen_34c6") + error.message);
    teamEmptyNote(teamListEl, t("ui.keine_daten_geladen"));
    teamEmptyNote(teamHeatmapEl, t("ui.keine_daten_geladen"));
  }
}

// ── Export der sichtbaren Auswertung ─────────────────────────────────────
function exportSichtbareAuswertung() {
  const rows = [];
  [gridEl, gridBetriebEl, gridDataEl].forEach((grid) => {
    grid.querySelectorAll(".report-tile").forEach((kachel) => {
      const titel = kachel.querySelector("h3")?.textContent ?? "";
      const inhalt = kachel.querySelector(".report-tile-body")?.textContent.replace(/\s+/g, " ").trim() ?? "";
      rows.push({ Kachel: titel, Inhalt: inhalt });
    });
  });
  if (!teamListEl.querySelector(".empty-note")) {
    rows.push({ Kachel: t("ui.team"), Inhalt: teamListEl.textContent.replace(/\s+/g, " ").trim() });
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 30 }, { wch: 100 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, t("ui.reporting"));
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `bartool_reporting_${stamp}.xlsx`);
}

// ── Zusammenbau ───────────────────────────────────────────────────────────

async function renderAll() {
  const token = ++renderToken;
  // Synchrone Kacheln sofort zeigen, asynchrone (Bestandswert, Vorschläge,
  // Änderungsverlauf) folgen.
  gridEl.innerHTML =
    renderWareneinsatzKachel() +
    tile(t("ui.bestandswert"), `<p class="empty-note">${t("ui.laedt")}</p>`, "inventory") +
    renderAnsaetzeKachel() +
    renderVerlusteKachel() +
    renderPreissprungKachel();

  gridBetriebEl.innerHTML = renderChecklistenKachel() + renderUebergabenKachel();

  gridDataEl.innerHTML =
    tile(t("ui.aenderungsvorschlaege"), `<p class="empty-note">${t("ui.laedt")}</p>`, "admin-requests") +
    tile(t("ui.aktivitaet_aenderungsverlauf"), `<p class="empty-note">${t("ui.laedt")}</p>`, "admin-audit");

  teamLoad();

  const [punkte, vorschlaegeHtml, auditHtml] = await Promise.all([
    bestandswertPunkte(),
    renderVorschlaegeKachel(),
    renderAuditKachel(),
  ]);
  if (token !== renderToken) return; // Zwischenzeitlich neu gerendert (Filter/Daten geändert).

  const bestandswertHtml = renderBestandswertKachel(punkte);
  const platzhalter = gridEl.querySelector('.report-tile[data-tab="inventory"]');
  if (platzhalter) platzhalter.outerHTML = bestandswertHtml;

  gridDataEl.innerHTML = vorschlaegeHtml + auditHtml;
}

function setzeAktivenPeriodenButton() {
  periodButtons.forEach((btn) => btn.classList.toggle("active", Number(btn.dataset.days) === periodDays));
}

function anKlickWeiterleiten(grid) {
  grid.addEventListener("click", (e) => {
    const kachel = e.target.closest(".report-tile");
    if (!kachel) return;
    switchTab(kachel.dataset.tab);
  });
}

export function initAdminReports() {
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

  anKlickWeiterleiten(gridEl);
  anKlickWeiterleiten(gridBetriebEl);
  anKlickWeiterleiten(gridDataEl);

  teamRefreshBtn.addEventListener("click", teamLoad);
  exportBtn?.addEventListener("click", exportSichtbareAuswertung);

  onRecipesChanged(renderAll);
  onProductsChanged(renderAll);
  onPricesChanged(renderAll);
  onInventoryCountsChanged(renderAll);
  onPreparationsChanged(renderAll);
  onLossesChanged(renderAll);
  onChecklistTemplatesChanged(renderAll);
  onChecklistRunsChanged(renderAll);
  onShiftLogsChanged(renderAll);
}
