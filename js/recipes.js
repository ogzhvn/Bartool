import { saveRecipe, deleteRecipe, onRecipesChanged } from "./storage.js";
import { createIngredientEditor } from "./ingredientEditor.js";
import { escapeHtml, formatNumber } from "./utils.js";
import { getAllRecipes, getRecipe, isCustomRecipe } from "./recipeLibrary.js";
import { UNIT_LABELS } from "./units.js";
import { exportRecipesToExcel, exportRecipesToWord } from "./recipeExport.js";
import { isAdmin } from "./auth.js";
import { submitChangeRequest } from "./changeRequests.js";
import { switchTab, closeMobileNav, takePendingEditReturn } from "./tabs.js";

const CATEGORY_ORDER = [
  "Gin",
  "Vodka",
  "Rum & Cachaça",
  "Whisky",
  "Tequila & Mezcal",
  "Brände",
  "Aperitivo & Spritz",
  "Sekt & Champagner-Cocktails",
  "Bier-Cocktails",
  "Liköre & Amaro",
  "Alkoholfrei",
  "Sonstiges",
];

function categorySortIndex(category) {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

const listViewEl = document.getElementById("recipes-list-view");
const editViewEl = document.getElementById("recipes-edit-view");
const nameEl = document.getElementById("recipe-name");
const categoryEl = document.getElementById("recipe-category");
const categoryOptionsEl = document.getElementById("recipe-category-options");
const categoryFilterEl = document.getElementById("recipe-category-filter");
const categoryTreeEl = document.getElementById("recipe-category-tree");
const basePortionsEl = document.getElementById("recipe-base-portions");
const methodEl = document.getElementById("recipe-method");
const glassEl = document.getElementById("recipe-glass");
const garnishEl = document.getElementById("recipe-garnish");
const iceEl = document.getElementById("recipe-ice");
const historyEl = document.getElementById("recipe-history");
const quickPitchEl = document.getElementById("recipe-quick-pitch");
const pairsWithEl = document.getElementById("recipe-pairs-with");
const listEl = document.getElementById("recipe-list");
const ingredientsEl = document.getElementById("recipe-ingredients");
const searchEl = document.getElementById("recipe-search");
const sidebarListEl = document.getElementById("recipe-sidebar-list");
const sidebarSearchEl = document.getElementById("recipe-sidebar-search");
const selectedCountEl = document.getElementById("recipe-selected-count");
const selectAllBtn = document.getElementById("recipe-select-all");
const selectNoneBtn = document.getElementById("recipe-select-none");
const exportExcelBtn = document.getElementById("recipe-export-excel");
const exportWordBtn = document.getElementById("recipe-export-word");

const editor = createIngredientEditor(ingredientsEl);

let editingOriginalName = null;
const selectedNames = new Set();
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

// Verlässt die Bearbeiten-Ansicht: normalerweise zurück zur Rezeptliste,
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

function parsePairsWith(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resetForm() {
  nameEl.value = "";
  categoryEl.value = "";
  basePortionsEl.value = 1;
  methodEl.value = "";
  glassEl.value = "";
  garnishEl.value = "";
  iceEl.value = "";
  historyEl.value = "";
  quickPitchEl.value = "";
  pairsWithEl.value = "";
  editor.setIngredients([]);
  editingOriginalName = null;
  renderSidebarList();
}

function loadIntoForm(recipe) {
  nameEl.value = recipe.name;
  categoryEl.value = recipe.category ?? "";
  basePortionsEl.value = recipe.basePortions;
  methodEl.value = recipe.method ?? "";
  glassEl.value = recipe.glass ?? "";
  garnishEl.value = recipe.garnish ?? "";
  iceEl.value = recipe.ice ?? "";
  historyEl.value = recipe.history ?? "";
  quickPitchEl.value = recipe.quickPitch ?? "";
  pairsWithEl.value = (recipe.pairsWith ?? []).join(", ");
  editor.setIngredients(recipe.ingredients);
  editingOriginalName = recipe.name;
  renderSidebarList();
}

async function handleSave() {
  const name = nameEl.value.trim();
  if (!name) {
    alert("Bitte einen Rezeptnamen eingeben.");
    return;
  }
  const ingredients = editor.getIngredients();
  if (ingredients.length === 0) {
    alert("Bitte mindestens eine gültige Zutat eingeben.");
    return;
  }
  const basePortions = parseFloat(basePortionsEl.value) || 1;
  const recipe = {
    name,
    category: categoryEl.value.trim(),
    basePortions,
    ingredients,
    method: methodEl.value.trim(),
    glass: glassEl.value.trim(),
    garnish: garnishEl.value.trim(),
    ice: iceEl.value.trim(),
    history: historyEl.value.trim(),
    quickPitch: quickPitchEl.value.trim(),
  };
  const pairsWith = parsePairsWith(pairsWithEl.value);
  if (pairsWith.length > 0) recipe.pairsWith = pairsWith;

  // Mitarbeitende schreiben nicht direkt (RLS erlaubt nur Admins), sondern
  // reichen den Vorschlag zur Prüfung ein.
  if (!isAdmin()) {
    try {
      await submitChangeRequest("recipes", recipe);
      alert("Danke! Dein Vorschlag wurde zur Prüfung an einen Admin eingereicht.");
      resetForm();
      exitEditView();
    } catch (error) {
      alert("Vorschlag konnte nicht eingereicht werden: " + error.message);
    }
    return;
  }

  try {
    if (editingOriginalName && editingOriginalName !== name && isCustomRecipe(editingOriginalName)) {
      await deleteRecipe(editingOriginalName);
    }
    await saveRecipe(recipe);
    editingOriginalName = name;
    exitEditView();
  } catch (error) {
    alert("Rezept konnte nicht gespeichert werden: " + error.message);
  }
}

async function handleDelete() {
  if (!editingOriginalName) {
    alert("Bitte zuerst ein Rezept auswählen.");
    return;
  }
  if (!isCustomRecipe(editingOriginalName)) {
    alert('Dieses Rezept ist ein Klassiker aus der Bibliothek und wurde noch nicht in deinem Rezeptbuch gespeichert – es gibt nichts zu löschen.');
    return;
  }

  if (!isAdmin()) {
    if (!confirm(`Löschung von "${editingOriginalName}" zur Prüfung vorschlagen?`)) return;
    try {
      await submitChangeRequest("recipes", { name: editingOriginalName }, "delete");
      alert("Danke! Der Löschvorschlag wurde zur Prüfung an einen Admin eingereicht.");
      resetForm();
      exitEditView();
    } catch (error) {
      alert("Vorschlag konnte nicht eingereicht werden: " + error.message);
    }
    return;
  }

  if (!confirm(`Rezept "${editingOriginalName}" wirklich löschen?`)) return;
  try {
    await deleteRecipe(editingOriginalName);
    resetForm();
    exitEditView();
  } catch (error) {
    alert("Rezept konnte nicht gelöscht werden: " + error.message);
  }
}

function renderIngredientRows(ingredients) {
  return ingredients
    .map(
      (ing) =>
        `<tr><td>${escapeHtml(ing.name)}</td><td>${formatNumber(ing.amount)} ${UNIT_LABELS[ing.unit] ?? escapeHtml(ing.unit)}</td></tr>`
    )
    .join("");
}

function recipeMatchesQuery(recipe, query) {
  if (recipe.name.toLowerCase().includes(query)) return true;
  return recipe.ingredients.some((ing) => ing.name.toLowerCase().includes(query));
}

function currentFilteredRecipes() {
  const query = searchEl.value.trim().toLowerCase();
  const categoryFilter = categoryFilterEl.value;
  return getAllRecipes().filter((r) => {
    const matchesQuery = recipeMatchesQuery(r, query);
    const matchesCategory = !categoryFilter || r.category === categoryFilter;
    return matchesQuery && matchesCategory;
  });
}

function groupRecipesByCategory(recipes) {
  const groups = new Map();
  recipes.forEach((recipe) => {
    const category = recipe.category || "Sonstiges";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(recipe);
  });
  return [...groups.entries()].sort(([a], [b]) => categorySortIndex(a) - categorySortIndex(b) || a.localeCompare(b, "de"));
}

function updateExportBar() {
  selectedCountEl.textContent = `${selectedNames.size} ausgewählt`;
  exportExcelBtn.disabled = selectedNames.size === 0;
  exportWordBtn.disabled = selectedNames.size === 0;
}

function renderRecipeItem(recipe) {
  const metaRows = [
    ["Glas", recipe.glass],
    ["Garnitur", recipe.garnish],
    ["Eis", recipe.ice],
    ["Zubereitung", recipe.method],
    ["Geschichte", recipe.history],
    ["Kurzer Pitch", recipe.quickPitch],
    ["Passt gut zu", (recipe.pairsWith ?? []).join(", ")],
  ].filter(([, value]) => value);

  const item = document.createElement("details");
  item.className = "recipe-item";
  item.dataset.name = recipe.name;
  item.innerHTML = `
    <summary>
      <span class="recipe-item-title">
        <input type="checkbox" class="recipe-select-checkbox" ${selectedNames.has(recipe.name) ? "checked" : ""} />
        ${escapeHtml(recipe.name)}
      </span>
    </summary>
    <div class="recipe-item-body">
      <table><tbody>${renderIngredientRows(recipe.ingredients)}</tbody></table>
      ${metaRows.map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`).join("")}
      <div class="actions">
        <button type="button" class="btn-secondary edit-btn">${isAdmin() ? "Bearbeiten" : "Änderung vorschlagen"}</button>
        ${isCustomRecipe(recipe.name) ? `<button type="button" class="btn-secondary delete-btn">${isAdmin() ? "Löschen" : "Löschung vorschlagen"}</button>` : ""}
      </div>
    </div>
  `;
  const checkbox = item.querySelector(".recipe-select-checkbox");
  checkbox.addEventListener("click", (e) => e.stopPropagation());
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      selectedNames.add(recipe.name);
    } else {
      selectedNames.delete(recipe.name);
    }
    updateExportBar();
  });
  const editBtn = item.querySelector(".edit-btn");
  if (editBtn) {
    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      savedListScrollY = window.scrollY;
      loadIntoForm(recipe);
      showEditView();
    });
  }
  const deleteBtn = item.querySelector(".delete-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!isAdmin()) {
        if (!confirm(`Löschung von "${recipe.name}" zur Prüfung vorschlagen?`)) return;
        try {
          await submitChangeRequest("recipes", { name: recipe.name }, "delete");
          alert("Danke! Der Löschvorschlag wurde zur Prüfung an einen Admin eingereicht.");
        } catch (error) {
          alert("Vorschlag konnte nicht eingereicht werden: " + error.message);
        }
        return;
      }
      if (!confirm(`Rezept "${recipe.name}" wirklich löschen?`)) return;
      try {
        if (editingOriginalName === recipe.name) resetForm();
        await deleteRecipe(recipe.name);
      } catch (error) {
        alert("Rezept konnte nicht gelöscht werden: " + error.message);
      }
    });
  }
  return item;
}

function renderBrowseList() {
  const recipes = currentFilteredRecipes();

  if (recipes.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Keine Rezepte gefunden.</p>`;
    updateExportBar();
    return;
  }
  listEl.innerHTML = "";
  groupRecipesByCategory(recipes).forEach(([category, items]) => {
    const header = document.createElement("h3");
    header.className = "product-group-header";
    header.textContent = category;
    listEl.appendChild(header);

    items
      .sort((a, b) => a.name.localeCompare(b.name, "de"))
      .forEach((recipe) => listEl.appendChild(renderRecipeItem(recipe)));
  });
  updateExportBar();
}

