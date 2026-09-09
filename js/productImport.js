import { getAllProducts } from "./productLibrary.js";
import { saveProduct } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { t, tIn, AVAILABLE_LANGUAGES } from "./i18n.js";

// Excel-Import für Produkte – das Gegenstück zum Export.
//
// Gedacht für Massenpflege: exportieren, in Excel die Spalten füllen
// (Einkaufspreise, Soll-Bestände, Lieferanten), zurück importieren.
//
// Grundregel: Es wird nichts geschrieben, bevor der Mensch die Vorschau
// gesehen und bestätigt hat. Geschrieben wird über saveProduct(), damit
// Änderungsverlauf und Synchronisation greifen wie bei jeder Handeingabe.

// i18n-Schlüssel der Spalte → Feld im Produkt. Muss zu PRODUCT_COLUMN_KEYS
// passen; "Einkaufspreis" wird gesondert behandelt (Text mit Einheit).
const SPALTEN_KEYS = {
  "ui.name": "name",
  "ui.kategorie_herkunft": "category",
  "ui.gruppe": "group",
  "ui.untergruppe": "subGroup",
  "ui.alkoholgehalt_006a": "abv",
  "ui.alkoholgehalt_zahl": "abvValue",
  "ui.alkoholgehalt_bis": "abvMax",
  "ui.herkunftsland": "originCountry",
  "ui.herkunftsregion": "originRegion",
  "ui.grundstoff": "baseMaterial",
  "ui.herstellungsverfahren": "productionMethod",
  "ui.altersangabe": "ageStatement",
  "ui.aroma_schlagworte": "flavorTags",
  "ui.region": "region",
  "ui.rebsorte": "grapeVariety",
  "ui.lage": "vineyard",
  "ui.jahrgang": "vintage",
  "ui.ausbau": "aging",
  "ui.trinkfenster": "drinkingWindow",
  "ui.erzeuger": "producer",
  "ui.geschmacksrichtung": "sweetness",
  "ui.klassifikation": "classification",
  "ui.serviertemperatur": "servingTemp",
  "ui.koerper": "body",
  "ui.geprueft": "verified",
  "ui.tasting_notes": "tastingNotes",
  "ui.speiseempfehlung": "foodPairing",
  "ui.serviervorschlag": "service",
  "ui.alternativen": "alternatives",
  "ui.story": "story",
  "ui.herstellung": "production",
  "ui.allergene": "allergens",
  "ui.kurzer_pitch": "quickPitch",
  "ui.passt_gut_zu": "pairsWith",
  "ui.soll_bestand": "parLevel",
  "ui.lieferant": "supplier",
  "ui.bestelleinheit": "orderUnit",
};

// Spaltenname → Feld, in allen Sprachen gleichzeitig: eine auf Englisch
// exportierte Datei lässt sich damit auch auf Deutsch wieder einlesen
// und umgekehrt.
function spaltenZuFeld() {
  const map = {};
  Object.entries(SPALTEN_KEYS).forEach(([key, feld]) => {
    AVAILABLE_LANGUAGES.forEach((lang) => {
      map[tIn(lang, key)] = feld;
    });
  });
  return map;
}

// Preisspalte in allen Sprachen – sie wird gesondert geparst.
function preisSpalten() {
  return AVAILABLE_LANGUAGES.map((lang) => tIn(lang, "ui.einkaufspreis"));
}

// Umkehrung für die Anzeige: in der Vorschau soll "Soll-Bestand" stehen,
// nicht der interne Feldname.
function feldLabels() {
  const labels = Object.fromEntries(
    Object.entries(SPALTEN_KEYS).map(([key, feld]) => [feld, t(key)])
  );
  labels.priceValue = t("ui.einkaufspreis");
  labels.priceUnit = t("ui.preiseinheit");
  return labels;
}

const fileEl = document.getElementById("product-import-file");
const previewEl = document.getElementById("product-import-preview");
const applyBtn = document.getElementById("product-import-apply");
const cancelBtn = document.getElementById("product-import-cancel");

// Ergebnis des letzten Einlesens, wartet auf Bestätigung.
let vorschau = null;

// "18,50 € / Liter" oder "18.5" → { priceValue, priceUnit }
function parsePreis(wert) {
  if (wert === "" || wert == null) return { priceValue: "", priceUnit: "liter" };
  const text = String(wert);
  const treffer = text.match(/-?\d+(?:[.,]\d+)?/);
  const zahl = treffer ? parseFloat(treffer[0].replace(",", ".")) : NaN;
  const unit = /st(ü|ue)ck/i.test(text) ? "stueck" : "liter";
  return { priceValue: Number.isFinite(zahl) ? zahl : "", priceUnit: unit };
}

