import { can } from "./auth.js";
import { loadDepartments, loadDishes, saveDish } from "./storage.js";
import { ADDITIVES, ALLERGEN_GROUPS, allergenSubtypes, declarationLabel, missingSubtypes } from "./declarations.js";
import { getAllProducts } from "./productLibrary.js";
import { onLanguageChanged, t } from "./i18n.js";

// Gerichte pflegen – Editor (Paket 71).
//
// Der Zustand liegt in `state`; Namen, Kategorie und Beschreibung schreiben
// direkt hinein, die Chipgruppen und der Prüfschalter werden bei jeder
// Änderung neu gezeichnet. Alles Nutzerseitige geht per value/textContent
// hinein, nie als HTML (Regel 5). Die Weinbegleitung (Paket 73) wählt ein
// Mensch aus dem Katalog (Gruppe Wein/Schaumwein) – es gibt keinen Vorschlag
// aus food_pairing. Gespeichert wird die Produkt-ID, nicht der Name.
//
// Prüfvermerk: Die Zeit und das Konto setzt der Server (Trigger
// private.dishes_guard). Der Editor meldet nur "jetzt geprüft" bzw. "Vermerk
// entfernen". Wer Allergene, Spuren oder Zusatzstoffe ändert, setzt den
// Schalter damit zurück und muss ihn bewusst neu setzen. Speichern ohne Haken
// warnt vorher, weil die Datenbank den Vermerk dann ohnehin löscht.

const formEl = document.getElementById("dishes-editor");

let options = { onClose: () => {}, departmentLabel: (key) => key };
let state = null;
let original = null;
let initialSnapshot = "";
let saving = false;
let errorEl = null;
let declEl = null;
let checkEl = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function sortedKeys(set) {
  return [...set].sort();
}

function newState(dish) {
  return {
    id: dish?.id ?? null,
    name: dish?.name ?? "",
    category: dish?.category ?? "",
    description: dish?.description ?? "",
    components: (dish?.components ?? []).map((c) => ({ name: c?.name ?? "", note: c?.note ?? "" })),
    departments: new Set(dish?.departments ?? []),
    allergens: new Set(dish?.allergens ?? []),
    traces: new Set(dish?.traces ?? []),
    additives: new Set(dish?.additives ?? []),
    active: dish ? dish.active !== false : true,
    sort: dish?.sort ?? 0,
    winePairings: (dish?.winePairings ?? []).map((w) => ({ product_id: w?.product_id ?? "", note: w?.note ?? "" })),
    checked: Boolean(dish?.allergensCheckedAt),
  };
}

function snapshot() {
  return JSON.stringify({
    name: state.name,
    category: state.category,
    description: state.description,
    components: state.components,
    departments: sortedKeys(state.departments),
    allergens: sortedKeys(state.allergens),
    traces: sortedKeys(state.traces),
    additives: sortedKeys(state.additives),
    active: state.active,
    wine: state.winePairings,
    checked: state.checked,
  });
}

function declarationsChanged() {
  const same = (a, b) => JSON.stringify(sortedKeys(a)) === JSON.stringify(sortedKeys(b));
  return !(
    same(state.allergens, original.allergens) &&
    same(state.traces, original.traces) &&
    same(state.additives, original.additives)
  );
}

export function isDishEditorOpen() {
  return !formEl.hidden;
}

export function isDishEditorDirty() {
  return isDishEditorOpen() && state !== null && snapshot() !== initialSnapshot;
}

export function confirmDiscardDishEditor() {
  return !isDishEditorDirty() || confirm(t("ui.gerichte_ed_verwerfen"));
}

function showError(message) {
  errorEl.textContent = message || "";
  errorEl.hidden = !message;
  if (message) errorEl.scrollIntoView?.({ block: "nearest" });
}

// ---------------------------------------------------------------------
// Formularteile
// ---------------------------------------------------------------------

function textField(labelKey, value, onInput, { multiline = false, maxLength = 200 } = {}) {
  const label = el("label");
  label.appendChild(el("span", null, t(labelKey)));
  const input = multiline ? el("textarea") : el("input");
  if (multiline) input.rows = 3;
  else {
    input.type = "text";
    input.autocomplete = "off";
  }
  input.maxLength = maxLength;
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  label.appendChild(input);
  return label;
}

