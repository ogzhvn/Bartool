import { getSupabaseClient } from "./supabaseClient.js";
import { reloadDepartments } from "./storage.js";
import { modulesByGroup, moduleLabel, moduleGroupLabel, moduleKeys } from "./modules.js";
import { t, onLanguageChanged } from "./i18n.js";

// Abteilungen und Modul-Matrix im Adminbereich (Sub-Tab "admin-departments",
// Paket 52).
//
// Eine Karte je Abteilung (wie bei den Rollen, js/adminRoles.js: auf dem Handy
// taugt keine breite Tabelle), darin die Module nach Gruppen aus
// js/modules.js. Gespeichert wird pro Karte: Bezeichnung in "departments",
// Häkchen als Zeilen in "department_modules" (fehlende Zeile = Modul aus).
//
// Das ist Kosmetik, kein Zugriffsschutz – die Navigation liest die Tabelle beim
// Anmelden (js/auth.js). Schreiben dürfen nur Konten mit "roles.manage", das
// setzt die RLS in der Datenbank durch. Alle Ausgaben laufen über
// textContent, Abteilungs-Labels kommen aus der DB.
//
// Paket 69: Abschnitt „Standard-Freigabe" je Karte. Je Betriebsmodul mit
// Abteilungsauswahl Chips der übrigen Abteilungen; gespeichert in
// "department_defaults" (Zeile nur, wenn mindestens eine weitere Abteilung
// gewählt ist). js/departmentPicker.js liest das beim Anlegen als
// Vorbelegung, abwählbar. Schreiben nur mit "roles.manage" (RLS).

const BAR_KEY = "bar";
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
// Betriebsmodule mit Abteilungsauswahl (moduleKey in createDepartmentPicker).
// „Was kann ich bauen?" legt nichts an und fehlt deshalb.
const DEFAULT_MODULES = ["preparations", "events", "shift-log", "checklists", "inventory", "losses"];

const matrixEl = document.getElementById("admin-departments-matrix");
const statusEl = document.getElementById("admin-departments-status");
const createForm = document.getElementById("admin-department-create-form");
const createError = document.getElementById("admin-department-create-error");
const newKeyEl = document.getElementById("admin-department-new-key");
const newLabelEl = document.getElementById("admin-department-new-label");

let abteilungen = [];
// department_key -> Set(module_key)
let modulZuordnung = new Map();
// department_key -> Map(module_key -> Set(weitere Abteilungen))
let standardFreigaben = new Map();
// department_key -> Anzahl Konten (null, wenn nicht lesbar)
let kontenJeAbteilung = null;
let geladen = false;

function setStatus(text, istFehler = false) {
  if (!statusEl) return;
  statusEl.textContent = text ?? "";
  statusEl.hidden = !text;
  statusEl.classList.toggle("error-note", Boolean(istFehler));
  statusEl.classList.toggle("hint", !istFehler);
}

async function ladeDaten() {
  const supabase = getSupabaseClient();
  const [abtAntwort, modAntwort, vorgabenAntwort, kontenAntwort] = await Promise.all([
    supabase.from("departments").select("key, label, sort").order("sort", { ascending: true }),
    supabase.from("department_modules").select("department_key, module_key"),
    supabase.from("department_defaults").select("module_key, department_key, visible_to"),
    // Nur für die Anzeige und die Löschsperre vorab; ohne users.manage sind
    // die Profile nicht lesbar, dann entscheidet der Fremdschlüssel.
    supabase.from("profiles").select("department"),
  ]);
  if (abtAntwort.error) throw abtAntwort.error;
  if (modAntwort.error) throw modAntwort.error;
  if (vorgabenAntwort.error) throw vorgabenAntwort.error;

  abteilungen = abtAntwort.data ?? [];
  modulZuordnung = new Map();
  (modAntwort.data ?? []).forEach(({ department_key, module_key }) => {
    if (!modulZuordnung.has(department_key)) modulZuordnung.set(department_key, new Set());
    modulZuordnung.get(department_key).add(module_key);
  });

  standardFreigaben = new Map();
  (vorgabenAntwort.data ?? []).forEach(({ module_key, department_key, visible_to }) => {
    if (!standardFreigaben.has(department_key)) standardFreigaben.set(department_key, new Map());
    const weitere = (visible_to ?? []).filter((k) => k !== department_key);
    standardFreigaben.get(department_key).set(module_key, new Set(weitere));
  });

  kontenJeAbteilung = null;
  if (!kontenAntwort.error && Array.isArray(kontenAntwort.data)) {
    kontenJeAbteilung = new Map();
    kontenAntwort.data.forEach((zeile) => {
      kontenJeAbteilung.set(zeile.department, (kontenJeAbteilung.get(zeile.department) ?? 0) + 1);
    });
  }
}