function parseZahl(wert) {
  if (wert === "" || wert == null) return "";
  const zahl = parseFloat(String(wert).replace(",", "."));
  return Number.isFinite(zahl) ? zahl : "";
}

// Vergleicht die Felder, die aus der Datei kommen, mit dem vorhandenen
// Produkt. Nur diese Felder – der Import darf nichts überschreiben, wozu die
// Datei gar keine Spalte hat.
// Felder, die als Haken gepflegt werden: hier zählt nur ja/nein, sonst würde
// ein nie gesetzter Haken ("") gegen false als Änderung gewertet.
const BOOL_FELDER = new Set(["verified"]);

function unterschiede(vorhanden, neu) {
  const diffs = [];
  Object.keys(neu).forEach((feld) => {
    if (feld === "name") return;
    const alt = vorhanden?.[feld] ?? "";
    const jetzt = neu[feld] ?? "";
    if (BOOL_FELDER.has(feld)) {
      if (Boolean(alt) !== Boolean(jetzt)) {
        diffs.push({ feld, alt: alt ? "ja" : "nein", neu: jetzt ? "ja" : "nein" });
      }
      return;
    }
    const altText = Array.isArray(alt) ? alt.join(", ") : String(alt);
    const neuText = Array.isArray(jetzt) ? jetzt.join(", ") : String(jetzt);
    if (altText !== neuText) diffs.push({ feld, alt: altText, neu: neuText });
  });
  return diffs;
}

function zeileZuProdukt(zeile) {
  const produkt = {};
  Object.entries(spaltenZuFeld()).forEach(([spalte, feld]) => {
    if (!(spalte in zeile)) return;
    const wert = zeile[spalte];
    if (feld === "pairsWith" || feld === "flavorTags") {
      produkt[feld] = String(wert ?? "")
        .split(",")
        .map((teil) => teil.trim())
        .filter(Boolean);
    } else if (feld === "parLevel" || feld === "abvValue" || feld === "abvMax") {
      produkt[feld] = parseZahl(wert);
    } else if (feld === "verified") {
      produkt.verified = /^(ja|x|wahr|true|1)$/i.test(String(wert ?? "").trim());
    } else {
      produkt[feld] = wert == null ? "" : String(wert).trim();
    }
  });
  const preisSpalte = preisSpalten().find((spalte) => spalte in zeile);
  if (preisSpalte) {
    const { priceValue, priceUnit } = parsePreis(zeile[preisSpalte]);
    produkt.priceValue = priceValue;
    produkt.priceUnit = priceUnit;
  }
  return produkt;
}

function analysiere(zeilen, spaltenInDatei) {
  const bekannt = new Map(getAllProducts().map((p) => [p.name, p]));
  const neu = [];
  const geaendert = [];
  const unveraendert = [];
  const fehler = [];

  zeilen.forEach((zeile, index) => {
    const produkt = zeileZuProdukt(zeile);
    const name = String(produkt.name ?? "").trim();
    if (!name) {
      fehler.push(`${t("ui.zeile")} ${index + 2}${t("ui.kein_produktname")}`);
      return;
    }
    const vorhanden = bekannt.get(name);
    if (!vorhanden) {
      neu.push({ name, produkt });
      return;
    }
    const diffs = unterschiede(vorhanden, produkt);
    if (diffs.length === 0) unveraendert.push({ name });
    else geaendert.push({ name, produkt: { ...vorhanden, ...produkt }, diffs });
  });

  const bekannteSpalten = spaltenZuFeld();
  const preise = preisSpalten();
  const unbekannteSpalten = spaltenInDatei.filter(
    (spalte) => !(spalte in bekannteSpalten) && !preise.includes(spalte)
  );

  return { neu, geaendert, unveraendert, fehler, unbekannteSpalten };
}

