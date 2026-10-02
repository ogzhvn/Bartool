import { getSupabaseClient } from "./supabaseClient.js";
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

const BAR_KEY = "bar";
const KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;

const matrixEl = document.getElementById("admin-departments-matrix");
const statusEl = document.getElementById("admin-departments-status");
const createForm = document.getElementById("admin-department-create-form");
const createError = document.getElementById("admin-department-create-error");
const newKeyEl = document.getElementById("admin-department-new-key");
const newLabelEl = document.getElementById("admin-department-new-label");

let abteilungen = [];
// department_key -> Set(module_key)
let modulZuordnung = new Map();
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
  const [abtAntwort, modAntwort, kontenAntwort] = await Promise.all([
    supabase.from("departments").select("key, label, sort").order("sort", { ascending: true }),
    supabase.from("department_modules").select("department_key, module_key"),
    // Nur für die Anzeige und die Löschsperre vorab; ohne users.manage sind
    // die Profile nicht lesbar, dann entscheidet der Fremdschlüssel.
    supabase.from("profiles").select("department"),
  ]);
  if (abtAntwort.error) throw abtAntwort.error;
  if (modAntwort.error) throw modAntwort.error;

  abteilungen = abtAntwort.data ?? [];
  modulZuordnung = new Map();
  (modAntwort.data ?? []).forEach(({ department_key, module_key }) => {
    if (!modulZuordnung.has(department_key)) modulZuordnung.set(department_key, new Set());
    modulZuordnung.get(department_key).add(module_key);
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

async function neuLaden() {
  try {
    await ladeDaten();
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
    await neuLaden();
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
    await neuLaden();
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
  await neuLaden();
  setStatus(`${label}: ${t("ui.abteilung_angelegt")}`);
}

export async function initAdminDepartments() {
  if (!matrixEl || geladen) return;
  geladen = true;

  matrixEl.addEventListener("click", (e) => {
    const card = e.target.closest(".role-card");
    if (!card) return;
    if (e.target.closest(".department-save")) speichern(card);
    if (e.target.closest(".department-delete")) loeschen(card);
  });

  createForm?.addEventListener("submit", anlegen);

  // Sprachwechsel: Modul- und Gruppenlabels kommen aus t(), also neu zeichnen.
  onLanguageChanged(render);

  await neuLaden();
}
