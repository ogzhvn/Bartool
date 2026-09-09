import { saveRecipe, deleteRecipe, onRecipesChanged } from "./storage.js";
import { createIngredientEditor } from "./ingredientEditor.js";
import { escapeHtml, formatNumber } from "./utils.js";
import { getAllRecipes, getRecipe, isCustomRecipe } from "./recipeLibrary.js";
import { UNIT_LABELS } from "./units.js";
import { exportRecipesToExcel, exportRecipesToWord } from "./recipeExport.js";
import { allergensForRecipe, allergenLabel } from "./allergens.js";
import { isFavorite, toggleFavorite, pushRecent } from "./favorites.js";
import { printRecipes } from "./printView.js";
import { isAdmin } from "./auth.js";
import { submitChangeRequest } from "./changeRequests.js";
import { switchTab, closeMobileNav, takePendingEditReturn } from "./tabs.js";
import { germanOnlyNote, getLocale, localizedContent, onLanguageChanged, t } from "./i18n.js";
import { uploadRecipePhoto, deleteRecipePhoto, resolveImageUrl } from "./photos.js";

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
// Englische Zweitfassung (Paket 33): dieselbe Maske, zweite Spalte. Nur die
// Felder, die eine Saisonkraft in der Schicht braucht – Geschichte und
// "Passt gut zu" bleiben bewusst deutsch.
const methodEnEl = document.getElementById("recipe-method-en");
const glassEnEl = document.getElementById("recipe-glass-en");
const garnishEnEl = document.getElementById("recipe-garnish-en");
const quickPitchEnEl = document.getElementById("recipe-quick-pitch-en");
const salesPriceEl = document.getElementById("recipe-sales-price");
const pairsWithEl = document.getElementById("recipe-pairs-with");
const photoFieldEl = document.getElementById("recipe-photo-field");
const photoPreviewEl = document.getElementById("recipe-photo-preview");
const photoInputEl = document.getElementById("recipe-photo-input");
const photoRemoveBtn = document.getElementById("recipe-photo-remove");
const garnishPhotoFieldEl = document.getElementById("recipe-garnish-photo-field");
const garnishPhotoPreviewEl = document.getElementById("recipe-garnish-photo-preview");
const garnishPhotoInputEl = document.getElementById("recipe-garnish-photo-input");
const garnishPhotoRemoveBtn = document.getElementById("recipe-garnish-photo-remove");
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
const printBtn = document.getElementById("recipe-print");

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

// Steuert ein Foto-Feld (Datei wählen, Vorschau, entfernen). Für Aufbau- und
// Garniturbild wiederverwendet, statt den Ablauf zweimal zu bauen.
function createPhotoField({ fieldEl, previewEl, inputEl, removeBtn }) {
  let existingPath = "";
  let pendingFile = null;
  let pendingRemoved = false;

  function showPlaceholder() {
    previewEl.innerHTML = '<i class="ph ph-image" aria-hidden="true"></i>';
  }
  function showImage(url) {
    previewEl.innerHTML = `<img src="${url}" alt="" />`;
  }
  function updateVisibility() {
    fieldEl.hidden = !isAdmin();
    removeBtn.hidden = !pendingFile && (pendingRemoved || !existingPath);
  }
  function reset() {
    existingPath = "";
    pendingFile = null;
    pendingRemoved = false;
    inputEl.value = "";
    showPlaceholder();
    updateVisibility();
  }
  async function load(path) {
    existingPath = path || "";
    pendingFile = null;
    pendingRemoved = false;
    inputEl.value = "";
    updateVisibility();
    showPlaceholder();
    if (!existingPath) return;
    const url = await resolveImageUrl(existingPath);
    // Zwischenzeitlich könnte schon ein anderes Rezept geladen worden sein.
    if (existingPath !== path) return;
    if (url) showImage(url);
  }
  // Lädt ein neu gewähltes Foto hoch bzw. löscht das alte, falls entfernt,
  // und liefert den Pfad, der im Rezept gespeichert werden soll.
  async function resolveForSave() {
    if (pendingFile) {
      const newPath = await uploadRecipePhoto(pendingFile);
      if (existingPath) await deleteRecipePhoto(existingPath).catch(() => {});
      return newPath;
    }
    if (pendingRemoved) {
      if (existingPath) await deleteRecipePhoto(existingPath).catch(() => {});
      return "";
    }
    return existingPath;
  }
  async function deleteExisting() {
    if (existingPath) await deleteRecipePhoto(existingPath).catch(() => {});
  }

  inputEl.addEventListener("change", () => {
    const file = inputEl.files?.[0];
    if (!file) return;
    pendingFile = file;
    pendingRemoved = false;
    showImage(URL.createObjectURL(file));
    updateVisibility();
  });
  removeBtn.addEventListener("click", () => {
    pendingFile = null;
    pendingRemoved = true;
    inputEl.value = "";
    showPlaceholder();
    updateVisibility();
  });

  return { reset, load, resolveForSave, deleteExisting };
}

