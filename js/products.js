import { saveProduct, deleteProduct, onProductsChanged, loadProducts } from "./storage.js";
import { escapeHtml, formatNumber } from "./utils.js";
import { isAdmin } from "./auth.js";

const nameEl = document.getElementById("product-name");
const categoryEl = document.getElementById("product-category");
const unitEl = document.getElementById("product-unit");
const priceEl = document.getElementById("product-price");
const noteEl = document.getElementById("product-note");
const listEl = document.getElementById("product-list");
const searchEl = document.getElementById("product-search");

let editingOriginalName = null;

function resetForm() {
  nameEl.value = "";
  categoryEl.value = "";
  unitEl.value = "";
  priceEl.value = "";
  noteEl.value = "";
  editingOriginalName = null;
}

function loadIntoForm(product) {
  nameEl.value = product.name;
  categoryEl.value = product.category ?? "";
  unitEl.value = product.unit ?? "";
  priceEl.value = product.price ?? "";
  noteEl.value = product.note ?? "";
  editingOriginalName = product.name;
}

async function handleSave() {
  const name = nameEl.value.trim();
  if (!name) {
    alert("Bitte einen Produktnamen eingeben.");
    return;
  }
  try {
    if (editingOriginalName && editingOriginalName !== name) {
      await deleteProduct(editingOriginalName);
    }
    await saveProduct({
      name,
      category: categoryEl.value.trim(),
      unit: unitEl.value.trim(),
      price: priceEl.value.trim(),
      note: noteEl.value.trim(),
    });
    editingOriginalName = name;
  } catch (error) {
    alert("Produkt konnte nicht gespeichert werden: " + error.message);
  }
}

async function handleDelete() {
  if (!editingOriginalName) {
    alert("Bitte zuerst ein Produkt auswählen.");
    return;
  }
  if (!confirm(`Produkt "${editingOriginalName}" wirklich löschen?`)) return;
  try {
    await deleteProduct(editingOriginalName);
    resetForm();
  } catch (error) {
    alert("Produkt konnte nicht gelöscht werden: " + error.message);
  }
}

function currentFilteredProducts() {
  const query = searchEl.value.trim().toLowerCase();
  return loadProducts().filter((p) => p.name.toLowerCase().includes(query));
}

function renderList() {
  const products = currentFilteredProducts();

  if (products.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Keine Produkte gefunden.</p>`;
    return;
  }
  listEl.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Kategorie</th><th>Einheit</th><th>Preis</th><th>Notiz</th>${isAdmin() ? "<th></th>" : ""}</tr></thead>
      <tbody>
        ${products
          .map(
            (p) => `
          <tr data-name="${escapeHtml(p.name)}">
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.category)}</td>
            <td>${escapeHtml(p.unit)}</td>
            <td>${p.price !== "" ? formatNumber(Number(p.price)) : ""}</td>
            <td>${escapeHtml(p.note)}</td>
            ${isAdmin() ? `<td><button type="button" class="btn-secondary edit-btn">Bearbeiten</button></td>` : ""}
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  listEl.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.closest("tr").dataset.name;
      const product = loadProducts().find((p) => p.name === name);
      if (product) loadIntoForm(product);
    });
  });
}

export function initProducts() {
  document.getElementById("product-save").addEventListener("click", handleSave);
  document.getElementById("product-new").addEventListener("click", resetForm);
  document.getElementById("product-delete").addEventListener("click", handleDelete);
  searchEl.addEventListener("input", renderList);
  onProductsChanged(renderList);
  resetForm();
  renderList();
}
