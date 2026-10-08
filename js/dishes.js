import { can, canSee, getCurrentUser, getCurrentProfile, myDepartment } from "./auth.js";
import { getSupabaseClient } from "./supabaseClient.js";
import { deleteDish, loadDepartments, loadDishes, onDepartmentsChanged, onDishesChanged } from "./storage.js";
import { declarationLabel, missingSubtypes } from "./declarations.js";
import { switchTab } from "./tabs.js";
import { confirmDiscardDishEditor, initDishEditor, isDishEditorOpen, openDishEditor } from "./dishEditor.js";
import { initDishMatrix, renderMatrix } from "./dishMatrix.js";
import { formatDate, getLocale, onLanguageChanged, t } from "./i18n.js";

// Gerichte (Paket 71): Liste, Filter, Detail. Pflege steckt in js/dishEditor.js
// und hängt an dishes.write.
//
// Grundsatz: Allergenangaben gelten nur mit Prüfvermerk. Ohne Vermerk steht
// überall "ungeprüft", nie "allergenfrei". Auch ein Gericht ohne Allergene
// bekommt erst mit Vermerk die Aussage "Keine der 14 Hauptallergene laut Küche".
//
// Der Abteilungsfilter ist Kosmetik, kein Zugriffsschutz: lesen dürfen alle
// angemeldeten Konten (RLS). Eine leere Abteilungsliste am Gericht heißt "alle".
//
// Namen, Kategorien, Beschreibungen und Komponenten sind Nutzereingaben und
// gehen nur per textContent ins DOM (Regel 5).

const FILTER_OWN = "own";
const FILTER_ALL = "all";

const searchEl = document.getElementById("dishes-search");
const departmentEl = document.getElementById("dishes-department");
const categoryEl = document.getElementById("dishes-category");
const inactiveEl = document.getElementById("dishes-inactive");
const listEl = document.getElementById("dishes-list");
const listViewEl = document.getElementById("dishes-list-view");
const detailEl = document.getElementById("dishes-detail");
const newBtn = document.getElementById("dishes-new");
const matrixViewEl = document.getElementById("dishes-matrix-view");
const modeListBtn = document.getElementById("dishes-mode-list");
const modeMatrixBtn = document.getElementById("dishes-mode-matrix");
const inactiveLabelEl = document.getElementById("dishes-inactive-label");

// Ansicht in der Liste: "list" oder "matrix" (Paket 72).
let viewMode = "list";

let departmentFilter = null;
let categoryFilter = "";
let openDishId = null;
// Anzeigenamen der Prüfer. Lesen darf Profile nur, wer users.manage hat oder
// das eigene Konto; sonst bleibt es beim Datum.
const checkerNames = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function icon(name) {
  const i = document.createElement("i");
  i.className = `ph ${name}`;
  i.setAttribute("aria-hidden", "true");
  return i;
}

function departmentLabel(key) {
  return loadDepartments().find((d) => d.key === key)?.label ?? key;
}

function collator() {
  return new Intl.Collator(getLocale(), { sensitivity: "base" });
}

// ---------------------------------------------------------------------
// Auswahl
// ---------------------------------------------------------------------

function matchesDepartment(dish) {
  if (departmentFilter === FILTER_ALL) return true;
  if (dish.departments.length === 0) return true;
  const key = departmentFilter === FILTER_OWN ? myDepartment() : departmentFilter;
  return key ? dish.departments.includes(key) : true;
}

function matchesSearch(dish, term) {
  if (!term) return true;
  const haystack = [dish.name, dish.category, dish.description, ...dish.components.map((c) => c?.name)];
  return haystack.some((value) => String(value ?? "").toLowerCase().includes(term));
}

function visibleDishes() {
  const matrix = viewMode === "matrix";
  const term = searchEl.value.trim().toLowerCase();
  const cmp = collator();
  return loadDishes()
    .filter(
      (d) =>
        (matrix ? d.active : inactiveEl.checked || d.active) &&
        matchesDepartment(d) &&
        (!categoryFilter || d.category === categoryFilter) &&
        matchesSearch(d, term)
    )
    .sort((a, b) => cmp.compare(a.category, b.category) || a.sort - b.sort || cmp.compare(a.name, b.name));
}

// ---------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------