const photoField = createPhotoField({
  fieldEl: photoFieldEl,
  previewEl: photoPreviewEl,
  inputEl: photoInputEl,
  removeBtn: photoRemoveBtn,
});
const garnishPhotoField = createPhotoField({
  fieldEl: garnishPhotoFieldEl,
  previewEl: garnishPhotoPreviewEl,
  inputEl: garnishPhotoInputEl,
  removeBtn: garnishPhotoRemoveBtn,
});

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
  methodEnEl.value = "";
  glassEnEl.value = "";
  garnishEnEl.value = "";
  quickPitchEnEl.value = "";
  salesPriceEl.value = "";
  pairsWithEl.value = "";
  editor.setIngredients([]);
  editingOriginalName = null;
  photoField.reset();
  garnishPhotoField.reset();
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
  methodEnEl.value = recipe.methodEn ?? "";
  glassEnEl.value = recipe.glassEn ?? "";
  garnishEnEl.value = recipe.garnishEn ?? "";
  quickPitchEnEl.value = recipe.quickPitchEn ?? "";
  salesPriceEl.value = recipe.salesPrice ?? "";
  pairsWithEl.value = (recipe.pairsWith ?? []).join(", ");
  editor.setIngredients(recipe.ingredients);
  editingOriginalName = recipe.name;
  photoField.load(recipe.imagePath);
  garnishPhotoField.load(recipe.garnishImagePath);
  renderSidebarList();
}

async function handleSave() {
  const name = nameEl.value.trim();
  if (!name) {
    alert(t("ui.bitte_einen_rezeptnamen_eingeben"));
    return;
  }
  const ingredients = editor.getIngredients();
  if (ingredients.length === 0) {
    alert(t("ui.bitte_mindestens_eine_gueltige_zutat_7d1c"));
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
    methodEn: methodEnEl.value.trim(),
    glassEn: glassEnEl.value.trim(),
    garnishEn: garnishEnEl.value.trim(),
    quickPitchEn: quickPitchEnEl.value.trim(),
    salesPrice: salesPriceEl.value === "" ? "" : parseFloat(salesPriceEl.value),
  };
  const pairsWith = parsePairsWith(pairsWithEl.value);
  if (pairsWith.length > 0) recipe.pairsWith = pairsWith;

  // Mitarbeitende schreiben nicht direkt (RLS erlaubt nur Admins), sondern
  // reichen den Vorschlag zur Prüfung ein.
  if (!isAdmin()) {
    try {
      await submitChangeRequest("recipes", recipe);
      alert(t("ui.danke_dein_vorschlag_wurde_zur_pruefung_an_65b3"));
      resetForm();
      exitEditView();
    } catch (error) {
      alert(t("ui.vorschlag_konnte_nicht_eingereicht_werden") + error.message);
    }
    return;
  }

  try {
    // Fotos zuerst hochladen/löschen – schlägt das fehl, ist noch nichts am
    // Rezept gespeichert.
    recipe.imagePath = await photoField.resolveForSave();
    recipe.garnishImagePath = await garnishPhotoField.resolveForSave();

    if (editingOriginalName && editingOriginalName !== name && isCustomRecipe(editingOriginalName)) {
      await deleteRecipe(editingOriginalName);
    }
    await saveRecipe(recipe);
    editingOriginalName = name;
    exitEditView();
  } catch (error) {
    alert(t("ui.rezept_konnte_nicht_gespeichert_werden") + error.message);
  }
}