function checkRow(labelText, checked, onChange) {
  const label = el("label", "knowledge-ed-check");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  label.append(box, el("span", null, labelText));
  return label;
}

function chip(label, active, onClick) {
  const button = el("button", "quiz-lb-chip dish-ed-chip", label);
  button.type = "button";
  button.setAttribute("aria-pressed", String(active));
  button.classList.toggle("active", active);
  button.addEventListener("click", onClick);
  return button;
}

function onDeclarationsChanged() {
  // Jede Änderung hebt die Bestätigung auf; wer zum Ausgangsstand zurückkehrt,
  // behält den bestehenden Vermerk.
  state.checked = declarationsChanged() ? false : original.checked;
  renderDeclarations();
  renderCheck();
}

// Allergene bzw. Spuren: Hauptgruppen als Chips, Arten klappen darunter auf.
// Steht eine Gruppe ohne Art, bleibt sie als "Art fehlt" sichtbar. Wird die
// erste Art gewählt, fällt die Hauptgruppe weg (wie in der Datenbank).
function allergenPicker(set) {
  const wrap = el("div", "dish-ed-groups");
  ALLERGEN_GROUPS.forEach((group) => {
    const subtypes = allergenSubtypes(group.key);
    const picked = subtypes.filter((s) => set.has(s.key));
    const active = set.has(group.key) || picked.length > 0;
    const block = el("div", "dish-ed-group");
    block.appendChild(
      chip(declarationLabel(group.key), active, () => {
        if (active) {
          set.delete(group.key);
          subtypes.forEach((s) => set.delete(s.key));
        } else {
          set.add(group.key);
        }
        onDeclarationsChanged();
      })
    );
    if (active && subtypes.length > 0) {
      const sub = el("div", "dish-ed-subtypes");
      sub.setAttribute("role", "group");
      sub.setAttribute("aria-label", `${declarationLabel(group.key)}: ${t("ui.gerichte_ed_arten")}`);
      if (picked.length === 0) sub.appendChild(el("p", "dish-chip dish-chip-warn", t("ui.gerichte_ed_arten_hinweis")));
      subtypes.forEach((s) => {
        sub.appendChild(
          chip(declarationLabel(s.key), set.has(s.key), () => {
            if (set.has(s.key)) set.delete(s.key);
            else set.add(s.key);
            // Keine Art mehr gewählt: Gruppe bleibt deklariert, Art fehlt.
            if (subtypes.some((x) => set.has(x.key))) set.delete(group.key);
            else set.add(group.key);
            onDeclarationsChanged();
          })
        );
      });
      block.appendChild(sub);
    }
    wrap.appendChild(block);
  });
  return wrap;
}

function additivePicker(set) {
  const wrap = el("div", "dish-ed-groups dish-ed-additives");
  ADDITIVES.forEach((a) => {
    wrap.appendChild(
      chip(declarationLabel(a.key, "additive"), set.has(a.key), () => {
        if (set.has(a.key)) set.delete(a.key);
        else set.add(a.key);
        onDeclarationsChanged();
      })
    );
  });
  return wrap;
}

function group(legendKey, ...content) {
  const fieldset = el("fieldset", "knowledge-ed-group");
  fieldset.appendChild(el("legend", null, t(legendKey)));
  fieldset.append(...content);
  return fieldset;
}

function renderDeclarations() {
  declEl.textContent = "";
  declEl.append(
    group("ui.gerichte_ed_allergene", allergenPicker(state.allergens)),
    group("ui.gerichte_ed_spuren", allergenPicker(state.traces)),
    group("ui.gerichte_ed_zusatzstoffe", additivePicker(state.additives))
  );
}

