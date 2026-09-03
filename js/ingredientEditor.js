import { UNIT_LABELS } from "./units.js";
import { escapeHtml } from "./utils.js";
import { getProduct } from "./productLibrary.js";
import { parseAbv } from "./abv.js";

// Sucht den Alkoholgehalt einer Zutat im Produktkatalog. Das Matching ist ein
// strikter Teilstring-Vergleich, "Gin" allein findet also nichts – es braucht
// die Hausmarke ("Bombay Sapphire Gin"). Gibt null zurück, wenn nichts passt
// oder das Produkt keinen brauchbaren Wert hat.
function abvAusKatalog(name) {
  if (!name) return null;
  const produkt = getProduct(name);
  return produkt ? parseAbv(produkt.abv) : null;
}

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
      <input class="ing-abv" type="number" min="0" max="100" step="0.1" placeholder="% vol" title="Alkoholgehalt – nur für den Flaschen-Modus" />
      <button type="button" class="remove-btn" title="Entfernen">✕</button>
    `;

    const nameEl = row.querySelector(".ing-name");
    const abvEl = row.querySelector(".ing-abv");

    // Alkoholgehalt aus dem Katalog vorbelegen, aber nie einen Wert
    // überschreiben, den jemand selbst eingetragen hat.
    function abvVorbelegen() {
      if (abvEl.value !== "") return;
      const wert = abvAusKatalog(nameEl.value.trim());
      if (wert !== null) abvEl.value = wert;
    }

    abvVorbelegen();
    nameEl.addEventListener("blur", abvVorbelegen);
    nameEl.addEventListener("change", abvVorbelegen);

    row.querySelector(".remove-btn").addEventListener("click", () => row.remove());
    return row;
  }

  function addRow(data) {
    containerEl.appendChild(makeRow(data));
  }

  function getIngredients() {
    return [...containerEl.querySelectorAll(".ingredient-row")]
      .map((row) => {
        const abvRoh = row.querySelector(".ing-abv").value;
        return {
          name: row.querySelector(".ing-name").value.trim(),
          amount: parseFloat(row.querySelector(".ing-amount").value),
          unit: row.querySelector(".ing-unit").value,
          // null bedeutet ausdrücklich "unbekannt" – nicht 0. Aufrufer müssen
          // das sichtbar machen, statt stillschweigend alkoholfrei zu rechnen.
          abv: abvRoh === "" ? null : parseFloat(abvRoh),
        };
      })
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