async function handleDelete() {
  if (!editingOriginalName) {
    alert(t("ui.bitte_zuerst_ein_rezept_auswaehlen"));
    return;
  }
  if (!isCustomRecipe(editingOriginalName)) {
    alert(t("ui.dieses_rezept_ist_ein_klassiker_aus_der_5933"));
    return;
  }

  if (!isAdmin()) {
    if (!confirm(`${t("ui.loeschung_von")}${editingOriginalName}${t("ui.zur_pruefung_vorschlagen")}`)) return;
    try {
      await submitChangeRequest("recipes", { name: editingOriginalName }, "delete");
      alert(t("ui.danke_der_loeschvorschlag_wurde_zur_a3bd"));
      resetForm();
      exitEditView();
    } catch (error) {
      alert(t("ui.vorschlag_konnte_nicht_eingereicht_werden") + error.message);
    }
    return;
  }

  if (!confirm(`${t("ui.rezept_501c")}${editingOriginalName}${t("ui.wirklich_loeschen_b7a7")}`)) return;
  try {
    await photoField.deleteExisting();
    await garnishPhotoField.deleteExisting();
    await deleteRecipe(editingOriginalName);
    resetForm();
    exitEditView();
  } catch (error) {
    alert(t("ui.rezept_konnte_nicht_geloescht_werden") + error.message);
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
  return [...groups.entries()].sort(([a], [b]) => categorySortIndex(a) - categorySortIndex(b) || a.localeCompare(b, getLocale()));
}

function updateExportBar() {
  selectedCountEl.textContent = `${selectedNames.size} ${t("ui.ausgewaehlt")}`;
  exportExcelBtn.disabled = selectedNames.size === 0;
  exportWordBtn.disabled = selectedNames.size === 0;
  printBtn.disabled = selectedNames.size === 0;
}

// Allergen-Block für die Rezeptansicht. Sagt nie "allergenfrei": was nicht
// belegt ist, wird als ungeprüft ausgewiesen.
function renderAllergenBlock(recipe) {
  const { entries, unchecked, clear } = allergensForRecipe(recipe);

  const zeilen = entries
    .map((e) => {
      const angabe = allergenLabel(e.allergens);
      return `<li><strong>${escapeHtml(e.product)}:</strong> ${escapeHtml(angabe.text)}${langHinweis(
        angabe.isGermanOnly
      )}</li>`;
    })
    .join("");

  const teile = [];
  if (entries.length > 0) {
    teile.push(`<ul class="allergen-list">${zeilen}</ul>`);
  } else if (clear.length > 0 && unchecked.length === 0) {
    teile.push(
      `<p class="allergen-note">${t("ui.bei_allen")} ${clear.length} ${t("ui.zutaten_ist_im_katalog_keine_bekannten_24d4")}</p>`
    );
  }

  if (unchecked.length > 0) {
    const liste = unchecked.map((u) => `${u.name} (${u.reason})`).join(", ");
    teile.push(`<p class="allergen-note">${t("ui.ungeprueft")} ${escapeHtml(liste)}</p>`);
  }

  if (teile.length === 0) return "";
  return `<div class="allergen-box"><strong>${t("ui.allergene")}</strong>${teile.join("")}</div>`;
}

// Kleiner Hinweis hinter Inhalten, die es nur auf Deutsch gibt. Auf Deutsch
// selbst erscheint er nie (isGermanOnly ist dort immer false).
function langHinweis(isGermanOnly) {
  return isGermanOnly ? ` <span class="lang-note">(${escapeHtml(germanOnlyNote())})</span>` : "";
}

// Zeile für ein Feld mit englischer Zweitfassung (siehe js/i18n.js).
function inhaltsZeile(label, recipe, field) {
  const { text, isGermanOnly } = localizedContent(recipe, field);
  return { label, text, isGermanOnly };
}

// Zeile für ein Feld, das bewusst nur auf Deutsch gepflegt wird.
function deutscheZeile(label, value) {
  return { label, text: String(value ?? ""), isGermanOnly: false };
}

function renderRecipeItem(recipe) {
  const metaRows = [
    inhaltsZeile(t("ui.glas"), recipe, "glass"),
    inhaltsZeile(t("ui.garnitur"), recipe, "garnish"),
    deutscheZeile(t("ui.eis"), recipe.ice),
    inhaltsZeile(t("ui.zubereitung"), recipe, "method"),
    deutscheZeile(t("ui.geschichte"), recipe.history),
    inhaltsZeile(t("ui.kurzer_pitch"), recipe, "quickPitch"),
    deutscheZeile(t("ui.passt_gut_zu"), (recipe.pairsWith ?? []).join(", ")),
  ].filter((row) => row.text);

  const item = document.createElement("details");
  item.className = "recipe-item";
  // Ermöglicht der globalen Suche, direkt zu diesem Eintrag zu springen.
  item.dataset.name = recipe.name;
  item.innerHTML = `
    <summary>
      <span class="recipe-item-title">
        <input type="checkbox" class="recipe-select-checkbox" ${selectedNames.has(recipe.name) ? "checked" : ""} />
        ${escapeHtml(recipe.name)}
      </span>
      <button type="button" class="fav-btn${isFavorite("recipe", recipe.name) ? " is-fav" : ""}" title="${t("ui.favorit")}" aria-label="${t("ui.als_favorit_merken")}"><i class="ph ph-star" aria-hidden="true"></i></button>
    </summary>
    <div class="recipe-item-body">
      ${recipe.imagePath || recipe.garnishImagePath ? `<div class="item-photo-row">
        ${recipe.imagePath ? `<figure><div class="item-photo-slot item-photo-slot-main"></div><figcaption>${t("ui.aufbau")}</figcaption></figure>` : ""}
        ${recipe.garnishImagePath ? `<figure><div class="item-photo-slot item-photo-slot-garnish"></div><figcaption>${t("ui.garnitur")}</figcaption></figure>` : ""}
      </div>` : ""}
      <table><tbody>${renderIngredientRows(recipe.ingredients)}</tbody></table>
      ${metaRows
        .map(
          (row) =>
            `<p><strong>${escapeHtml(row.label)}:</strong> ${escapeHtml(row.text)}${langHinweis(row.isGermanOnly)}</p>`
        )
        .join("")}
      ${renderAllergenBlock(recipe)}
      <div class="actions">
        <button type="button" class="btn-secondary edit-btn">${isAdmin() ? t("ui.bearbeiten") : t("ui.aenderung_vorschlagen")}</button>
        ${isCustomRecipe(recipe.name) ? `<button type="button" class="btn-secondary delete-btn">${isAdmin() ? t("ui.loeschen") : t("ui.loeschung_vorschlagen")}</button>` : ""}
      </div>
    </div>
  `;
  if (recipe.imagePath) {
    resolveImageUrl(recipe.imagePath).then((url) => {
      if (!url) return;
      const slot = item.querySelector(".item-photo-slot-main");
      if (slot) slot.innerHTML = `<img class="item-photo" src="${url}" alt="${escapeHtml(recipe.name)}" loading="lazy" />`;
    });
  }
  if (recipe.garnishImagePath) {
    resolveImageUrl(recipe.garnishImagePath).then((url) => {
      if (!url) return;
      const slot = item.querySelector(".item-photo-slot-garnish");
      if (slot) slot.innerHTML = `<img class="item-photo" src="${url}" alt="Garnitur – ${escapeHtml(recipe.name)}" loading="lazy" />`;
    });
  }
  const favBtn = item.querySelector(".fav-btn");
  favBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    favBtn.classList.toggle("is-fav", toggleFavorite("recipe", recipe.name));
  });

  // Aufklappen zählt als "angesehen" – das füttert die Startseite.
  item.addEventListener("toggle", () => {
    if (item.open) pushRecent("recipe", recipe.name);
  });

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
        if (!confirm(`${t("ui.loeschung_von")}${recipe.name}${t("ui.zur_pruefung_vorschlagen")}`)) return;
        try {
          await submitChangeRequest("recipes", { name: recipe.name }, "delete");
          alert(t("ui.danke_der_loeschvorschlag_wurde_zur_a3bd"));
        } catch (error) {
          alert(t("ui.vorschlag_konnte_nicht_eingereicht_werden") + error.message);
        }
        return;
      }
      if (!confirm(`${t("ui.rezept_501c")}${recipe.name}${t("ui.wirklich_loeschen_b7a7")}`)) return;
      try {
        if (recipe.imagePath) await deleteRecipePhoto(recipe.imagePath).catch(() => {});
        if (recipe.garnishImagePath) await deleteRecipePhoto(recipe.garnishImagePath).catch(() => {});
        if (editingOriginalName === recipe.name) resetForm();
        await deleteRecipe(recipe.name);
      } catch (error) {
        alert(t("ui.rezept_konnte_nicht_geloescht_werden") + error.message);
      }
    });
  }
  return item;
}