// Eine Chipgruppe aus Schlüsseln. Eine Hauptgruppe ohne Art trägt "Art fehlt".
function declarationChips(keys, kind, className = "dish-chips") {
  const wrap = el("div", className);
  const missing = new Set(kind === "allergen" ? missingSubtypes(keys) : []);
  keys.forEach((key) => {
    const text = declarationLabel(key, kind);
    const chip = el("span", "dish-chip", text);
    if (missing.has(key)) {
      chip.classList.add("dish-chip-warn");
      chip.textContent = `${text} · ${t("ui.gerichte_art_fehlt")}`;
    }
    wrap.appendChild(chip);
  });
  return wrap;
}

// Status der Allergenangaben als Badge. "geprüft" sagt nur, dass die Küche die
// Angaben bestätigt hat, nicht dass das Gericht frei von etwas ist.
function statusBadge(dish) {
  if (!dish.allergensCheckedAt) {
    const badge = el("span", "knowledge-badge knowledge-badge-draft dish-status");
    badge.append(icon("ph-warning"), el("span", null, t("ui.gerichte_ungeprueft")));
    return badge;
  }
  const badge = el("span", "knowledge-badge knowledge-badge-new dish-status");
  badge.append(
    icon("ph-seal-check"),
    el("span", null, t("ui.gerichte_geprueft_am", { date: formatDate(dish.allergensCheckedAt) }))
  );
  return badge;
}

// ---------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------

function renderDepartmentFilter() {
  const previous = departmentFilter;
  departmentEl.textContent = "";
  const own = myDepartment();
  const options = [];
  if (own) options.push([FILTER_OWN, t("ui.wissen_abt_eigene")]);
  options.push([FILTER_ALL, t("ui.wissen_abt_alle")]);
  loadDepartments().forEach((d) => options.push([d.key, d.label]));
  options.forEach(([value, label]) => {
    const option = el("option", null, label);
    option.value = value;
    departmentEl.appendChild(option);
  });
  const wanted = previous ?? (own ? FILTER_OWN : FILTER_ALL);
  departmentFilter = options.some(([value]) => value === wanted) ? wanted : FILTER_ALL;
  departmentEl.value = departmentFilter;
}

function renderCategoryFilter() {
  const cmp = collator();
  const categories = [...new Set(loadDishes().map((d) => d.category).filter(Boolean))].sort(cmp.compare);
  categoryEl.textContent = "";
  const all = el("option", null, t("ui.gerichte_kategorie_alle"));
  all.value = "";
  categoryEl.appendChild(all);
  categories.forEach((category) => {
    const option = el("option", null, category);
    option.value = category;
    categoryEl.appendChild(option);
  });
  if (!categories.includes(categoryFilter)) categoryFilter = "";
  categoryEl.value = categoryFilter;
}

function dishRow(dish) {
  const row = el("button", "knowledge-row dish-row");
  row.type = "button";
  row.dataset.id = dish.id;
  const main = el("span", "knowledge-row-main");
  const title = el("span", "knowledge-row-title", dish.name);
  main.appendChild(title);
  const meta = [dish.category, dish.active ? "" : t("ui.gerichte_inaktiv")].filter(Boolean).join(" · ");
  if (meta) main.appendChild(el("span", "knowledge-row-meta", meta));
  if (dish.allergens.length > 0) main.appendChild(declarationChips(dish.allergens, "allergen"));
  main.appendChild(statusBadge(dish));
  row.appendChild(main);
  return row;
}

function setMode(mode) {
  viewMode = mode;
  const matrix = mode === "matrix";
  listEl.hidden = matrix;
  matrixViewEl.hidden = !matrix;
  // Die Matrix zeigt nur aktive Gerichte.
  inactiveLabelEl.hidden = matrix;
  modeListBtn.classList.toggle("active", !matrix);
  modeMatrixBtn.classList.toggle("active", matrix);
  modeListBtn.setAttribute("aria-pressed", String(!matrix));
  modeMatrixBtn.setAttribute("aria-pressed", String(matrix));
  renderList();
}

function scopeLabel() {
  if (departmentFilter === FILTER_ALL || !departmentFilter) return t("ui.gerichte_alle_abteilungen");
  const key = departmentFilter === FILTER_OWN ? myDepartment() : departmentFilter;
  return key ? departmentLabel(key) : t("ui.gerichte_alle_abteilungen");
}