function renderVorschau(v) {
  const gruppe = (titel, eintraege, inhalt) =>
    eintraege.length === 0
      ? ""
      : `<h4 class="prep-group">${escapeHtml(titel)} (${eintraege.length})</h4>${inhalt}`;

  const neuHtml = gruppe(
    t("ui.neu_anlegen"),
    v.neu,
    `<p class="prep-meta">${escapeHtml(v.neu.map((e) => e.name).join(", "))}</p>`
  );

  const geaendertHtml = gruppe(
    t("ui.geaendert_01de"),
    v.geaendert,
    v.geaendert
      .map(
        (e) => `
      <details class="prep-item">
        <summary>${escapeHtml(e.name)} · ${e.diffs.length} ${t("ui.feld_er")}</summary>
        <div class="table-scroll">
          <table>
            <thead><tr><th>${t("ui.feld")}</th><th>bisher</th><th>neu</th></tr></thead>
            <tbody>
              ${e.diffs
                .map(
                  (d) =>
                    `<tr><td>${escapeHtml(feldLabels()[d.feld] ?? d.feld)}</td><td>${escapeHtml(d.alt || "–")}</td><td>${escapeHtml(d.neu || "–")}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </details>`
      )
      .join("")
  );

  const unveraendertHtml =
    v.unveraendert.length > 0
      ? `<p class="empty-note">${v.unveraendert.length} ${t("ui.zeile_n_unveraendert_die_werden_nicht_fe34")}</p>`
      : "";

  const fehlerHtml =
    v.fehler.length > 0
      ? `<p class="empty-note menu-pick-missing">${escapeHtml(v.fehler.join(" · "))}</p>`
      : "";

  const spaltenHtml =
    v.unbekannteSpalten.length > 0
      ? `<p class="empty-note">${t("ui.unbekannte_spalten_werden_ignoriert")} ${escapeHtml(v.unbekannteSpalten.join(", "))}</p>`
      : "";

  previewEl.innerHTML =
    spaltenHtml +
    fehlerHtml +
    neuHtml +
    geaendertHtml +
    unveraendertHtml +
    (v.neu.length + v.geaendert.length === 0
      ? `<p class="empty-note">${t("ui.nichts_zu_schreiben")}</p>`
      : "");

  applyBtn.hidden = v.neu.length + v.geaendert.length === 0;
  cancelBtn.hidden = false;
  applyBtn.textContent = `${v.neu.length + v.geaendert.length} ${t("ui.aenderung_en_uebernehmen")}`;
}

async function handleFile(e) {
  const datei = e.target.files?.[0];
  if (!datei) return;
  // Auch bei einem Lesefehler muss man die Auswahl zurücksetzen können.
  cancelBtn.hidden = false;
  try {
    const puffer = await datei.arrayBuffer();
    const workbook = XLSX.read(puffer, { type: "array" });
    const blatt = workbook.Sheets[workbook.SheetNames[0]];
    const zeilen = XLSX.utils.sheet_to_json(blatt, { defval: "" });
    if (zeilen.length === 0) {
      previewEl.innerHTML = `<p class="empty-note">${t("ui.die_datei_enthaelt_keine_zeilen")}</p>`;
      return;
    }
    const spalten = Object.keys(zeilen[0]);
    if (!spalten.includes("Name")) {
      previewEl.innerHTML = `<p class="empty-note menu-pick-missing">${t("ui.die_datei_hat_keine_spalte_name_am_c625")}</p>`;
      return;
    }
    vorschau = analysiere(zeilen, spalten);
    renderVorschau(vorschau);
  } catch (error) {
    previewEl.innerHTML = `<p class="empty-note menu-pick-missing">${t("ui.datei_konnte_nicht_gelesen_werden")} ${escapeHtml(error.message)}</p>`;
  }
}

async function uebernehmen() {
  if (!vorschau) return;
  const zuSchreiben = [...vorschau.neu, ...vorschau.geaendert];
  applyBtn.disabled = true;
  let ok = 0;
  const fehler = [];
  for (const eintrag of zuSchreiben) {
    try {
      await saveProduct(eintrag.produkt);
      ok += 1;
    } catch (error) {
      fehler.push(`${eintrag.name}: ${error.message}`);
    }
  }
  applyBtn.disabled = false;
  applyBtn.hidden = true;
  previewEl.innerHTML =
    `<p class="empty-note">${ok} ${t("ui.produkt_e_gespeichert")}</p>` +
    (fehler.length > 0
      ? `<p class="empty-note menu-pick-missing">${escapeHtml(fehler.length)} fehlgeschlagen: ${escapeHtml(fehler.join(" · "))}</p>`
      : "");
  vorschau = null;
  fileEl.value = "";
}

function abbrechen() {
  vorschau = null;
  fileEl.value = "";
  previewEl.innerHTML = "";
  applyBtn.hidden = true;
  cancelBtn.hidden = true;
}

export function initProductImport() {
  fileEl.addEventListener("change", handleFile);
  applyBtn.addEventListener("click", uebernehmen);
  cancelBtn.addEventListener("click", abbrechen);
}
