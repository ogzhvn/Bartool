import { UNIT_LABELS } from "./units.js";
import { escapeHtml } from "./utils.js";

export function createIngredientEditor(containerEl) {
  function makeRow(data = {}) {
    const row = document.createElement("div");
    row.className = "ingredient-row";
    row.innerHTML = `
      <input class="ing-name" type="text" placeholder="Zutat" value="${escapeHtml(data.name ?? "")}" />
      <input class="ing-amount" type="number" min="0" step="0.01" placeholder="Menge" value="${escapeHtml(data.amount ?? "")}" />
      <select class="ing-unit">
        ${Object.entries(UNIT_LABELS)
          .map(
            ([val, label]) =>
              `<option value="${val}" ${data.unit === val ? "selected" : ""}>${label}</option>`
          )
          .join("")}
      </select>
      <button type="button" class="remove-btn" title="Entfernen">✕</button>
    `;
    row.querySelector(".remove-btn").addEventListener("click", () => row.remove());
    return row;
  }

  function addRow(data) {
    containerEl.appendChild(makeRow(data));
  }

  function getIngredients() {
    return [...containerEl.querySelectorAll(".ingredient-row")]
      .map((row) => ({
        name: row.querySelector(".ing-name").value.trim(),
        amount: parseFloat(row.querySelector(".ing-amount").value),
        unit: row.querySelector(".ing-unit").value,
      }))
      .filter((i) => i.name && !Number.isNaN(i.amount) && i.amount > 0);
  }

  function setIngredients(list) {
    containerEl.innerHTML = "";
    if (!list || list.length === 0) {
      addRow();
      return;
    }
    list.forEach(addRow);
  }

  return { addRow, getIngredients, setIngredients };
}
