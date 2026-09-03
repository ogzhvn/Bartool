import { PRODUCT_COLUMNS } from "./productExport.js";
import { getAllProducts } from "./productLibrary.js";
import { saveProduct } from "./storage.js";
import { escapeHtml } from "./utils.js";

// Excel-Import für Produkte – das Gegenstück zum Export.
//
// Gedacht für Massenpflege: exportieren, in Excel die Spalten füllen
// (Einkaufspreise, Soll-Bestände, Lieferanten), zurück importieren.
//
// Grundregel: Es wird nichts geschrieben, bevor der Mensch die Vorschau
// gesehen und bestätigt hat. Geschrieben wird über saveProduct(), damit
// Änderungsverlauf und Synchronisation greifen wie bei jeder Handeingabe.

// Spaltenname aus der Datei → Feld im Produkt. Muss zu PRODUCT_COLUMNS
// passen; "Einkaufspreis" wird gesondert behandelt (Text mit Einheit).
const SPALTEN = {
  Name: "name",
  "Kategorie & Herkunft": "category",
  Gruppe: "group",
  Untergruppe: "subGroup",
  Alkoholgehalt: "abv",
  Region: "region",
  Rebsorte: "grapeVariety",
  Lage: "vineyard",
  Jahrgang: "vintage",
  Ausbau: "aging",
  Trinkfenster: "drinkingWindow",
  "Tasting Notes": "tastingNotes",
  Speiseempfehlung: "foodPairing",
  Serviervorschlag: "service",
  Alternativen: "alternatives",
  Story: "story",
  Herstellung: "production",
  Allergene: "allergens",
  "Kurzer Pitch": "quickPitch",
  "Passt gut zu": "pairsWith",
  "Soll-Bestand": "parLevel",
  Lieferant: "supplier",
  Bestelleinheit: "orderUnit",
};

// Umkehrung für die Anzeige: in der Vorschau soll "Soll-Bestand" stehen,
// nicht der interne Feldname.
const FELD_LABELS = Object.fromEntries(
  Object.entries(SPALTEN).map(([spalte, feld]) => [feld, spalte])
);
FELD_LABELS.priceValue = "Einkaufspreis";
FELD_LABELS.priceUnit = "Preiseinheit";

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
function unterschiede(vorhanden, neu) {
  const diffs = [];
  Object.keys(neu).forEach((feld) => {
    if (feld === "name") return;
    const alt = vorhanden?.[feld] ?? "";
    const jetzt = neu[feld] ?? "";
    const altText = Array.isArray(alt) ? alt.join(", ") : String(alt);
    const neuText = Array.isArray(jetzt) ? jetzt.join(", ") : String(jetzt);
    if (altText !== neuText) diffs.push({ feld, alt: altText, neu: neuText });
  });
  return diffs;
}

function zeileZuProdukt(zeile) {
  const produkt = {};
  Object.entries(SPALTEN).forEach(([spalte, feld]) => {
    if (!(spalte in zeile)) return;
    const wert = zeile[spalte];
    if (feld === "pairsWith") {
      produkt.pairsWith = String(wert ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (feld === "parLevel") {
      produkt.parLevel = parseZahl(wert);
    } else {
      produkt[feld] = wert == null ? "" : String(wert).trim();
    }
  });
  if ("Einkaufspreis" in zeile) {
    const { priceValue, priceUnit } = parsePreis(zeile["Einkaufspreis"]);
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
      fehler.push(`Zeile ${index + 2}: kein Produktname`);
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

  const unbekannteSpalten = spaltenInDatei.filter(
    (s) => !PRODUCT_COLUMNS.includes(s) && s !== "Einkaufspreis"
  );

  return { neu, geaendert, unveraendert, fehler, unbekannteSpalten };
}

function renderVorschau(v) {
  const gruppe = (titel, eintraege, inhalt) =>
    eintraege.length === 0
      ? ""
      : `<h4 class="prep-group">${escapeHtml(titel)} (${eintraege.length})</h4>${inhalt}`;

  const neuHtml = gruppe(
    "Neu anlegen",
    v.neu,
    `<p class="prep-meta">${escapeHtml(v.neu.map((e) => e.name).join(", "))}</p>`
  );

  const geaendertHtml = gruppe(
    "Geändert",
    v.geaendert,
    v.geaendert
      .map(
        (e) => `
      <details class="prep-item">
        <summary>${escapeHtml(e.name)} · ${e.diffs.length} Feld(er)</summary>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Feld</th><th>bisher</th><th>neu</th></tr></thead>
            <tbody>
              ${e.diffs
                .map(
                  (d) =>
                    `<tr><td>${escapeHtml(FELD_LABELS[d.feld] ?? d.feld)}</td><td>${escapeHtml(d.alt || "–")}</td><td>${escapeHtml(d.neu || "–")}</td></tr>`
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
      ? `<p class="empty-note">${v.unveraendert.length} Zeile(n) unverändert – die werden nicht angefasst.</p>`
      : "";

  const fehlerHtml =
    v.fehler.length > 0
      ? `<p class="empty-note menu-pick-missing">${escapeHtml(v.fehler.join(" · "))}</p>`
      : "";

  const spaltenHtml =
    v.unbekannteSpalten.length > 0
      ? `<p class="empty-note">Unbekannte Spalten werden ignoriert: ${escapeHtml(v.unbekannteSpalten.join(", "))}</p>`
      : "";

  previewEl.innerHTML =
    spaltenHtml +
    fehlerHtml +
    neuHtml +
    geaendertHtml +
    unveraendertHtml +
    (v.neu.length + v.geaendert.length === 0
      ? `<p class="empty-note">Nichts zu schreiben.</p>`
      : "");

  applyBtn.hidden = v.neu.length + v.geaendert.length === 0;
  cancelBtn.hidden = false;
  applyBtn.textContent = `${v.neu.length + v.geaendert.length} Änderung(en) übernehmen`;
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
      previewEl.innerHTML = `<p class="empty-note">Die Datei enthält keine Zeilen.</p>`;
      return;
    }
    const spalten = Object.keys(zeilen[0]);
    if (!spalten.includes("Name")) {
      previewEl.innerHTML = `<p class="empty-note menu-pick-missing">Die Datei hat keine Spalte „Name". Am einfachsten: erst exportieren, die Datei ergänzen und wieder einlesen.</p>`;
      return;
    }
    vorschau = analysiere(zeilen, spalten);
    renderVorschau(vorschau);
  } catch (error) {
    previewEl.innerHTML = `<p class="empty-note menu-pick-missing">Datei konnte nicht gelesen werden: ${escapeHtml(error.message)}</p>`;
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
    `<p class="empty-note">${ok} Produkt(e) gespeichert.</p>` +
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