function renderCheck() {
  checkEl.textContent = "";
  const missing = missingSubtypes([...state.allergens]);
  if (missing.length > 0) state.checked = false;
  const row = checkRow(t("ui.gerichte_ed_geprueft"), state.checked, (value) => {
    state.checked = value;
  });
  const box = row.querySelector("input");
  box.disabled = missing.length > 0;
  checkEl.appendChild(row);
  checkEl.appendChild(
    el("p", "hint", missing.length > 0 ? t("ui.gerichte_ed_geprueft_art_fehlt") : t("ui.gerichte_ed_geprueft_hinweis"))
  );
}

function renderComponents(container) {
  container.textContent = "";
  state.components.forEach((component, index) => {
    const row = el("div", "dish-ed-component");
    const name = el("input");
    name.type = "text";
    name.maxLength = 200;
    name.autocomplete = "off";
    name.value = component.name;
    name.placeholder = t("ui.gerichte_ed_komponente_name");
    name.setAttribute("aria-label", t("ui.gerichte_ed_komponente_name"));
    name.addEventListener("input", () => {
      component.name = name.value;
    });
    const note = el("input");
    note.type = "text";
    note.maxLength = 300;
    note.autocomplete = "off";
    note.value = component.note;
    note.placeholder = t("ui.gerichte_ed_komponente_hinweis");
    note.setAttribute("aria-label", t("ui.gerichte_ed_komponente_hinweis"));
    note.addEventListener("input", () => {
      component.note = note.value;
    });
    const remove = el("button", "btn-secondary btn-icon");
    remove.type = "button";
    remove.title = t("ui.entfernen");
    remove.setAttribute("aria-label", t("ui.entfernen"));
    const trash = document.createElement("i");
    trash.className = "ph ph-trash";
    trash.setAttribute("aria-hidden", "true");
    remove.appendChild(trash);
    remove.addEventListener("click", () => {
      state.components.splice(index, 1);
      renderComponents(container);
    });
    row.append(name, note, remove);
    container.appendChild(row);
  });
}

// ---------------------------------------------------------------------
// Weinbegleitung (Paket 73)
// ---------------------------------------------------------------------

const WINE_GROUPS = ["Wein", "Schaumwein"];
const MAX_WINES = 3;
let wineQuery = "";

function wineFacts(product) {
  return [product.sweetness, product.body, product.foodPairing].filter(Boolean).join(" · ");
}

function iconButton(iconName, label, onClick, disabled = false) {
  const button = el("button", "btn-secondary btn-icon");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.disabled = disabled;
  const i = document.createElement("i");
  i.className = `ph ${iconName}`;
  i.setAttribute("aria-hidden", "true");
  button.appendChild(i);
  button.addEventListener("click", onClick);
  return button;
}

