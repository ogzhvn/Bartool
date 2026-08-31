import { saveProduct, deleteProduct, onProductsChanged } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { getAllProducts, isCustomProduct, getRecipesUsingProduct } from "./productLibrary.js";
import { onRecipesChanged } from "./storage.js";
import { switchTab } from "./tabs.js";

const nameEl = document.getElementById("product-name");
const categoryEl = document.getElementById("product-category");
const abvEl = document.getElementById("product-abv");
const tastingNotesEl = document.getElementById("product-tasting-notes");
const serviceEl = document.getElementById("product-service");
const alternativesEl = document.getElementById("product-alternatives");
const storyEl = document.getElementById("product-story");
const productionEl = document.getElementById("product-production");
const allergensEl = document.getElementById("product-allergens");

const listEl = document.getElementById("product-list");
const searchEl = document.getElementById("product-search");
const sidebarListEl = document.getElementById("product-sidebar-list");
const sidebarSearchEl = document.getElementById("product-sidebar-search");

let editingOriginalName = null;

const FIELDS = [
  ["name", nameEl],
  ["category", categoryEl],
  ["abv", abvEl],
  ["tastingNotes", tastingNotesEl],
  ["service", serviceEl],
  ["alternatives", alternativesEl],
  ["story", storyEl],
  ["production", productionEl],
  ["allergens", allergensEl],
];

function resetForm() {
  FIELDS.forEach(([, el]) => (el.value = ""));
  editingOriginalName = null;
  renderSidebarList();
}

function loadIntoForm(product) {
  FIELDS.forEach(([key, el]) => (el.value = product[key] ?? ""));
  editingOriginalName = product.name;
  renderSidebarList();
}

function handleSave() {
  const name = nameEl.value.trim();
  if (!name) {
    alert("Bitte einen Produktnamen eingeben.");
    return;
  }
  if (editingOriginalName && editingOriginalName !== name && isCustomProduct(editingOriginalName)) {
    deleteProduct(editingOriginalName);
  }
  const product = {};
  FIELDS.forEach(([key, el]) => (product[key] = key === "name" ? name : el.value.trim()));
  saveProduct(product);
  editingOriginalName = name;
}

function handleDelete() {
  if (!editingOriginalName) {
    alert("Bitte zuerst ein Produkt auswählen.");
    return;
  }
  if (!isCustomProduct(editingOriginalName)) {
    alert("Dieses Produkt stammt aus dem Grundkatalog und wurde noch nicht in deinem Bestand gespeichert – es gibt nichts zu löschen.");
    return;
  }
  if (!confirm(`Produkt "${editingOriginalName}" wirklich löschen?`)) return;
  deleteProduct(editingOriginalName);
  resetForm();
}

function currentFilteredProducts() {
  const query = searchEl.value.trim().toLowerCase();
  return getAllProducts().filter((p) => p.name.toLowerCase().includes(query) || (p.category ?? "").toLowerCase().includes(query));
}

function renderBrowseList() {
  const products = currentFilteredProducts();

  if (products.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Keine Produkte gefunden.</p>`;
    return;
  }
  listEl.innerHTML = "";
  products.forEach((product) => {
    const metaRows = [
      ["Kategorie & Herkunft", product.category],
      ["Alkoholgehalt", product.abv],
      ["Tasting Notes", product.tastingNotes],
      ["Serviervorschlag", product.service],
      ["Alternativen", product.alternatives],
      ["Story", product.story],
      ["Herstellung", product.production],
      ["Allergene", product.allergens],
    ].filter(([, value]) => value);

    const usedIn = getRecipesUsingProduct(product.name);

    const item = document.createElement("details");
    item.className = "recipe-item";
    item.innerHTML = `
      <summary>${escapeHtml(product.name)}</summary>
      <div class="recipe-item-body">
        ${metaRows.map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join("")}
        ${usedIn.length > 0 ? `<p><strong>Verwendet in:</strong> ${usedIn.map((r) => escapeHtml(r.name)).join(", ")}</p>` : ""}
        <div class="actions">
          <button type="button" class="btn-secondary edit-btn">Bearbeiten</button>
          ${isCustomProduct(product.name) ? `<button type="button" class="btn-secondary delete-btn">Löschen</button>` : ""}
        </div>
      </div>
    `;
    item.querySelector(".edit-btn").addEventListener("click", (e) => {
      e.preventDefault();
      loadIntoForm(product);
      switchTab("product-edit");
    });
    const deleteBtn = item.querySelector(".delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (!confirm(`Produkt "${product.name}" wirklich löschen?`)) return;
        if (editingOriginalName === product.name) resetForm();
        deleteProduct(product.name);
      });
    }
    listEl.appendChild(item);
  });
}

function renderSidebarList() {
  const query = sidebarSearchEl.value.trim().toLowerCase();
  const products = getAllProducts().filter((p) => p.name.toLowerCase().includes(query));

  if (products.length === 0) {
    sidebarListEl.innerHTML = `<p class="empty-note">Keine Produkte gefunden.</p>`;
    return;
  }
  sidebarListEl.innerHTML = "";
  products.forEach((product) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recipe-name-btn" + (product.name === editingOriginalName ? " active" : "");
    btn.textContent = product.name;
    btn.addEventListener("click", () => loadIntoForm(product));
    sidebarListEl.appendChild(btn);
  });
}

export function initProducts() {
  document.getElementById("product-save").addEventListener("click", handleSave);
  document.getElementById("product-new").addEventListener("click", resetForm);
  document.getElementById("product-delete").addEventListener("click", handleDelete);
  document.getElementById("product-list-new").addEventListener("click", () => {
    resetForm();
    switchTab("product-edit");
  });
  document.getElementById("product-sidebar-new").addEventListener("click", resetForm);
  searchEl.addEventListener("input", renderBrowseList);
  sidebarSearchEl.addEventListener("input", renderSidebarList);
  onProductsChanged(() => {
    renderBrowseList();
    renderSidebarList();
  });
  // "Verwendet in" (used in) cross-references the recipe book, so refresh
  // the browse list when recipes change too.
  onRecipesChanged(renderBrowseList);
  renderBrowseList();
  renderSidebarList();
}