function renderBrowseList() {
  const recipes = currentFilteredRecipes();

  if (recipes.length === 0) {
    listEl.innerHTML = `<p class="empty-note">${t("ui.keine_rezepte_gefunden")}</p>`;
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
      .sort((a, b) => a.name.localeCompare(b.name, getLocale()))
      .forEach((recipe) => listEl.appendChild(renderRecipeItem(recipe)));
  });
  updateExportBar();
}

function renderSidebarList() {
  const query = sidebarSearchEl.value.trim().toLowerCase();
  const recipes = getAllRecipes().filter((r) => recipeMatchesQuery(r, query));

  if (recipes.length === 0) {
    sidebarListEl.innerHTML = `<p class="empty-note">${t("ui.keine_rezepte_gefunden")}</p>`;
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
    (a, b) => categorySortIndex(a) - categorySortIndex(b) || a.localeCompare(b, getLocale())
  );
}

function populateCategoryFilter() {
  const categories = sortedCategories();
  const currentValue = categoryFilterEl.value;
  categoryFilterEl.innerHTML =
    `<option value="">${t("ui.alle_kategorien")}</option>` +
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

// Springt aus der globalen Suche (js/quickSearch.js) zu einem Rezept in der
// Leseansicht: Filter zurücksetzen, nach dem Namen suchen, Eintrag aufklappen.
// Bewusst nicht die Bearbeiten-Ansicht – die ist nur für Admins gedacht.
export function focusRecipe(name) {
  showListView();
  categoryFilterEl.value = "";
  searchEl.value = name;
  renderSidebarCategoryTree();
  renderBrowseList();
  const item = listEl.querySelector(`[data-name="${CSS.escape(name)}"]`);
  if (!item) return;
  item.open = true;
  item.scrollIntoView({ block: "start" });
}

export function initRecipes() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    populateCategoryFilter();
    renderBrowseList();
    renderSidebarList();
  });

  if (!isAdmin()) {
    document.getElementById("recipe-save").textContent = t("ui.vorschlag_einreichen");
    document.getElementById("recipe-delete").textContent = t("ui.loeschung_vorschlagen");
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
  printBtn.addEventListener("click", () => {
    printRecipes(getAllRecipes().filter((r) => selectedNames.has(r.name)));
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
