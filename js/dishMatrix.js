import { ADDITIVES, ALLERGEN_GROUPS, allergenGroup, allergenSubtypes, declarationLabel } from "./declarations.js";
import { printDishMatrix } from "./printView.js";
import { formatDate, t } from "./i18n.js";

// Allergenmatrix (Paket 72): Zeilen = Gerichte, Spalten = die 14 Hauptgruppen
// plus Zusatzstoffe, dazu Gast-Filter und Druck. Wird von js/dishes.js
// aufgerufen und hat keinen eigenen Tab.
//
// Grundsatz wie im Modul: Ungeprüfte Gerichte (kein Prüfvermerk) erscheinen nie
// als "frei von" oder "passend". In der Matrix tragen sie "ungeprüft" statt
// leerer Zellen, im Gast-Filter fallen sie nur in eine Zahl.
//
// Gerichtnamen sind Nutzereingaben und gehen nur per textContent ins DOM.

const guestChipsEl = document.getElementById("dishes-guest-chips");
const guestClearEl = document.getElementById("dishes-guest-clear");
const printBtn = document.getElementById("dishes-matrix-print");
const resultEl = document.getElementById("dishes-matrix-result");

let getContext = () => ({ dishes: [], scopeLabel: "" });
// Vom Gast nicht vertragene Hauptgruppen (Schlüssel aus ALLERGEN_GROUPS).
const avoid = new Set();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------
// Auswertung (auch für den Druck)
// ---------------------------------------------------------------------

function groupSet(keys) {
  return new Set((keys ?? []).map((key) => allergenGroup(key)).filter(Boolean));
}

// Inhalt einer Zelle als Textliste: Arten ("Weizen"), bei Gruppen ohne Art
// oder ohne gewählte Art ein Punkt.
function cellLabels(keys, group) {
  const set = new Set(keys ?? []);
  if (!set.has(group.key) && !allergenSubtypes(group.key).some((s) => set.has(s.key))) return [];
  const subs = allergenSubtypes(group.key)
    .filter((s) => set.has(s.key))
    .map((s) => declarationLabel(s.key));
  return subs.length > 0 ? subs : ["●"];
}

// Spalten einer Zeile. Für ungeprüfte Gerichte gibt es keine Zellen.
export function matrixRow(dish) {
  const checked = Boolean(dish.allergensCheckedAt);
  return {
    name: dish.name,
    checked,
    cells: checked
      ? ALLERGEN_GROUPS.map((g) => ({
          contains: cellLabels(dish.allergens, g),
          traces: cellLabels(dish.traces, g),
        }))
      : [],
    additives: dish.additives,
  };
}

// Aufteilung für den Gast-Filter. "unchecked" zählt nur, nie als passend.
export function guestSplit(dishes, avoidGroups) {
  const result = { ok: [], tracesOnly: [], excluded: [], unchecked: [] };
  dishes.forEach((dish) => {
    if (!dish.allergensCheckedAt) {
      result.unchecked.push(dish);
      return;
    }
    const contains = groupSet(dish.allergens);
    const traces = groupSet(dish.traces);
    const hit = (set) => [...avoidGroups].some((g) => set.has(g));
    if (hit(contains)) result.excluded.push(dish);
    else if (hit(traces)) result.tracesOnly.push(dish);
    else result.ok.push(dish);
  });
  return result;
}

// ---------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------

