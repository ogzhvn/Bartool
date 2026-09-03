import { saveProduct, deleteProduct, onProductsChanged } from "./storage.js";
import { escapeHtml } from "./utils.js";
import { exportProductsToExcel, exportProductsToWord } from "./productExport.js";
import { printProducts } from "./printView.js";
import { getAllProducts, getProduct, isCustomProduct, getRecipesUsingProduct } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { onRecipesChanged } from "./storage.js";
import { isAdmin } from "./auth.js";
import { submitChangeRequest } from "./changeRequests.js";
import { switchTab, closeMobileNav, takePendingEditReturn } from "./tabs.js";

// Wein/Schaumwein stehen bewusst am Ende – Wein ist eine eigene
// Hauptkategorie unten in der Navigation, nicht zwischen den Spirituosen.
// "Wein" vor "Schaumwein", damit beim Klick auf die Oberkategorie "Wein"
// (ohne gewählte Weinart) Weißwein/Roséwein/Rotwein vor Schaumwein stehen.
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
  "Bier",
  "Sirup",
  "Fruchtpüree",
  "Saft",
  "Mixer & Softdrink",
  "Tee & Kaffee",
  "Sonstiges",
  "Wein",
  "Schaumwein",
];

function groupSortIndex(group) {
  const i = GROUP_ORDER.indexOf(group);
  return i === -1 ? GROUP_ORDER.length : i;
}

// Oberkategorien für die Kategorie-Navigation in der Sidebar unter
// "Bibliothek → Produkte". Jede Gruppe aus GROUP_ORDER gehört genau einer
// Oberkategorie an. "Wein" steht bewusst zuletzt und trägt die Weinarten
// (WEINTYPEN) als verschachtelte Unterkategorien.
const OBERKATEGORIEN = [
  { name: "Spirituosen", groups: ["Gin", "Vodka", "Rum & Cachaça", "Whisky", "Tequila & Mezcal", "Brände", "Absinth"] },
  { name: "Liköre & Bitters", groups: ["Liköre & Aperitifs", "Wermut & Aperitif-Wein", "Bitters"] },
  { name: "Sirups & Frucht", groups: ["Sirup", "Fruchtpüree"] },
  { name: "Softdrinks & Mixer", groups: ["Saft", "Mixer & Softdrink", "Tee & Kaffee"] },
  { name: "Bier", groups: ["Bier"] },
  { name: "Sonstiges", groups: ["Sonstiges"] },
  { name: "Wein", groups: ["Wein", "Schaumwein"] },
];

let activeOberkategorie = null;

// Untertypen innerhalb der Oberkategorie "Wein" – zweite Navigationsebene,
// die nur eingeblendet wird, wenn "Wein" aktiv ist.
const WEINTYPEN = [
  { name: "Weißwein", group: "Wein", subGroup: "Weißwein" },
  { name: "Roséwein", group: "Wein", subGroup: "Roséwein" },
  { name: "Rotwein", group: "Wein", subGroup: "Rotwein" },
  { name: "Schaumwein", group: "Schaumwein", subGroup: null },
];

let activeWeinTyp = null;

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
  Wein: WEINTYPEN.filter((typ) => typ.group === "Wein").map((typ) => typ.subGroup),
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
const regionEl = document.getElementById("product-region");
const grapeVarietyEl = document.getElementById("product-grape-variety");
const vineyardEl = document.getElementById("product-vineyard");
const vintageEl = document.getElementById("product-vintage");
const agingEl = document.getElementById("product-aging");
const drinkingWindowEl = document.getElementById("product-drinking-window");
const tastingNotesEl = document.getElementById("product-tasting-notes");
const foodPairingEl = document.getElementById("product-food-pairing");
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