function renderList() {
  if (viewMode === "matrix") {
    renderMatrix();
    return;
  }
  listEl.textContent = "";
  const dishes = visibleDishes();
  if (dishes.length === 0) {
    listEl.appendChild(el("p", "empty-note", t("ui.gerichte_leer")));
    return;
  }
  dishes.forEach((dish) => listEl.appendChild(dishRow(dish)));
}

// ---------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------

function section(titleKey, ...content) {
  const wrap = el("section", "knowledge-section dish-section");
  wrap.appendChild(el("h4", null, t(titleKey)));
  wrap.append(...content);
  return wrap;
}

function allergenSection(dish) {
  const status = dish.allergensCheckedAt ? "checked" : "unchecked";
  const nodes = [];
  if (dish.allergens.length > 0) {
    nodes.push(declarationChips(dish.allergens, "allergen"));
  } else if (status === "checked") {
    nodes.push(el("p", "dish-none", t("ui.gerichte_keine_der_14", { date: formatDate(dish.allergensCheckedAt) })));
  }
  if (status === "unchecked") {
    nodes.push(el("p", "dish-unchecked-note", t("ui.gerichte_ungeprueft_hinweis")));
  }
  return section("ui.gerichte_allergene", ...nodes);
}

function checkFooter(dish) {
  const footer = el("div", "knowledge-footer dish-check");
  if (!dish.allergensCheckedAt) {
    footer.appendChild(statusBadge(dish));
    return footer;
  }
  const date = formatDate(dish.allergensCheckedAt);
  const line = el("p", "hint", t("ui.gerichte_geprueft_datum", { date }));
  footer.appendChild(line);
  if (dish.allergensCheckedBy) fillCheckerName(dish.allergensCheckedBy, line, date);
  return footer;
}

async function fillCheckerName(id, line, date) {
  // Erst abwarten, bis der Absatz im DOM hängt (checkFooter ruft vor dem Anhängen auf).
  await Promise.resolve();
  if (!checkerNames.has(id)) {
    let name = null;
    if (getCurrentUser()?.id === id) {
      const profile = getCurrentProfile();
      name = profile?.display_name || profile?.username || null;
    } else {
      try {
        const { data } = await getSupabaseClient()
          .from("profiles")
          .select("display_name, username")
          .eq("id", id)
          .maybeSingle();
        name = data?.display_name || data?.username || null;
      } catch {
        // Offline oder nicht lesbar: es bleibt beim Datum.
      }
    }
    checkerNames.set(id, name);
  }
  const name = checkerNames.get(id);
  if (name && line.isConnected) line.textContent = t("ui.gerichte_geprueft_von", { name, date });
}

function renderDetail() {
  const dish = loadDishes().find((d) => d.id === openDishId);
  if (!dish) {
    showList();
    return;
  }
  detailEl.textContent = "";

  const bar = el("div", "knowledge-detail-bar");
  const back = el("button", "knowledge-back-link");
  back.type = "button";
  back.dataset.action = "back";
  back.append(icon("ph-arrow-left"), el("span", null, t("ui.gerichte_zurueck")));
  bar.appendChild(back);
  if (can("dishes.write")) {
    const tools = el("div", "knowledge-detail-tools");
    const edit = el("button", "btn-secondary", t("ui.bearbeiten"));
    edit.type = "button";
    edit.dataset.action = "edit";
    const del = el("button", "btn-secondary", t("ui.loeschen"));
    del.type = "button";
    del.dataset.action = "delete";
    tools.append(edit, del);
    bar.appendChild(tools);
  }
  detailEl.appendChild(bar);

  detailEl.appendChild(el("h3", "knowledge-detail-title", dish.name));
  const meta = [dish.category, dish.active ? "" : t("ui.gerichte_inaktiv")].filter(Boolean).join(" · ");
  if (meta) detailEl.appendChild(el("p", "hint", meta));
  detailEl.appendChild(
    el(
      "p",
      "hint",
      t("ui.gerichte_gilt_fuer", {
        list: dish.departments.length === 0 ? t("ui.gerichte_alle_abteilungen") : dish.departments.map(departmentLabel).join(", "),
      })
    )
  );
  if (dish.description) detailEl.appendChild(el("p", "knowledge-summary", dish.description));

  if (dish.components.length > 0) {
    const ul = el("ul", "dish-components");
    dish.components.forEach((component) => {
      const li = el("li", null, component?.name ?? "");
      if (component?.note) li.appendChild(el("span", "hint", ` – ${component.note}`));
      ul.appendChild(li);
    });
    detailEl.appendChild(section("ui.gerichte_komponenten", ul));
  }

  detailEl.appendChild(allergenSection(dish));
  if (dish.traces.length > 0) {
    detailEl.appendChild(section("ui.gerichte_spuren", declarationChips(dish.traces, "allergen")));
  }
  if (dish.additives.length > 0) {
    detailEl.appendChild(section("ui.gerichte_zusatzstoffe", declarationChips(dish.additives, "additive")));
  }
  detailEl.appendChild(checkFooter(dish));
}

