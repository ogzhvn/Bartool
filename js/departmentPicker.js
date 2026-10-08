import { loadDepartments, loadDepartmentDefaults } from "./storage.js";
import { myDepartments } from "./auth.js";
import { t } from "./i18n.js";

// ---------------------------------------------------------------------
// Abteilungsauswahl für Betriebsdaten (Paket 65)
//
// Ein gemeinsamer Baustein für Ansätze, Übergaben, Checklisten, Inventur,
// Schwund und Events: „sichtbar für" als Chips je Abteilung. Die
// Eigentümer-Abteilung ist immer angehakt und gesperrt – die Datenbank
// ergänzt sie ohnehin (private.betrieb_dept_guard). Ohne Zeile in
// department_defaults ist beim Anlegen nur die eigene Abteilung gewählt.
//
// Labels kommen unübersetzt aus der Tabelle "departments" und werden nur
// per textContent gesetzt. Das Element hat keine übersetzten Texte außer
// dem aria-label; wer es auf Dauer zeigt, baut es bei onLanguageChanged()
// neu (wie das restliche Formular).
// ---------------------------------------------------------------------

function departmentLabel(key) {
  return loadDepartments().find((d) => d.key === key)?.label ?? key;
}

// Vorbelegung beim Anlegen: Standard-Freigabe für Modul × Abteilung, sonst
// nur die Abteilung selbst.
function defaultVisibleTo(moduleKey, owner) {
  if (!owner) return [];
  const vorgabe = loadDepartmentDefaults().find(
    (d) => d.moduleKey === moduleKey && d.departmentKey === owner
  );
  return [...new Set([owner, ...(vorgabe?.visibleTo ?? [])])];
}

// value: bestehender Eintrag ({ department, visibleTo }) oder leer beim
// Anlegen. editable: false zeigt die Chips nur an.
export function createDepartmentPicker({ moduleKey, value = null, editable = true } = {}) {
  const owner = value?.department || myDepartments()[0] || null;
  const selected = new Set(
    value && Array.isArray(value.visibleTo) && value.visibleTo.length
      ? value.visibleTo
      : defaultVisibleTo(moduleKey, owner)
  );
  if (owner) selected.add(owner);

  const element = document.createElement("div");
  element.className = "dept-picker";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", t("ui.sichtbar_fuer"));

  // Unbekannte Keys (Abteilung gelöscht, Liste offline leer) bleiben als
  // Chip stehen, damit getValue() nichts stillschweigend verliert.
  const keys = loadDepartments().map((d) => d.key);
  selected.forEach((key) => {
    if (!keys.includes(key)) keys.push(key);
  });

  keys.forEach((key) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "dept-chip";
    chip.dataset.department = key;
    chip.textContent = departmentLabel(key);
    const gesperrt = !editable || key === owner;
    chip.disabled = gesperrt;
    if (key === owner) chip.classList.add("owner");
    const render = () => {
      const an = selected.has(key);
      chip.classList.toggle("active", an);
      chip.setAttribute("aria-pressed", an ? "true" : "false");
    };
    render();
    if (!gesperrt) {
      chip.addEventListener("click", () => {
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        render();
      });
    }
    element.appendChild(chip);
  });

  return {
    element,
    getValue() {
      return [...selected].sort();
    },
  };
}

// Anzeige „Bar · WGR“: Eigentümer zuerst, danach die übrigen Freigaben in
// der Reihenfolge der Abteilungsliste.
export function departmentBadge(record) {
  const owner = record?.department || null;
  const sichtbar = new Set(Array.isArray(record?.visibleTo) ? record.visibleTo : []);
  if (owner) sichtbar.add(owner);
  const reihenfolge = loadDepartments().map((d) => d.key);
  const rang = (key) => {
    const i = reihenfolge.indexOf(key);
    return i === -1 ? reihenfolge.length : i;
  };
  const keys = [...sichtbar].sort((a, b) => {
    if (a === owner) return -1;
    if (b === owner) return 1;
    return rang(a) - rang(b) || a.localeCompare(b);
  });

  const badge = document.createElement("span");
  badge.className = "dept-badge";
  badge.textContent = keys.map(departmentLabel).join(" · ");
  badge.title = t("ui.sichtbar_fuer");
  return badge;
}
