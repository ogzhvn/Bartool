import { escapeHtml } from "./utils.js";

// Feldreihenfolge für beide Exporte – identisch zur Detailansicht im Tab.
const FIELDS = [
  ["Name", (p) => p.name],
  ["Kategorie & Herkunft", (p) => p.category],
  ["Gruppe", (p) => p.group],
  ["Untergruppe", (p) => p.subGroup],
  ["Alkoholgehalt", (p) => p.abv],
  ["Region", (p) => p.region],
  ["Rebsorte", (p) => p.grapeVariety],
  ["Lage", (p) => p.vineyard],
  ["Jahrgang", (p) => p.vintage],
  ["Ausbau", (p) => p.aging],
  ["Trinkfenster", (p) => p.drinkingWindow],
  ["Tasting Notes", (p) => p.tastingNotes],
  ["Speiseempfehlung", (p) => p.foodPairing],
  ["Serviervorschlag", (p) => p.service],
  ["Alternativen", (p) => p.alternatives],
  ["Story", (p) => p.story],
  ["Herstellung", (p) => p.production],
  ["Allergene", (p) => p.allergens],
  ["Einkaufspreis", (p) => formatPrice(p)],
  ["Kurzer Pitch", (p) => p.quickPitch],
  ["Passt gut zu", (p) => (p.pairsWith ?? []).join(", ")],
];

function formatPrice(product) {
  if (!product.priceValue) return "";
  const unitLabel = product.priceUnit === "stueck" ? "Stück" : "Liter";
  return `${product.priceValue.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € / ${unitLabel}`;
}

function timestampedFilename(base, ext) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base}_${stamp}.${ext}`;
}

export function exportProductsToExcel(products) {
  const rows = products.map((product) => {
    const row = {};
    FIELDS.forEach(([label, read]) => {
      row[label] = read(product) ?? "";
    });
    return row;
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = FIELDS.map(([label]) => {
    if (label === "Story" || label === "Tasting Notes") return { wch: 60 };
    if (label === "Name" || label === "Kategorie & Herkunft") return { wch: 30 };
    return { wch: 22 };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Produkte");
  XLSX.writeFile(workbook, timestampedFilename("Bartool-Produkte", "xlsx"));
}

export function exportProductsToWord(products) {
  const blocks = products
    .map((product, index) => {
      const rows = FIELDS.filter(([label]) => label !== "Name")
        .map(([label, read]) => [label, read(product)])
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

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>Bartool Produkte</title>
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
  <h1>Bartool – Produkte</h1>
  ${blocks}
</body>
</html>`;

  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = timestampedFilename("Bartool-Produkte", "doc");
  link.click();
  URL.revokeObjectURL(url);
}