// ---------------------------------------------------------------------
// Ansichten
// ---------------------------------------------------------------------

function showList() {
  openDishId = null;
  detailEl.hidden = true;
  listViewEl.hidden = false;
  renderCategoryFilter();
  renderList();
}

function openDish(id) {
  openDishId = id;
  listViewEl.hidden = true;
  detailEl.hidden = false;
  renderDetail();
  detailEl.scrollIntoView?.({ block: "start" });
}

function startEditing(dish) {
  listViewEl.hidden = true;
  detailEl.hidden = true;
  openDishEditor(dish);
}

function handleEditorClosed(saved) {
  if (saved) {
    openDishId = saved.id;
    detailEl.hidden = false;
    listViewEl.hidden = true;
    renderDetail();
  } else if (openDishId && loadDishes().some((d) => d.id === openDishId)) {
    detailEl.hidden = false;
    renderDetail();
  } else {
    showList();
  }
}

async function handleDelete() {
  const dish = loadDishes().find((d) => d.id === openDishId);
  if (!dish || !can("dishes.write")) return;
  if (!confirm(t("ui.gerichte_loeschen_frage", { name: dish.name }))) return;
  try {
    await deleteDish(dish.id);
    showList();
  } catch (error) {
    alert(`${t("ui.gerichte_ed_fehler_loeschen")} ${error?.message ?? ""}`.trim());
  }
}

function refresh() {
  if (isDishEditorOpen()) return;
  if (openDishId) renderDetail();
  else {
    renderCategoryFilter();
    renderList();
  }
}

// Zum Gericht springen (Platz für die globale Suche).
export function focusDish(id) {
  if (isDishEditorOpen() && !confirmDiscardDishEditor()) return;
  switchTab("dishes");
  if (isDishEditorOpen()) return;
  openDish(id);
}

export function initDishes() {
  if (!listEl) return;
  initDishMatrix({ getContext: () => ({ dishes: visibleDishes(), scopeLabel: scopeLabel() }) });
  modeListBtn.addEventListener("click", () => setMode("list"));
  modeMatrixBtn.addEventListener("click", () => setMode("matrix"));
  searchEl.addEventListener("input", renderList);
  inactiveEl.addEventListener("change", renderList);
  departmentEl.addEventListener("change", () => {
    departmentFilter = departmentEl.value;
    renderList();
  });
  categoryEl.addEventListener("change", () => {
    categoryFilter = categoryEl.value;
    renderList();
  });
  listEl.addEventListener("click", (e) => {
    const row = e.target.closest(".dish-row");
    if (row) openDish(row.dataset.id);
  });
  detailEl.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "back") showList();
    else if (action === "edit") {
      const dish = loadDishes().find((d) => d.id === openDishId);
      if (dish && can("dishes.write")) startEditing(dish);
    } else if (action === "delete") handleDelete();
  });
  newBtn.addEventListener("click", () => startEditing(null));
  initDishEditor({ onClose: handleEditorClosed, departmentLabel });

  onDishesChanged(refresh);
  onDepartmentsChanged(() => {
    renderDepartmentFilter();
    refresh();
  });
  onLanguageChanged(() => {
    renderDepartmentFilter();
    refresh();
  });
  renderDepartmentFilter();
  renderCategoryFilter();
  renderList();
}

// Für die globale Suche: sichtbare Treffer, nur mit Modulfreigabe.
export function searchDishes(term, passes) {
  if (!canSee("dishes")) return [];
  return loadDishes()
    .filter((d) => d.active && [d.name, d.category, d.description, ...d.components.map((c) => c?.name)].some((v) => passes(v, term)))
    .map((d) => ({ art: "dish", id: d.id, name: d.name, zusatz: d.category }));
}