function wineSection() {
  const fieldset = el("fieldset", "knowledge-ed-group");
  fieldset.appendChild(el("legend", null, t("ui.gerichte_ed_wein")));
  const selectedEl = el("div", "dish-ed-wines");
  const resultsEl = el("div", "dish-ed-wine-results");
  const search = el("input");
  search.type = "text";
  search.autocomplete = "off";
  search.maxLength = 80;
  search.value = wineQuery;
  search.placeholder = t("ui.gerichte_ed_wein_suche");
  search.setAttribute("aria-label", t("ui.gerichte_ed_wein_suche"));

  const renderResults = () => {
    resultsEl.textContent = "";
    if (state.winePairings.length >= MAX_WINES) {
      resultsEl.appendChild(el("p", "hint", t("ui.gerichte_ed_wein_max", { n: MAX_WINES })));
      return;
    }
    const term = wineQuery.trim().toLowerCase();
    const taken = new Set(state.winePairings.map((w) => w.product_id));
    const hits = getAllProducts()
      .filter((p) => WINE_GROUPS.includes(p.group) && !taken.has(p.id))
      .filter((p) => !term || [p.name, p.foodPairing, p.sweetness, p.body].some((v) => (v ?? "").toLowerCase().includes(term)))
      .slice(0, 12);
    if (hits.length === 0) {
      resultsEl.appendChild(el("p", "hint", t("ui.gerichte_ed_wein_keine")));
      return;
    }
    hits.forEach((p) => {
      const button = el("button", "dish-ed-wine-hit");
      button.type = "button";
      button.appendChild(el("strong", null, p.name));
      const facts = wineFacts(p);
      if (facts) button.appendChild(el("span", "hint", facts));
      button.addEventListener("click", () => {
        state.winePairings.push({ product_id: p.id, note: "" });
        renderSelected();
        renderResults();
      });
      resultsEl.appendChild(button);
    });
  };

  const renderSelected = () => {
    selectedEl.textContent = "";
    state.winePairings.forEach((pairing, index) => {
      const product = getAllProducts().find((p) => p.id === pairing.product_id);
      const row = el("div", "dish-ed-wine");
      const head = el("div", "dish-ed-wine-head");
      const title = el("div", "dish-ed-wine-title");
      title.appendChild(el("strong", null, product ? product.name : t("ui.gerichte_wein_nicht_im_sortiment")));
      if (product && wineFacts(product)) title.appendChild(el("span", "hint", wineFacts(product)));
      head.appendChild(title);
      head.append(
        iconButton("ph-arrow-up", t("ui.nach_oben"), () => {
          [state.winePairings[index - 1], state.winePairings[index]] = [state.winePairings[index], state.winePairings[index - 1]];
          renderSelected();
        }, index === 0),
        iconButton("ph-arrow-down", t("ui.nach_unten"), () => {
          [state.winePairings[index + 1], state.winePairings[index]] = [state.winePairings[index], state.winePairings[index + 1]];
          renderSelected();
        }, index === state.winePairings.length - 1),
        iconButton("ph-trash", t("ui.entfernen"), () => {
          state.winePairings.splice(index, 1);
          renderSelected();
          renderResults();
        })
      );
      const note = el("input");
      note.type = "text";
      note.maxLength = 300;
      note.autocomplete = "off";
      note.value = pairing.note;
      note.placeholder = t("ui.gerichte_ed_wein_notiz");
      note.setAttribute("aria-label", t("ui.gerichte_ed_wein_notiz"));
      note.addEventListener("input", () => {
        pairing.note = note.value;
      });
      row.append(head, note);
      selectedEl.appendChild(row);
    });
  };

  search.addEventListener("input", () => {
    wineQuery = search.value;
    renderResults();
  });
  renderSelected();
  renderResults();
  fieldset.append(selectedEl, search, resultsEl);
  return fieldset;
}

function buildForm() {
  formEl.textContent = "";
  formEl.appendChild(el("h3", null, state.id ? t("ui.gerichte_ed_bearbeiten") : t("ui.gerichte_ed_neu")));

  formEl.appendChild(textField("ui.gerichte_ed_name", state.name, (v) => (state.name = v)));
  formEl.appendChild(textField("ui.gerichte_ed_kategorie", state.category, (v) => (state.category = v), { maxLength: 80 }));
  formEl.appendChild(
    textField("ui.gerichte_ed_beschreibung", state.description, (v) => (state.description = v), {
      multiline: true,
      maxLength: 2000,
    })
  );

  const componentsEl = el("div", "dish-ed-components");
  renderComponents(componentsEl);
  const addComponent = el("button", "btn-secondary", t("ui.gerichte_ed_komponente_hinzufuegen"));
  addComponent.type = "button";
  addComponent.addEventListener("click", () => {
    state.components.push({ name: "", note: "" });
    renderComponents(componentsEl);
    componentsEl.querySelector(".dish-ed-component:last-child input")?.focus();
  });
  formEl.appendChild(group("ui.gerichte_ed_komponenten", componentsEl, addComponent));

  // Abteilungen, die das Gericht trägt, die es aber nicht (mehr) in der Liste
  // gibt, bleiben als Haken stehen und gehen beim Speichern nicht verloren.
  const departmentsEl = el("div", "knowledge-ed-checks");
  const keys = loadDepartments().map((d) => d.key);
  state.departments.forEach((key) => {
    if (!keys.includes(key)) keys.push(key);
  });
  keys.forEach((key) => {
    departmentsEl.appendChild(
      checkRow(options.departmentLabel(key), state.departments.has(key), (checked) => {
        if (checked) state.departments.add(key);
        else state.departments.delete(key);
      })
    );
  });
  formEl.appendChild(group("ui.gerichte_ed_abteilungen", departmentsEl));

  formEl.appendChild(checkRow(t("ui.gerichte_ed_aktiv"), state.active, (v) => (state.active = v)));

  formEl.appendChild(wineSection());

  declEl = el("div", "dish-ed-decl");
  checkEl = el("div", "dish-ed-check");
  renderDeclarations();
  renderCheck();
  formEl.append(declEl, checkEl);

  errorEl = el("p", "error-note");
  errorEl.setAttribute("role", "alert");
  errorEl.hidden = true;
  const actions = el("div", "actions knowledge-ed-actions");
  const save = el("button", "btn-primary", t("ui.speichern"));
  save.type = "submit";
  const cancel = el("button", "btn-secondary", t("ui.abbrechen"));
  cancel.type = "button";
  cancel.addEventListener("click", () => close(null));
  actions.append(save, cancel);
  formEl.append(errorEl, actions);
}

