import { UNIT_LABELS } from "./units.js";
import { escapeHtml, formatNumber } from "./utils.js";

function formatIngredientLine(ing) {
  return `${formatNumber(ing.amount)} ${UNIT_LABELS[ing.unit] ?? ing.unit} ${ing.name}`;
}

function timestampedFilename(base, ext) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base}_${stamp}.${ext}`;
}

export function exportRecipesToExcel(recipes) {
  const rows = recipes.map((r) => ({
    Name: r.name,
    Zutaten: r.ingredients.map(formatIngredientLine).join("\n"),
    Zubereitung: r.method ?? "",
    Glas: r.glass ?? "",
    Garnitur: r.garnish ?? "",
    Eis: r.ice ?? "",
    Geschichte: r.history ?? "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 26 }, // Name
    { wch: 42 }, // Zutaten
    { wch: 32 }, // Zubereitung
    { wch: 22 }, // Glas
    { wch: 26 }, // Garnitur
    { wch: 18 }, // Eis
    { wch: 60 }, // Geschichte
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Rezepte");
  XLSX.writeFile(workbook, timestampedFilename("Bartool-Rezepte", "xlsx"));
}

// Baut die Rezeptblöcke als HTML. Wird sowohl vom Word-Export als auch von
// der Druckansicht (js/printView.js) genutzt, damit beide Ausgaben identisch
// aufgebaut sind und nicht auseinanderlaufen.
export function buildRecipeBlocks(recipes) {
  return recipes
    .map((recipe, index) => {
      const metaRows = [
        ["Glas", recipe.glass],
        ["Garnitur", recipe.garnish],
        ["Eis", recipe.ice],
        ["Zubereitung", recipe.method],
      ].filter(([, value]) => value);

      const ingredientRows = recipe.ingredients
        .map(
          (ing) =>
            `<tr><td>${escapeHtml(ing.name)}</td><td>${formatNumber(ing.amount)} ${escapeHtml(UNIT_LABELS[ing.unit] ?? ing.unit)}</td></tr>`
        )
        .join("");

      return `
        <div class="recipe-block${index > 0 ? " pagebreak" : ""}">
          <h2>${escapeHtml(recipe.name)}</h2>
          <table>
            <thead><tr><th>Zutat</th><th>Menge</th></tr></thead>
            <tbody>${ingredientRows}</tbody>
          </table>
          ${metaRows.map(([label, value]) => `<p class="meta"><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join("")}
          ${recipe.history ? `<p class="history">${escapeHtml(recipe.history)}</p>` : ""}
        </div>
      `;
    })
    .join("");
}

export function exportRecipesToWord(recipes) {
  const blocks = buildRecipeBlocks(recipes);

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8" />
  <title>Bartool Rezepte</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; color: #222; }
    h1 { color: #b8790f; margin-bottom: 4px; }
    h2 { color: #b8790f; border-bottom: 2px solid #b8790f; padding-bottom: 4px; margin-top: 28px; }
    .recipe-block.pagebreak { page-break-before: always; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0 14px; }
    th, td { border: 1px solid #999; padding: 5px 9px; text-align: left; font-size: 13px; }
    th { background: #f1e6cf; }
    .meta { margin: 3px 0; font-size: 13px; }
    .meta strong { display: inline-block; min-width: 100px; }
    .history { font-size: 12px; color: #444; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Bartool – Rezepte</h1>
  ${blocks}
</body>
</html>`;

  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = timestampedFilename("Bartool-Rezepte", "doc");
  link.click();
  URL.revokeObjectURL(url);
}