function badge(text, klasse) {
  const el = document.createElement("span");
  el.className = klasse;
  el.textContent = text;
  return el;
}

function modulBlock(abteilung) {
  const wrapper = document.createElement("div");
  wrapper.className = "role-perm-grid";
  const gesetzt = modulZuordnung.get(abteilung.key) ?? new Set();

  modulesByGroup().forEach((gruppe) => {
    const spalte = document.createElement("div");
    spalte.className = "role-perm-group";

    const titel = document.createElement("h4");
    titel.textContent = moduleGroupLabel(gruppe.key);
    spalte.appendChild(titel);

    gruppe.modules.forEach((modul) => {
      const label = document.createElement("label");
      label.className = "role-perm";

      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = modul.key;
      box.checked = gesetzt.has(modul.key);

      const text = document.createElement("span");
      text.className = "role-perm-text";
      const name = document.createElement("span");
      name.textContent = moduleLabel(modul.key);
      text.appendChild(name);

      label.append(box, text);
      spalte.appendChild(label);
    });

    wrapper.appendChild(spalte);
  });

  return wrapper;
}

// Chips der übrigen Abteilungen je Betriebsmodul. Zustand steht in
// aria-pressed, gelesen wird er erst beim Speichern der Karte.
function freigabeBlock(abteilung) {
  const andere = abteilungen.filter((a) => a.key !== abteilung.key);
  if (andere.length === 0) return null;
  const vorgaben = standardFreigaben.get(abteilung.key) ?? new Map();

  const block = document.createElement("div");
  block.className = "role-perm-group department-defaults";

  const titel = document.createElement("h4");
  titel.textContent = t("ui.standard_freigabe");
  block.appendChild(titel);

  const hinweis = document.createElement("p");
  hinweis.className = "hint";
  hinweis.textContent = t("ui.standard_freigabe_hinweis");
  block.appendChild(hinweis);

  DEFAULT_MODULES.forEach((modulKey) => {
    const feld = document.createElement("div");
    feld.className = "dept-field";
    feld.dataset.module = modulKey;

    const label = document.createElement("span");
    label.className = "dept-field-label";
    label.textContent = moduleLabel(modulKey);
    feld.appendChild(label);

    const chips = document.createElement("div");
    chips.className = "dept-picker";
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", `${moduleLabel(modulKey)}: ${t("ui.sichtbar_fuer")}`);
    const gewaehlt = vorgaben.get(modulKey) ?? new Set();
    andere.forEach((a) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "dept-chip department-default-chip";
      chip.dataset.department = a.key;
      chip.textContent = a.label;
      const an = gewaehlt.has(a.key);
      chip.classList.toggle("active", an);
      chip.setAttribute("aria-pressed", an ? "true" : "false");
      chips.appendChild(chip);
    });
    feld.appendChild(chips);
    block.appendChild(feld);
  });

  return block;
}

function abteilungCard(abteilung) {
  const card = document.createElement("div");
  card.className = "role-card";
  card.dataset.department = abteilung.key;

  const kopf = document.createElement("div");
  kopf.className = "role-card-head";
  const titel = document.createElement("h3");
  titel.textContent = abteilung.label;
  kopf.appendChild(titel);
  const anzahl = kontenJeAbteilung?.get(abteilung.key);
  if (anzahl != null) kopf.appendChild(badge(`${anzahl} ${t("ui.konten")}`, "role-flag"));
  card.appendChild(kopf);

  const schluessel = document.createElement("p");
  schluessel.className = "prep-meta";
  schluessel.textContent = abteilung.key;
  card.appendChild(schluessel);

  const nameFeld = document.createElement("label");
  nameFeld.className = "role-label-field";
  const nameText = document.createElement("span");
  nameText.textContent = t("ui.bezeichnung");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "role-label-input";
  nameInput.value = abteilung.label;
  nameInput.maxLength = 60;
  nameFeld.append(nameText, nameInput);
  card.appendChild(nameFeld);

  card.appendChild(modulBlock(abteilung));
  const freigaben = freigabeBlock(abteilung);
  if (freigaben) card.appendChild(freigaben);

  const aktionen = document.createElement("div");
  aktionen.className = "actions";

  const speichern = document.createElement("button");
  speichern.type = "button";
  speichern.className = "btn-primary department-save";
  speichern.textContent = t("ui.speichern");
  aktionen.appendChild(speichern);

  // "bar" ist die Rückfallebene für alle bestehenden Konten und bleibt.
  if (abteilung.key !== BAR_KEY) {
    const loeschen = document.createElement("button");
    loeschen.type = "button";
    loeschen.className = "btn-secondary department-delete";
    loeschen.textContent = t("ui.loeschen");
    aktionen.appendChild(loeschen);
  }

  const meldung = document.createElement("span");
  meldung.className = "role-card-status";
  aktionen.appendChild(meldung);
  card.appendChild(aktionen);

  return card;
}