function parsePairsWith(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const listViewEl = document.getElementById("products-list-view");
const editViewEl = document.getElementById("products-edit-view");
const listEl = document.getElementById("product-list");
const searchEl = document.getElementById("product-search");
const groupFilterEl = document.getElementById("product-group-filter");
const categoryTreeEl = document.getElementById("product-category-tree");
const groupOptionsEl = document.getElementById("product-group-options");
const subgroupOptionsEl = document.getElementById("product-subgroup-options");
const sidebarListEl = document.getElementById("product-sidebar-list");
const sidebarSearchEl = document.getElementById("product-sidebar-search");
const selectedCountEl = document.getElementById("product-selected-count");
const selectAllBtn = document.getElementById("product-select-all");
const selectNoneBtn = document.getElementById("product-select-none");
const exportExcelBtn = document.getElementById("product-export-excel");
const exportWordBtn = document.getElementById("product-export-word");
const printBtn = document.getElementById("product-print");

// Namen der für den Export angehakten Produkte (überlebt Neurendern der Liste).
const selectedNames = new Set();

function updateExportBar() {
  selectedCountEl.textContent = `${selectedNames.size} ausgewählt`;
  exportExcelBtn.disabled = selectedNames.size === 0;
  exportWordBtn.disabled = selectedNames.size === 0;
  printBtn.disabled = selectedNames.size === 0;
}

let editingOriginalName = null;
// Scroll-Position der Liste, gemerkt beim Öffnen des Formulars aus der
// Liste heraus, damit man nach dem Speichern/Löschen/Zurück wieder an der
// gleichen Stelle landet statt oben in der Liste.
let savedListScrollY = null;

function showListView() {
  listViewEl.classList.add("active");
  editViewEl.classList.remove("active");
}

function showEditView() {
  editViewEl.classList.add("active");
  listViewEl.classList.remove("active");
}

// Verlässt die Bearbeiten-Ansicht: normalerweise zurück zur Produktliste,
// außer man ist per Datenqualität-Sprung aus einem anderen Tab hierher
// gekommen – dann zurück auf die Ausgangsseite mit der ursprünglichen
// Scroll-Position.
function exitEditView() {
  const target = takePendingEditReturn();
  showListView();
  if (target) {
    switchTab(target.tabId);
    requestAnimationFrame(() => window.scrollTo({ top: target.scrollY }));
  } else if (savedListScrollY !== null) {
    const y = savedListScrollY;
    savedListScrollY = null;
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  }
}

const FIELDS = [
  ["name", nameEl],
  ["category", categoryEl],
  ["group", groupEl],
  ["subGroup", subgroupEl],
  ["abv", abvEl],
  ["region", regionEl],
  ["grapeVariety", grapeVarietyEl],
  ["vineyard", vineyardEl],
  ["vintage", vintageEl],
  ["aging", agingEl],
  ["drinkingWindow", drinkingWindowEl],
  ["tastingNotes", tastingNotesEl],
  ["foodPairing", foodPairingEl],
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
  editingOriginalName = null;
  renderSidebarList();
}

function loadIntoForm(product) {
  FIELDS.forEach(([key, el]) => (el.value = product[key] ?? (key === "priceUnit" ? "liter" : "")));
  priceValueEl.value = product.priceValue || "";
  pairsWithEl.value = (product.pairsWith ?? []).join(", ");
  editingOriginalName = product.name;
  renderSidebarList();
}

async function handleSave() {
  const name = nameEl.value.trim();
  if (!name) {
    alert("Bitte einen Produktnamen eingeben.");
    return;
  }
  const product = {};
  FIELDS.forEach(([key, el]) => (product[key] = key === "name" ? name : el.value.trim()));
  product.priceValue = parseFloat(priceValueEl.value) || 0;
  const pairsWith = parsePairsWith(pairsWithEl.value);
  if (pairsWith.length > 0) product.pairsWith = pairsWith;

  // Mitarbeitende schreiben nicht direkt (RLS erlaubt nur Admins), sondern
  // reichen den Vorschlag zur Prüfung ein.
  if (!isAdmin()) {
    try {
      await submitChangeRequest("products", product);
      alert("Danke! Dein Vorschlag wurde zur Prüfung an einen Admin eingereicht.");
      resetForm();
      exitEditView();
    } catch (error) {
      alert("Vorschlag konnte nicht eingereicht werden: " + error.message);
    }
    return;
  }

  try {
    if (editingOriginalName && editingOriginalName !== name && isCustomProduct(editingOriginalName)) {
      await deleteProduct(editingOriginalName);
    }
    await saveProduct(product);
    editingOriginalName = name;
    exitEditView();
  } catch (error) {
    alert("Produkt konnte nicht gespeichert werden: " + error.message);
  }
}

async function handleDelete() {
  if (!editingOriginalName) {
    alert("Bitte zuerst ein Produkt auswählen.");
    return;
  }
  if (!isCustomProduct(editingOriginalName)) {
    alert("Dieses Produkt stammt aus dem Grundkatalog und wurde noch nicht in deinem Bestand gespeichert – es gibt nichts zu löschen.");
    return;
  }

  if (!isAdmin()) {
    if (!confirm(`Löschung von "${editingOriginalName}" zur Prüfung vorschlagen?`)) return;
    try {
      await submitChangeRequest("products", { name: editingOriginalName }, "delete");
      alert("Danke! Der Löschvorschlag wurde zur Prüfung an einen Admin eingereicht.");
      resetForm();
      exitEditView();
    } catch (error) {
      alert("Vorschlag konnte nicht eingereicht werden: " + error.message);
    }
    return;
  }

  if (!confirm(`Produkt "${editingOriginalName}" wirklich löschen?`)) return;
  try {
    await deleteProduct(editingOriginalName);
    resetForm();
    exitEditView();
  } catch (error) {
    alert("Produkt konnte nicht gelöscht werden: " + error.message);
  }
}

function currentFilteredProducts() {
  const query = searchEl.value.trim().toLowerCase();
  const groupFilter = groupFilterEl.value;
  return getAllProducts().filter((p) => {
    const matchesQuery = p.name.toLowerCase().includes(query) || (p.category ?? "").toLowerCase().includes(query);
    const matchesGroup = !groupFilter || p.group === groupFilter;
    const matchesOberkategorie = !activeOberkategorie || activeOberkategorie.groups.includes(p.group);
    const matchesWeinTyp =
      !activeWeinTyp ||
      (p.group === activeWeinTyp.group && (activeWeinTyp.subGroup === null || p.subGroup === activeWeinTyp.subGroup));
    return matchesQuery && matchesGroup && matchesOberkategorie && matchesWeinTyp;
  });
}

// Kategorie-Baum in der Sidebar unter "Bibliothek → Produkte": Oberkategorien
// als Hauptpunkte, die Weinarten als eingerückte Unterpunkte unter "Wein".
// Ein Klick wechselt in den Produkte-Tab und setzt den Filter.
function renderSidebarCategoryTree() {
  categoryTreeEl.innerHTML = "";

  const makeBtn = (label, { oberkategorie = null, weinTyp = null, nested = false } = {}) => {
    const isActive = activeOberkategorie === oberkategorie && activeWeinTyp === weinTyp;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subnav-btn" + (nested ? " subnav-btn--nested" : "") + (isActive ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      switchTab("products");
      // Wie bei den Haupt-Tabs: Detail-/Bearbeiten-Ansicht verlassen und die
      // mobile Navigation schließen, sonst bleibt die Liste unter dem
      // aufgeklappten Menü verborgen und die Kategorie wirkt "tot".
      showListView();
      closeMobileNav();
      activeOberkategorie = oberkategorie;
      activeWeinTyp = weinTyp;
      groupFilterEl.value = "";
      updateGroupFilterVisibility();
      populateGroupFilter();
      renderSidebarCategoryTree();
      renderBrowseList();
      window.scrollTo({ top: 0 });
    });
    return btn;
  };

  OBERKATEGORIEN.forEach((ok) => {
    categoryTreeEl.appendChild(makeBtn(ok.name, { oberkategorie: ok }));
    if (ok.name === "Wein") {
      WEINTYPEN.forEach((typ) =>
        categoryTreeEl.appendChild(makeBtn(typ.name, { oberkategorie: ok, weinTyp: typ, nested: true }))
      );
    }
  });
}

