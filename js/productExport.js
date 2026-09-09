import { escapeHtml } from "./utils.js";
import { t, formatDecimal } from "./i18n.js";

// Feldreihenfolge für beide Exporte – identisch zur Detailansicht im Tab.
// Gespeichert wird der i18n-Schlüssel, nicht die fertige Beschriftung:
// die Spaltennamen folgen so der eingestellten Sprache, ohne dass der
// Import (js/productImport.js) die Zuordnung verliert.
const FIELD_DEFS = [
  ["ui.name", (p) => p.name],
  ["ui.kategorie_herkunft", (p) => p.category],
  ["ui.gruppe", (p) => p.group],
  ["ui.untergruppe", (p) => p.subGroup],
  ["ui.alkoholgehalt_006a", (p) => p.abv],
  ["ui.alkoholgehalt_zahl", (p) => p.abvValue],
  ["ui.alkoholgehalt_bis", (p) => p.abvMax],
  ["ui.herkunftsland", (p) => p.originCountry],
  ["ui.herkunftsregion", (p) => p.originRegion],
  ["ui.grundstoff", (p) => p.baseMaterial],
  ["ui.herstellungsverfahren", (p) => p.productionMethod],
  ["ui.altersangabe", (p) => p.ageStatement],
  ["ui.aroma_schlagworte", (p) => (p.flavorTags ?? []).join(", ")],
  ["ui.region", (p) => p.region],
  ["ui.rebsorte", (p) => p.grapeVariety],
  ["ui.lage", (p) => p.vineyard],
  ["ui.jahrgang", (p) => p.vintage],
  ["ui.ausbau", (p) => p.aging],
  ["ui.trinkfenster", (p) => p.drinkingWindow],
  ["ui.erzeuger", (p) => p.producer],
  ["ui.geschmacksrichtung", (p) => p.sweetness],
  ["ui.klassifikation", (p) => p.classification],
  ["ui.serviertemperatur", (p) => p.servingTemp],
  ["ui.koerper", (p) => p.body],
  // Leer statt "nein", damit ungeprüfte Produkte den Druck/Word-Export nicht
  // mit einer nichtssagenden Zeile zumüllen.
  ["ui.geprueft", (p) => (p.verified ? t("ui.ja") : "")],
  ["ui.tasting_notes", (p) => p.tastingNotes],
  ["ui.speiseempfehlung", (p) => p.foodPairing],
  ["ui.serviervorschlag", (p) => p.service],
  ["ui.alternativen", (p) => p.alternatives],
  ["ui.story", (p) => p.story],
  ["ui.herstellung", (p) => p.production],
  ["ui.allergene", (p) => p.allergens],
  ["ui.einkaufspreis", (p) => formatPrice(p)],
  ["ui.kurzer_pitch", (p) => p.quickPitch],
  ["ui.passt_gut_zu", (p) => (p.pairsWith ?? []).join(", ")],
  ["ui.soll_bestand", (p) => p.parLevel],
  ["ui.lieferant", (p) => p.supplier],
  ["ui.bestelleinheit", (p) => p.orderUnit],
];

// Die Spaltenschlüssel braucht der Import (js/productImport.js), damit eine
// exportierte Datei ohne Umbenennen wieder eingelesen werden kann.
export const PRODUCT_COLUMN_KEYS = FIELD_DEFS.map(([key]) => key);

// Erst beim Export aufgelöst, nicht beim Laden des Moduls – sonst würde ein
// Sprachwechsel die Spaltennamen nicht mehr erreichen.
function fields() {
  return FIELD_DEFS.map(([key, read]) => [key, t(key), read]);
}

function formatPrice(product) {
  if (!product.priceValue) return "";
  const unitLabel = product.priceUnit === "stueck" ? t("ui.stueck_26e1") : t("ui.liter_3629");
  return `${formatDecimal(product.priceValue, 2)} € / ${unitLabel}`;
}

function timestampedFilename(base, ext) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base}_${stamp}.${ext}`;
}

export function exportProductsToExcel(products) {
  const rows = products.map((product) => {
    const row = {};
    fields().forEach(([, label, read]) => {
      row[label] = read(product) ?? "";
    });
    return row;
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = FIELD_DEFS.map(([key]) => {
    if (key === "ui.story" || key === "ui.tasting_notes") return { wch: 60 };
    if (key === "ui.name" || key === "ui.kategorie_herkunft") return { wch: 30 };
    return { wch: 22 };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, t("ui.produkte"));
  XLSX.writeFile(workbook, timestampedFilename(t("ui.bartool_produkte"), "xlsx"));
}

// Baut die Produktblöcke als HTML. Wird von Word-Export und Druckansicht
// (js/printView.js) gemeinsam genutzt.
export function buildProductBlocks(products) {
  return products
    .map((product, index) => {
      const rows = fields()
        .filter(([key]) => key !== "ui.name")
        .map(([, label, read]) => [label, read(product)])
        .filter(([, value]) => value)
        .map(
          ([label, value]) =>
            `<tr><td class="label">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
        )
        .join("");

      return `
        <div class="product-block${index > 0 ? " pagebreak" : ""}">
          <h2>${escapeHtml(product.name)}</h2>
          <table><tbody>${rows}</tbody></table>
        </div>
      `;
    })
    .join("");
}

export function exportProductsToWord(products) {
  const blocks = buildProductBlocks(products);

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>${t("ui.bartool_produkte_2329")}</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; color: #222; }
    h1 { color: #b8790f; margin-bottom: 4px; }
    h2 { color: #b8790f; border-bottom: 2px solid #b8790f; padding-bottom: 4px; margin-top: 28px; }
    .product-block.pagebreak { page-break-before: always; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; }
    td { border: 1px solid #999; padding: 5px 9px; text-align: left; font-size: 13px; vertical-align: top; }
    td.label { background: #f1e6cf; font-weight: bold; width: 30%; }
  </style>
</head>
<body>
  <h1>${t("ui.bartool_produkte_2939")}</h1>
  ${blocks}
</body>
</html>`;

  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = timestampedFilename(t("ui.bartool_produkte"), "doc");
  link.click();
  URL.revokeObjectURL(url);
}