function renderSidebarList() {
  const query = sidebarSearchEl.value.trim().toLowerCase();
  const recipes = getAllRecipes().filter((r) => recipeMatchesQuery(r, query));

  if (recipes.length === 0) {
    sidebarListEl.innerHTML = `<p class="empty-note">Keine Rezepte gefunden.</p>`;
    return;
  }
  sidebarListEl.innerHTML = "";
  recipes.forEach((recipe) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recipe-name-btn" + (recipe.name === editingOriginalName ? " active" : "");
    btn.textContent = recipe.name;
    btn.addEventListener("click", () => loadIntoForm(recipe));
    sidebarListEl.appendChild(btn);
  });
}

function sortedCategories() {
  return [...new Set(getAllRecipes().map((r) => r.category).filter(Boolean))].sort(
    (a, b) => categorySortIndex(a) - categorySortIndex(b) || a.localeCompare(b, "de")
  );
}

function populateCategoryFilter() {
  const categories = sortedCategories();
  const currentValue = categoryFilterEl.value;
  categoryFilterEl.innerHTML =
    `<option value="">Alle Kategorien</option>` +
    categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  if (categories.includes(currentValue)) categoryFilterEl.value = currentValue;
}

// Kategorie-Baum in der Sidebar unter "Bibliothek → Rezepte", analog zum
// Produkte-Baum: ein Klick wechselt in den Rezepte-Tab und setzt den
// Kategorie-Filter. Quelle der Wahrheit bleibt das Filter-Dropdown.
function renderSidebarCategoryTree() {
  categoryTreeEl.innerHTML = "";
  const categories = sortedCategories();
  const active = categoryFilterEl.value;

  categories.forEach((category) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subnav-btn" + (category === active ? " active" : "");
    btn.textContent = category;
    btn.addEventListener("click", () => {
      switchTab("recipes");
      // Detail-/Bearbeiten-Ansicht verlassen und die mobile Navigation
      // schließen, sonst bleibt die Liste unter dem Menü verborgen.
      showListView();
      closeMobileNav();
      categoryFilterEl.value = category;
      renderSidebarCategoryTree();
      renderBrowseList();
      window.scrollTo({ top: 0 });
    });
    categoryTreeEl.appendChild(btn);
  });
}