function matrixTable(dishes) {
  const wrap = el("div", "dish-matrix-scroll");
  const table = el("table", "dish-matrix");
  const head = el("thead");
  const headRow = el("tr");
  const corner = el("th", "dish-matrix-name", t("ui.gerichte_matrix_gericht"));
  corner.scope = "col";
  headRow.appendChild(corner);
  ALLERGEN_GROUPS.forEach((g) => {
    const th = el("th", null, declarationLabel(g.key));
    th.scope = "col";
    headRow.appendChild(th);
  });
  const additiveHead = el("th", null, t("ui.gerichte_zusatzstoffe"));
  additiveHead.scope = "col";
  headRow.appendChild(additiveHead);
  head.appendChild(headRow);
  table.appendChild(head);

  const body = el("tbody");
  dishes.forEach((dish) => {
    const row = matrixRow(dish);
    const tr = el("tr", row.checked ? null : "dish-matrix-unchecked");
    const name = el("th", "dish-matrix-name", row.name);
    name.scope = "row";
    tr.appendChild(name);
    if (!row.checked) {
      const note = el("td", "dish-matrix-unchecked-note", t("ui.gerichte_matrix_ungeprueft"));
      note.colSpan = ALLERGEN_GROUPS.length + 1;
      tr.appendChild(note);
    } else {
      row.cells.forEach((cell) => {
        const td = el("td");
        if (cell.contains.length > 0) td.appendChild(el("span", "dish-cell-contains", cell.contains.join(", ")));
        if (cell.traces.length > 0) {
          td.appendChild(el("span", "dish-cell-trace", `${t("ui.gerichte_matrix_spuren")} ${cell.traces.join(", ")}`));
        }
        tr.appendChild(td);
      });
      tr.appendChild(el("td", null, row.additives.map((key) => declarationLabel(key, "additive")).join(", ")));
    }
    body.appendChild(tr);
  });
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

function listSection(titleKey, dishes, count) {
  const wrap = el("section", "dish-matrix-section");
  wrap.appendChild(el("h4", null, `${t(titleKey)} (${count ?? dishes.length})`));
  if (dishes.length > 0) wrap.appendChild(matrixTable(dishes));
  else wrap.appendChild(el("p", "empty-note", t("ui.gerichte_matrix_keine")));
  return wrap;
}

function renderGuestChips() {
  guestChipsEl.textContent = "";
  ALLERGEN_GROUPS.forEach((g) => {
    const chip = el("button", "dish-guest-chip", declarationLabel(g.key));
    chip.type = "button";
    chip.dataset.group = g.key;
    chip.setAttribute("aria-pressed", avoid.has(g.key) ? "true" : "false");
    guestChipsEl.appendChild(chip);
  });
  guestClearEl.hidden = avoid.size === 0;
}

export function renderMatrix() {
  const { dishes } = getContext();
  renderGuestChips();
  resultEl.textContent = "";
  if (dishes.length === 0) {
    resultEl.appendChild(el("p", "empty-note", t("ui.gerichte_leer")));
    printBtn.disabled = true;
    return;
  }
  printBtn.disabled = false;

  if (avoid.size === 0) {
    resultEl.appendChild(matrixTable(dishes));
    return;
  }
  const split = guestSplit(dishes, avoid);
  resultEl.appendChild(listSection("ui.gerichte_matrix_passend", split.ok));
  if (split.tracesOnly.length > 0) {
    resultEl.appendChild(listSection("ui.gerichte_matrix_nur_spuren", split.tracesOnly));
  }
  if (split.unchecked.length > 0) {
    resultEl.appendChild(
      el(
        "p",
        "dish-unchecked-note",
        t(split.unchecked.length === 1 ? "ui.gerichte_matrix_ungeprueft_eins" : "ui.gerichte_matrix_ungeprueft_n", {
          n: split.unchecked.length,
        })
      )
    );
  }
}

// ---------------------------------------------------------------------
// Druck
// ---------------------------------------------------------------------

function handlePrint() {
  const { dishes, scopeLabel } = getContext();
  const checked = dishes.filter((d) => d.allergensCheckedAt);
  if (checked.length === 0) {
    alert(t("ui.gerichte_matrix_druck_leer"));
    return;
  }
  const oldest = new Date(Math.min(...checked.map((d) => new Date(d.allergensCheckedAt).getTime())));
  const used = new Set(checked.flatMap((d) => d.additives));
  printDishMatrix({
    scopeLabel,
    printedAt: formatDate(new Date()),
    stand: formatDate(oldest),
    groups: ALLERGEN_GROUPS.map((g) => declarationLabel(g.key)),
    rows: checked.map(matrixRow),
    legend: ADDITIVES.filter((a) => used.has(a.key)).map((a) => ({
      key: a.key,
      code: a.lmzdv,
      label: declarationLabel(a.key, "additive"),
    })),
  });
}

export function initDishMatrix(options) {
  if (!resultEl) return;
  getContext = options.getContext;
  guestChipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest("button[data-group]");
    if (!chip) return;
    const key = chip.dataset.group;
    if (avoid.has(key)) avoid.delete(key);
    else avoid.add(key);
    renderMatrix();
  });
  guestClearEl.addEventListener("click", () => {
    avoid.clear();
    renderMatrix();
  });
  printBtn.addEventListener("click", handlePrint);
}
