import { saveProduct, deleteProduct, onProductsChanged } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { getAllProducts, isCustomProduct, getRecipesUsingProduct } from "./productLibrary.js";
import { onRecipesChanged } from "./storage.js";
import { switchTab } from "./tabs.js";

const GROUP_ORDER = [
  "Gin",
  "Vodka",
  "Rum & Cachaça",
  "Whisky",
  "Tequila & Mezcal",
  "Brände",
  "Liköre & Aperitifs",
  "Wermut & Aperitif-Wein",
  "Bitters",
  "Absinth",
  "Schaumwein",
  "Wein",
  "Bier",
  "Sirup",
  "Fruchtpüree",
  "Saft",
  "Frischware & Kräuter",
  "Mixer & Softdrink",
  "Tee & Kaffee",
  "Bar-Zubehör & Non-Food",
  "Sonstiges",
];

function groupSortIndex(group) {
  const i = GROUP_ORDER.indexOf(group);
  return i === -1 ? GROUP_ORDER.length : i;
}

// Scotch Single Malt regions – kept together and above the other whisky styles
// instead of falling wherever they land alphabetically (e.g. "Irish Whiskey"
// would otherwise sort between "Islay" and "Lowland").
const SCOTCH_SINGLE_MALT_REGIONS = ["Lowland", "Speyside", "Highland", "Islands", "Islay", "Campbeltown"];

const SUBGROUP_ORDER = {
  Whisky: [
    "Blended Scotch",
    ...SCOTCH_SINGLE_MALT_REGIONS,
    "Bourbon",
    "Rye",
    "Irish Whiskey",
    "Japanischer Whisky",
    "Kanadischer Whisky",
  ],
};

function subgroupSortIndex(group, subGroup) {
  const order = SUBGROUP_ORDER[group];
  if (!order) return -1;
  const i = order.indexOf(subGroup);
  return i === -1 ? order.length : i;
}

const nameEl = document.getElementById("product-name");
const categoryEl = document.getElementById("product-category");
const groupEl = document.getElementById("product-group");
const subgroupEl = document.getElementById("product-subgroup");
const abvEl = document.getElementById("product-abv");
const tastingNotesEl = document.getElementById("product-tasting-notes");
const serviceEl = document.getElementById("product-service");
const alternativesEl = document.getElementById("product-alternatives");
const storyEl = document.getElementById("product-story");
const productionEl = document.getElementById("product-production");
const allergensEl = document.getElementById("product-allergens");

const listEl = document.getElementById("product-list");
const searchEl = document.getElementById("product-search");
const groupFilterEl = document.getElementById("product-group-filter");
const groupOptionsEl = document.getElementById("product-group-options");
const subgroupOptionsEl = document.getElementById("product-subgroup-options");
const sidebarListEl = document.getElementById("product-sidebar-list");
const sidebarSearchEl = document.getElementById("product-sidebar-search");

let editingOriginalName = null;

const FIELDS = [
  ["name", nameEl],
  ["category", categoryEl],
  ["group", groupEl],
  ["subGroup", subgroupEl],
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
  const groupFilter = groupFilterEl.value;
  return getAllProducts().filter((p) => {
    const matchesQuery = p.name.toLowerCase().includes(query) || (p.category ?? "").toLowerCase().includes(query);
    const matchesGroup = !groupFilter || p.group === groupFilter;
    return matchesQuery && matchesGroup;
  });
}

function groupProducts(products) {
  const groups = new Map();
  products.forEach((product) => {
    const groupName = product.group || "Sonstiges";
    if (!groups.has(groupName)) groups.set(groupName, new Map());
    const subgroups = groups.get(groupName);
    const subGroupName = product.subGroup || "";
    if (!subgroups.has(subGroupName)) subgroups.set(subGroupName, []);
    subgroups.get(subGroupName).push(product);
  });

  return [...groups.entries()]
    .sort(([a], [b]) => groupSortIndex(a) - groupSortIndex(b) || a.localeCompare(b, "de"))
    .map(([groupName, subgroups]) => ({
      groupName,
      subgroups: [...subgroups.entries()].sort(
        ([a], [b]) =>
          subgroupSortIndex(groupName, a) - subgroupSortIndex(groupName, b) || a.localeCompare(b, "de")
      ),
    }));
}

function renderProductItem(product) {
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
  return item;
}

function renderBrowseList() {
  const products = currentFilteredProducts();

  if (products.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Keine Produkte gefunden.</p>`;
    return;
  }
  listEl.innerHTML = "";
  groupProducts(products).forEach(({ groupName, subgroups }) => {
    const header = document.createElement("h3");
    header.className = "product-group-header";
    header.textContent = groupName;
    listEl.appendChild(header);

    subgroups.forEach(([subGroupName, items], i) => {
      if (groupName === "Whisky" && SCOTCH_SINGLE_MALT_REGIONS.includes(subGroupName)) {
        const previousSubGroupName = i > 0 ? subgroups[i - 1][0] : null;
        if (!SCOTCH_SINGLE_MALT_REGIONS.includes(previousSubGroupName)) {
          const superHeader = document.createElement("h4");
          superHeader.className = "product-supergroup-header";
          superHeader.textContent = "Single Malt Scotch";
          listEl.appendChild(superHeader);
        }
      }
      if (subGroupName) {
        const subHeader = document.createElement("h4");
        subHeader.className = "product-subgroup-header";
        subHeader.textContent = subGroupName;
        listEl.appendChild(subHeader);
      }
      items
        .sort((a, b) => a.name.localeCompare(b.name, "de"))
        .forEach((product) => listEl.appendChild(renderProductItem(product)));
    });
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

function populateGroupFilter() {
  const groups = [...new Set(getAllProducts().map((p) => p.group).filter(Boolean))].sort(
    (a, b) => groupSortIndex(a) - groupSortIndex(b) || a.localeCompare(b, "de")
  );
  const currentValue = groupFilterEl.value;
  groupFilterEl.innerHTML =
    `<option value="">Alle Kategorien</option>` +
    groups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  if (groups.includes(currentValue)) groupFilterEl.value = currentValue;
}

function populateDatalists() {
  const products = getAllProducts();
  const groups = [...new Set(products.map((p) => p.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  const subgroups = [...new Set(products.map((p) => p.subGroup).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  groupOptionsEl.innerHTML = groups.map((g) => `<option value="${escapeHtml(g)}"></option>`).join("");
  subgroupOptionsEl.innerHTML = subgroups.map((s) => `<option value="${escapeHtml(s)}"></option>`).join("");
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
  groupFilterEl.addEventListener("change", renderBrowseList);
  sidebarSearchEl.addEventListener("input", renderSidebarList);
  onProductsChanged(() => {
    populateGroupFilter();
    populateDatalists();
    renderBrowseList();
    renderSidebarList();
  });
  // "Verwendet in" (used in) cross-references the recipe book, so refresh
  // the browse list when recipes change too.
  onRecipesChanged(renderBrowseList);
  populateGroupFilter();
  populateDatalists();
  renderBrowseList();
  renderSidebarList();
}