// Setzt den Kategorie-Filter zurück auf "Alle" – aufgerufen, wenn "Rezepte"
// direkt angeklickt wird (Sidebar-Button oder Start-Kachel), statt über einen
// Unterpunkt im Kategorie-Baum.
function resetCategoryFilter() {
  categoryFilterEl.value = "";
  renderSidebarCategoryTree();
  renderBrowseList();
}

function populateCategoryOptions() {
  const categories = sortedCategories();
  categoryOptionsEl.innerHTML = categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
}

// Springt vom Datenqualität-Dashboard im Admin-Tab direkt ins Bearbeiten-
// Formular eines Rezepts (Aufrufer wechselt vorher per switchTab("recipes")).
export function openRecipeForEdit(name) {
  const recipe = getRecipe(name);
  if (!recipe) return;
  loadIntoForm(recipe);
  showEditView();
}

// Springt aus der globalen Suche zu einem Rezept: Leseansicht (nicht das
// Bearbeiten-Formular), Kategoriefilter zurückgesetzt, Eintrag aufgeklappt.
export function focusRecipe(name) {
  showListView();
  categoryFilterEl.value = "";
  renderSidebarCategoryTree();
  searchEl.value = name;
  renderBrowseList();
  requestAnimationFrame(() => {
    const item = listEl.querySelector(`.recipe-item[data-name="${CSS.escape(name)}"]`);
    if (item) {
      item.open = true;
      item.scrollIntoView({ block: "start" });
    }
  });
}