// ---------------------------------------------------------------------
// Speichern
// ---------------------------------------------------------------------

function validate() {
  const name = state.name.trim();
  if (!name) return t("ui.gerichte_ed_fehler_name");
  const clash = loadDishes().some(
    (d) => d.id !== state.id && d.name.trim().toLowerCase() === name.toLowerCase()
  );
  if (clash) return t("ui.gerichte_ed_fehler_name_doppelt");
  for (let i = 0; i < state.components.length; i += 1) {
    const c = state.components[i];
    if (!c.name.trim() && c.note.trim()) return t("ui.gerichte_ed_fehler_komponente", { nr: i + 1 });
  }
  return "";
}

function errorText(error) {
  if (error?.code === "23505") return t("ui.gerichte_ed_fehler_name_doppelt");
  return `${t("ui.gerichte_ed_fehler_speichern")} ${error?.message ?? ""}`.trim();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (saving || !can("dishes.write")) return;
  const problem = validate();
  showError(problem);
  if (problem) return;

  const changed = declarationsChanged();
  const hadCheck = original.checked;
  // Haken aus + Angaben geändert + Vermerk vorhanden: Die DB löscht den Vermerk,
  // vorher fragen. Neue Gerichte haben nichts zu verlieren.
  if (!state.checked && changed && hadCheck && !confirm(t("ui.gerichte_ed_aenderung_warnung"))) return;

  const dish = {
    id: state.id,
    name: state.name,
    category: state.category,
    description: state.description,
    components: state.components
      .filter((c) => c.name.trim())
      .map((c) => ({ name: c.name.trim(), ...(c.note.trim() ? { note: c.note.trim() } : {}) })),
    departments: sortedKeys(state.departments),
    allergens: sortedKeys(state.allergens),
    traces: sortedKeys(state.traces),
    additives: sortedKeys(state.additives),
    winePairings: state.winePairings.map((w) => ({
      product_id: w.product_id,
      ...(w.note.trim() ? { note: w.note.trim() } : {}),
    })),
    active: state.active,
    sort: state.sort,
    checkAllergens: state.checked && (changed || !hadCheck),
    clearAllergenCheck: !state.checked && hadCheck && !changed,
  };

  saving = true;
  try {
    const saved = await saveDish(dish);
    close(saved);
  } catch (error) {
    showError(errorText(error));
  } finally {
    saving = false;
  }
}

function close(saved) {
  if (!saved && !confirmDiscardDishEditor()) return;
  formEl.hidden = true;
  formEl.textContent = "";
  state = null;
  original = null;
  options.onClose(saved);
}

export function openDishEditor(dish) {
  if (!can("dishes.write")) return;
  state = newState(dish);
  wineQuery = "";
  original = {
    allergens: new Set(state.allergens),
    traces: new Set(state.traces),
    additives: new Set(state.additives),
    checked: state.checked,
  };
  buildForm();
  initialSnapshot = snapshot();
  formEl.hidden = false;
  formEl.scrollIntoView?.({ block: "start" });
}

export function initDishEditor(opts) {
  options = { ...options, ...opts };
  formEl.addEventListener("submit", handleSubmit);
  onLanguageChanged(() => {
    if (isDishEditorOpen() && state) buildForm();
  });
}