function render() {
  if (!matrixEl) return;
  matrixEl.textContent = "";

  if (abteilungen.length === 0) {
    const leer = document.createElement("p");
    leer.className = "empty-note";
    leer.textContent = t("ui.keine_abteilungen_gefunden");
    matrixEl.appendChild(leer);
    return;
  }

  abteilungen.forEach((a) => matrixEl.appendChild(abteilungCard(a)));

  const fussnote = document.createElement("p");
  fussnote.className = "hint";
  fussnote.textContent = t("ui.module_wirken_nach_der_naechsten_anmeldung");
  matrixEl.appendChild(fussnote);
}

async function neuLaden({ cacheAuffrischen = false } = {}) {
  try {
    await ladeDaten();
    // Picker in den Betriebsmodulen lesen Abteilungen und Vorgaben aus dem
    // Cache in storage.js.
    if (cacheAuffrischen) await reloadDepartments();
  } catch (error) {
    setStatus(`${t("ui.abteilungen_konnten_nicht_geladen_werden")} ${error.message}`, true);
  }
  render();
}

async function speichern(card) {
  const key = card.dataset.department;
  const abteilung = abteilungen.find((a) => a.key === key);
  const meldung = card.querySelector(".role-card-status");
  if (!abteilung) return;

  const katalog = new Set(moduleKeys());
  const gewuenscht = new Set(
    [...card.querySelectorAll(".role-perm input[type='checkbox']")]
      .filter((box) => box.checked && katalog.has(box.value))
      .map((box) => box.value)
  );
  const vorher = modulZuordnung.get(key) ?? new Set();
  const hinzu = [...gewuenscht].filter((k) => !vorher.has(k));
  const weg = [...vorher].filter((k) => !gewuenscht.has(k) && katalog.has(k));
  const neuesLabel = card.querySelector(".role-label-input")?.value.trim() ?? abteilung.label;

  // Standard-Freigaben: nur geänderte Module schreiben; leere Auswahl = Zeile weg.
  const bekannteAbteilungen = new Set(abteilungen.map((a) => a.key));
  const vorgabenVorher = standardFreigaben.get(key) ?? new Map();
  const freigabeSetzen = [];
  const freigabeWeg = [];
  card.querySelectorAll(".department-defaults .dept-field").forEach((feld) => {
    const modulKey = feld.dataset.module;
    if (!DEFAULT_MODULES.includes(modulKey)) return;
    const weitere = [...feld.querySelectorAll(".department-default-chip[aria-pressed='true']")]
      .map((chip) => chip.dataset.department)
      .filter((k) => k !== key && bekannteAbteilungen.has(k))
      .sort();
    const alt = [...(vorgabenVorher.get(modulKey) ?? [])].sort();
    if (weitere.join(",") === alt.join(",")) return;
    if (weitere.length > 0) {
      freigabeSetzen.push({ module_key: modulKey, department_key: key, visible_to: [key, ...weitere] });
    } else if (vorgabenVorher.has(modulKey)) {
      freigabeWeg.push(modulKey);
    }
  });

  if (!neuesLabel) {
    setStatus(t("ui.bezeichnung_fehlt"), true);
    return;
  }
  if (meldung) meldung.textContent = t("ui.wird_gespeichert");
  const supabase = getSupabaseClient();

  try {
    if (neuesLabel !== abteilung.label) {
      const { error } = await supabase.from("departments").update({ label: neuesLabel }).eq("key", key);
      if (error) throw error;
    }
    if (weg.length > 0) {
      const { error } = await supabase
        .from("department_modules")
        .delete()
        .eq("department_key", key)
        .in("module_key", weg);
      if (error) throw error;
    }
    if (hinzu.length > 0) {
      const { error } = await supabase
        .from("department_modules")
        .insert(hinzu.map((module_key) => ({ department_key: key, module_key })));
      if (error) throw error;
    }
    if (freigabeSetzen.length > 0) {
      const { error } = await supabase
        .from("department_defaults")
        .upsert(freigabeSetzen, { onConflict: "module_key,department_key" });
      if (error) throw error;
    }
    if (freigabeWeg.length > 0) {
      const { error } = await supabase
        .from("department_defaults")
        .delete()
        .eq("department_key", key)
        .in("module_key", freigabeWeg);
      if (error) throw error;
    }
    await neuLaden({ cacheAuffrischen: true });
    setStatus(`${neuesLabel}: ${t("ui.module_gespeichert")}`);
  } catch (error) {
    if (meldung) meldung.textContent = "";
    setStatus(`${t("ui.speichern_fehlgeschlagen")} ${error.message}`, true);
  }
}