export function initRecipes() {
  if (!isAdmin()) {
    document.getElementById("recipe-save").textContent = "Vorschlag einreichen";
    document.getElementById("recipe-delete").textContent = "Löschung vorschlagen";
  }
  editor.setIngredients([]);
  document.getElementById("recipe-add-ingredient").addEventListener("click", () => editor.addRow());
  document.getElementById("recipe-save").addEventListener("click", handleSave);
  document.getElementById("recipe-new").addEventListener("click", resetForm);
  document.getElementById("recipe-delete").addEventListener("click", handleDelete);
  document.getElementById("recipe-list-new").addEventListener("click", () => {
    savedListScrollY = window.scrollY;
    resetForm();
    showEditView();
  });
  document.getElementById("recipe-back-to-list").addEventListener("click", exitEditView);
  document.getElementById("recipe-sidebar-new").addEventListener("click", resetForm);
  searchEl.addEventListener("input", renderBrowseList);
  categoryFilterEl.addEventListener("change", () => {
    renderSidebarCategoryTree();
    renderBrowseList();
  });
  // "Rezepte" direkt anklicken (Sidebar-Button, Start-Kachel) zeigt wieder
  // alle Kategorien statt in der zuletzt gewählten zu bleiben.
  document.querySelectorAll('[data-tab="recipes"]').forEach((el) => {
    el.addEventListener("click", resetCategoryFilter);
  });
  sidebarSearchEl.addEventListener("input", renderSidebarList);
  selectAllBtn.addEventListener("click", () => {
    currentFilteredRecipes().forEach((r) => selectedNames.add(r.name));
    renderBrowseList();
  });
  selectNoneBtn.addEventListener("click", () => {
    selectedNames.clear();
    renderBrowseList();
  });
  exportExcelBtn.addEventListener("click", () => {
    const recipes = getAllRecipes().filter((r) => selectedNames.has(r.name));
    if (recipes.length > 0) exportRecipesToExcel(recipes);
  });
  exportWordBtn.addEventListener("click", () => {
    const recipes = getAllRecipes().filter((r) => selectedNames.has(r.name));
    if (recipes.length > 0) exportRecipesToWord(recipes);
  });
  onRecipesChanged(() => {
    populateCategoryFilter();
    populateCategoryOptions();
    renderSidebarCategoryTree();
    renderBrowseList();
    renderSidebarList();
  });
  populateCategoryFilter();
  populateCategoryOptions();
  renderSidebarCategoryTree();
  renderBrowseList();
  renderSidebarList();
}
