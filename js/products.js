import { saveProduct, deleteProduct, onProductsChanged } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { getAllProducts, isCustomProduct, getRecipesUsingProduct } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
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
  "Mixer & Softdrink",
  "Tee & Kaffee",
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
const priceValueEl = document.getElementById("product-price-value");
const priceUnitEl = document.getElementById("product-price-unit");
const quickPitchEl = document.getElementById("product-quick-pitch");
const pairsWithEl = document.getElementById("product-pairs-with");
const pairsWithOptionsEl = document.getElementById("pairs-with-options");

const FLAVOR_DIMENSIONS = ["suess", "sauer", "bitter", "herbKraeuterig", "fruchtig", "wuerzigScharf", "floral", "rauchig"];
const flavorEls = Object.fromEntries(
  FLAVOR_DIMENSIONS.map((dim) => [dim, document.getElementById(`product-flavor-${dim}`)])
);

function updateFlavorOutputs() {
  FLAVOR_DIMENSIONS.forEach((dim) => {
    const el = flavorEls[dim];
    el.nextElementSibling.textContent = el.value;
  });
}

function resetFlavorProfile() {
  FLAVOR_DIMENSIONS.forEach((dim) => (flavorEls[dim].value = 0));
  updateFlavorOutputs();
}

function loadFlavorProfileIntoForm(product) {
  const profile = product.flavorProfile;
  FLAVOR_DIMENSIONS.forEach((dim) => (flavorEls[dim].value = profile?.[dim] ?? 0));
  updateFlavorOutputs();
}

// Returns null (not an all-zero object) when every dimension is 0, so an
// untouched/"unknown" profile doesn't get treated as a real (if faint) one.
function collectFlavorProfileFromForm() {
  const profile = {};
  let anyNonZero = false;
  FLAVOR_DIMENSIONS.forEach((dim) => {
    const value = parseInt(flavorEls[dim].value, 10) || 0;
    profile[dim] = value;
    if (value > 0) anyNonZero = true;
  });
  return anyNonZero ? profile : null;
}

function parsePairsWith(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

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
  ["quickPitch", quickPitchEl],
  ["priceUnit", priceUnitEl],
];

function resetForm() {
  FIELDS.forEach(([key, el]) => (el.value = key === "priceUnit" ? "liter" : ""));
  priceValueEl.value = "";
  pairsWithEl.value = "";
  resetFlavorProfile();
  editingOriginalName = null;
  renderSidebarList();
}

function loadIntoForm(product) {
  FIELDS.forEach(([key, el]) => (el.value = product[key] ?? (key === "priceUnit" ? "liter" : "")));
  priceValueEl.value = product.priceValue || "";
  pairsWithEl.value = (product.pairsWith ?? []).join(", ");
  loadFlavorProfileIntoForm(product);
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
  product.priceValue = parseFloat(priceValueEl.value) || 0;
  const pairsWith = parsePairsWith(pairsWithEl.value);
  if (pairsWith.length > 0) product.pairsWith = pairsWith;
  const flavorProfile = collectFlavorProfileFromForm();
  if (flavorProfile) product.flavorProfile = flavorProfile;
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

const FLAVOR_LABELS = {
  suess: "Süß",
  sauer: "Sauer",
  bitter: "Bitter",
  herbKraeuterig: "Herb/Kräuterig",
  fruchtig: "Fruchtig",
  wuerzigScharf: "Würzig/Scharf",
  floral: "Floral",
  rauchig: "Rauchig",
};

function formatFlavorProfile(profile) {
  if (!profile) return "";
  return FLAVOR_DIMENSIONS.filter((dim) => profile[dim] > 0)
    .map((dim) => `${FLAVOR_LABELS[dim]} ${profile[dim]}`)
    .join(" · ");
}

function formatPrice(product) {
  if (!product.priceValue) return "";
  const unitLabel = product.priceUnit === "stueck" ? "Stück" : "Liter";
  return `${product.priceValue.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € / ${unitLabel}`;
}

function renderProductItem(product) {
  const metaRows = [
    ["Kategorie & Herkunft", product.category],
    ["Alkoholgehalt", product.abv],
    ["Tasting Notes", product.tastingNotes],
    ["Aromaprofil", formatFlavorProfile(product.flavorProfile)],
    ["Serviervorschlag", product.service],
    ["Alternativen", product.alternatives],
    ["Story", product.story],
    ["Herstellung", product.production],
    ["Allergene", product.allergens],
    ["Einkaufspreis", formatPrice(product)],
    ["Kurzer Pitch", product.quickPitch],
    ["Passt gut zu", (product.pairsWith ?? []).join(", ")],
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

// Shared by the "Passt gut zu" fields on both the product and the recipe edit
// form (index.html references the same <datalist id="pairs-with-options">).
function populatePairsWithOptions() {
  const names = [...new Set([...getAllProducts().map((p) => p.name), ...getAllRecipes().map((r) => r.name)])].sort(
    (a, b) => a.localeCompare(b, "de")
  );
  pairsWithOptionsEl.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
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
  FLAVOR_DIMENSIONS.forEach((dim) => flavorEls[dim].addEventListener("input", updateFlavorOutputs));
  updateFlavorOutputs();
  onProductsChanged(() => {
    populateGroupFilter();
    populateDatalists();
    populatePairsWithOptions();
    renderBrowseList();
    renderSidebarList();
  });
  // "Verwendet in" (used in) cross-references the recipe book, so refresh
  // the browse list when recipes change too.
  onRecipesChanged(() => {
    populatePairsWithOptions();
    renderBrowseList();
  });
  populateGroupFilter();
  populateDatalists();
  populatePairsWithOptions();
  renderBrowseList();
  renderSidebarList();
}