function updateGroupFilterVisibility() {
  // Innerhalb "Wein" übernehmen die Weinart-Unterpunkte in der Sidebar die
  // Filterung, das generische Kategorie-Dropdown wäre dort redundant.
  groupFilterEl.hidden = activeOberkategorie?.name === "Wein";
}

// `product.region` ist Freitext nach dem Muster "<Ort>, <Anbaugebiet> (<Land>)"
// bzw. "<Anbaugebiet> (<Land>)". Das Land steht als letzte Klammer am Ende,
// das Anbaugebiet ist das Segment direkt davor. Bei unklaren/unverifizierten
// Klammerinhalten (siehe "Chapeau Secco") wird nicht geraten, sondern der
// komplette Text als eigene Gruppe belassen.
function parseWineOrigin(regionStr) {
  const fallback = { country: (regionStr || "").trim() || "Ohne Herkunft", subregion: null };
  if (!regionStr) return fallback;
  const match = regionStr.match(/^(.*)\(([^()]+)\)\s*$/);
  if (!match) return fallback;
  const country = match[2].trim();
  if (!country || country.length > 30 || /[,/]/.test(country)) return fallback;
  const parts = match[1]
    .replace(/,\s*$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const subregion = parts.length > 0 ? parts[parts.length - 1] : null;
  return { country, subregion };
}

// Gruppierung für die Weinart-Ansicht (rechtes Fenster): erst nach Land,
// Deutschland immer zuerst, danach alphabetisch. Innerhalb eines Landes nach
// Anbaugebiet sortiert, mit eigenem Zwischenkopf pro Anbaugebiet.
function groupWinesByOrigin(products) {
  const countries = new Map();
  products.forEach((product) => {
    const { country, subregion } = parseWineOrigin(product.region);
    if (!countries.has(country)) countries.set(country, new Map());
    const subregions = countries.get(country);
    const key = subregion || "";
    if (!subregions.has(key)) subregions.set(key, []);
    subregions.get(key).push(product);
  });

  return [...countries.entries()]
    .sort(([a], [b]) => {
      if (a === "Deutschland") return -1;
      if (b === "Deutschland") return 1;
      return a.localeCompare(b, "de");
    })
    .map(([country, subregions]) => ({
      country,
      subregions: [...subregions.entries()].sort(([a], [b]) => a.localeCompare(b, "de")),
    }));
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

function formatPrice(product) {
  if (!product.priceValue) return "";
  const unitLabel = product.priceUnit === "stueck" ? "Stück" : "Liter";
  return `${product.priceValue.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € / ${unitLabel}`;
}

function renderProductItem(product) {
  const metaRows = [
    ["Kategorie & Herkunft", product.category],
    ["Alkoholgehalt", product.abv],
    ["Region", product.region],
    ["Rebsorte", product.grapeVariety],
    ["Lage", product.vineyard],
    ["Jahrgang", product.vintage],
    ["Ausbau", product.aging],
    ["Trinkfenster", product.drinkingWindow],
    ["Tasting Notes", product.tastingNotes],
    ["Speiseempfehlung", product.foodPairing],
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
    <summary>
      <span class="recipe-item-title">
        <input type="checkbox" class="product-select-checkbox" ${selectedNames.has(product.name) ? "checked" : ""} />
        ${escapeHtml(product.name)}
      </span>
    </summary>
    <div class="recipe-item-body">
      ${metaRows.map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join("")}
      ${usedIn.length > 0 ? `<p><strong>Verwendet in:</strong> ${usedIn.map((r) => escapeHtml(r.name)).join(", ")}</p>` : ""}
      <div class="actions">
        <button type="button" class="btn-secondary edit-btn">${isAdmin() ? "Bearbeiten" : "Änderung vorschlagen"}</button>
        ${isCustomProduct(product.name) ? `<button type="button" class="btn-secondary delete-btn">${isAdmin() ? "Löschen" : "Löschung vorschlagen"}</button>` : ""}
      </div>
    </div>
  `;
  const checkbox = item.querySelector(".product-select-checkbox");
  checkbox.addEventListener("click", (e) => e.stopPropagation());
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      selectedNames.add(product.name);
    } else {
      selectedNames.delete(product.name);
    }
    updateExportBar();
  });
  const editBtn = item.querySelector(".edit-btn");
  if (editBtn) {
    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      savedListScrollY = window.scrollY;
      loadIntoForm(product);
      showEditView();
    });
  }
  const deleteBtn = item.querySelector(".delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!isAdmin()) {
        if (!confirm(`Löschung von "${product.name}" zur Prüfung vorschlagen?`)) return;
        try {
          await submitChangeRequest("products", { name: product.name }, "delete");
          alert("Danke! Der Löschvorschlag wurde zur Prüfung an einen Admin eingereicht.");
        } catch (error) {
          alert("Vorschlag konnte nicht eingereicht werden: " + error.message);
        }
        return;
      }
      if (!confirm(`Produkt "${product.name}" wirklich löschen?`)) return;
      try {
        if (editingOriginalName === product.name) resetForm();
        await deleteProduct(product.name);
      } catch (error) {
        alert("Produkt konnte nicht gelöscht werden: " + error.message);
      }
    });
  }
  return item;
}

function renderBrowseList() {
  const products = currentFilteredProducts();

  if (products.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Keine Produkte gefunden.</p>`;
    updateExportBar();
    return;
  }
  listEl.innerHTML = "";

  // Innerhalb eines gewählten Weintyps (Weiß/Rosé/Rot/Schaumwein) wird nach
  // Herkunftsland (Deutschland zuerst) und darunter nach Anbaugebiet sortiert.
  if (activeWeinTyp) {
    groupWinesByOrigin(products).forEach(({ country, subregions }) => {
      const header = document.createElement("h3");
      header.className = "product-group-header";
      header.textContent = country;
      listEl.appendChild(header);
      subregions.forEach(([subregion, items]) => {
        if (subregion) {
          const subHeader = document.createElement("h4");
          subHeader.className = "product-subgroup-header";
          subHeader.textContent = subregion;
          listEl.appendChild(subHeader);
        }
        items
          .sort((a, b) => a.name.localeCompare(b.name, "de"))
          .forEach((product) => listEl.appendChild(renderProductItem(product)));
      });
    });
    updateExportBar();
    return;
  }

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
  updateExportBar();
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
  const groups = [...new Set(getAllProducts().map((p) => p.group).filter(Boolean))]
    .filter((g) => !activeOberkategorie || activeOberkategorie.groups.includes(g))
    .sort((a, b) => groupSortIndex(a) - groupSortIndex(b) || a.localeCompare(b, "de"));
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

// Setzt die Kategorie-/Weinart-Filter zurück auf "Alle" – aufgerufen, wenn
// "Produkte" direkt angeklickt wird (Sidebar-Button oder Start-Kachel), statt
// über einen Unterpunkt im Kategorie-Baum.
function resetCategoryFilters() {
  activeOberkategorie = null;
  activeWeinTyp = null;
  groupFilterEl.value = "";
  updateGroupFilterVisibility();
  populateGroupFilter();
  renderSidebarCategoryTree();
  renderBrowseList();
}

// Springt vom Datenqualität-Dashboard im Admin-Tab direkt ins Bearbeiten-
// Formular eines Produkts (Aufrufer wechselt vorher per switchTab("products")).
export function openProductForEdit(name) {
  const product = getProduct(name);
  if (!product) return;
  loadIntoForm(product);
  showEditView();
}

export function initProducts() {
  if (!isAdmin()) {
    document.getElementById("product-save").textContent = "Vorschlag einreichen";
    document.getElementById("product-delete").textContent = "Löschung vorschlagen";
  }
  document.getElementById("product-save").addEventListener("click", handleSave);
  document.getElementById("product-new").addEventListener("click", resetForm);
  document.getElementById("product-delete").addEventListener("click", handleDelete);
  document.getElementById("product-list-new").addEventListener("click", () => {
    savedListScrollY = window.scrollY;
    resetForm();
    showEditView();
  });
  document.getElementById("product-back-to-list").addEventListener("click", exitEditView);
  document.getElementById("product-sidebar-new").addEventListener("click", resetForm);
  searchEl.addEventListener("input", renderBrowseList);
  groupFilterEl.addEventListener("change", renderBrowseList);
  sidebarSearchEl.addEventListener("input", renderSidebarList);
  selectAllBtn.addEventListener("click", () => {
    currentFilteredProducts().forEach((p) => selectedNames.add(p.name));
    renderBrowseList();
  });
  selectNoneBtn.addEventListener("click", () => {
    selectedNames.clear();
    renderBrowseList();
  });
  exportExcelBtn.addEventListener("click", () => {
    const products = getAllProducts().filter((p) => selectedNames.has(p.name));
    if (products.length > 0) exportProductsToExcel(products);
  });
  exportWordBtn.addEventListener("click", () => {
    const products = getAllProducts().filter((p) => selectedNames.has(p.name));
    if (products.length > 0) exportProductsToWord(products);
  });
  printBtn.addEventListener("click", () => {
    printProducts(getAllProducts().filter((p) => selectedNames.has(p.name)));
  });
  // "Produkte" direkt anklicken (Sidebar-Button, Start-Kachel) zeigt wieder
  // den vollen Katalog statt in der zuletzt gewählten Kategorie zu bleiben.
  document.querySelectorAll('[data-tab="products"]').forEach((el) => {
    el.addEventListener("click", resetCategoryFilters);
  });
  onProductsChanged(() => {
    populateGroupFilter();
    populateDatalists();
    populatePairsWithOptions();
    renderSidebarCategoryTree();
    renderBrowseList();
    renderSidebarList();
  });
  // "Verwendet in" (used in) cross-references the recipe book, so refresh
  // the browse list when recipes change too.
  onRecipesChanged(() => {
    populatePairsWithOptions();
    renderBrowseList();
  });
  updateGroupFilterVisibility();
  populateGroupFilter();
  populateDatalists();
  populatePairsWithOptions();
  renderSidebarCategoryTree();
  renderBrowseList();
  renderSidebarList();
}