async function loeschen(card) {
  const key = card.dataset.department;
  const abteilung = abteilungen.find((a) => a.key === key);
  if (!abteilung || key === BAR_KEY) return;

  const anzahl = kontenJeAbteilung?.get(key) ?? 0;
  if (anzahl > 0) {
    setStatus(`${t("ui.abteilung_hat_noch_konten")} ${anzahl}`, true);
    return;
  }
  if (!confirm(`${t("ui.abteilung_wirklich_loeschen")} ${abteilung.label}?`)) return;

  const supabase = getSupabaseClient();
  try {
    // department_modules hängt per on delete cascade an der Abteilung; ein
    // zugeordnetes Konto lässt der Fremdschlüssel auf profiles nicht zu.
    const { error } = await supabase.from("departments").delete().eq("key", key);
    if (error) throw error;
    await neuLaden({ cacheAuffrischen: true });
    setStatus(`${abteilung.label}: ${t("ui.abteilung_geloescht")}`);
  } catch (error) {
    // 23503 = Fremdschlüssel: es hängen noch Konten an der Abteilung.
    const text =
      error.code === "23503"
        ? t("ui.abteilung_hat_noch_konten_kurz")
        : `${t("ui.loeschen_fehlgeschlagen")} ${error.message}`;
    setStatus(text, true);
    await neuLaden();
  }
}

async function anlegen(e) {
  e.preventDefault();
  if (createError) createError.hidden = true;
  const key = (newKeyEl?.value ?? "").trim().toLowerCase();
  const label = (newLabelEl?.value ?? "").trim();

  const fehler = (text) => {
    if (!createError) return;
    createError.hidden = false;
    createError.textContent = text;
  };

  if (!KEY_PATTERN.test(key)) return fehler(t("ui.abteilungsschluessel_ungueltig"));
  if (!label) return fehler(t("ui.bezeichnung_fehlt"));
  if (abteilungen.some((a) => a.key === key)) return fehler(t("ui.abteilungsschluessel_vergeben"));

  const sort = Math.max(0, ...abteilungen.map((a) => a.sort ?? 0)) + 10;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("departments").insert({ key, label, sort });
  if (error) return fehler(`${t("ui.abteilung_konnte_nicht_angelegt_werden")} ${error.message}`);

  createForm?.reset();
  await neuLaden({ cacheAuffrischen: true });
  setStatus(`${label}: ${t("ui.abteilung_angelegt")}`);
}

export async function initAdminDepartments() {
  if (!matrixEl || geladen) return;
  geladen = true;

  matrixEl.addEventListener("click", (e) => {
    const card = e.target.closest(".role-card");
    if (!card) return;
    const chip = e.target.closest(".department-default-chip");
    if (chip) {
      const an = chip.getAttribute("aria-pressed") !== "true";
      chip.classList.toggle("active", an);
      chip.setAttribute("aria-pressed", an ? "true" : "false");
      return;
    }
    if (e.target.closest(".department-save")) speichern(card);
    if (e.target.closest(".department-delete")) loeschen(card);
  });

  createForm?.addEventListener("submit", anlegen);

  // Sprachwechsel: Modul- und Gruppenlabels kommen aus t(), also neu zeichnen.
  onLanguageChanged(render);

  await neuLaden();
}
