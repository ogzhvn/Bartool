import { getSupabaseClient } from "./supabaseClient.js";
import { loadRoles, getRolesSync } from "./roles.js";
import { myRank } from "./auth.js";
import {
  permissionsByGroup,
  permissionLabel,
  permissionHint,
  permissionKeys,
  RANK_BASED_PERMISSIONS,
  PERMISSIONS,
} from "./permissions.js";
import { t, onLanguageChanged } from "./i18n.js";

// Rechte-Matrix im Adminbereich (Sub-Tab "admin-roles", Paket 36).
//
// Eine Karte je Rolle, darin die 16 Rechte nach Gruppen, ein Speichern pro
// Karte. Bewusst Karten statt einer 16 Spalten breiten Tabelle: das Tool läuft
// hinterm Tresen auf dem Handy, und dort wäre eine Matrix-Tabelle nur noch
// seitwärts zu lesen.
//
// Zwei Regeln stehen über allem und werden in der Datenbank durchgesetzt,
// nicht hier: Rollen mit gleichem oder höherem Rang als dem eigenen sind
// tabu (RLS auf roles/role_permissions), und Rang >= 100 hat immer alle
// Rechte (private.has_permission()). Die Oberfläche zeigt das nur.
//
// Alle Ausgaben laufen über textContent bzw. createElement – Rollen-Labels
// kommen aus der Datenbank und dürfen niemals als HTML landen.

const matrixEl = document.getElementById("admin-roles-matrix");
const statusEl = document.getElementById("admin-roles-status");
const createForm = document.getElementById("admin-role-create-form");
const createError = document.getElementById("admin-role-create-error");
const newKeyEl = document.getElementById("admin-role-new-key");
const newLabelEl = document.getElementById("admin-role-new-label");
const newRankEl = document.getElementById("admin-role-new-rank");

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;

// role_key -> Set(permission_key)
let rollenRechte = new Map();
// role_key -> Anzahl zugewiesener Konten (null, wenn nicht lesbar)
let kontenJeRolle = null;
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
  await loadRoles({ force: true });

  const [rechteAntwort, katalogAntwort, kontenAntwort] = await Promise.all([
    supabase.from("role_permissions").select("role_key, permission_key"),
    supabase.from("permissions").select("key"),
    // Nur zur Anzeige "x Konten": ohne users.manage darf dieses Konto die
    // Profile nicht lesen. Dann bleibt die Zahl weg, die Löschsperre kommt
    // ohnehin aus dem Fremdschlüssel in der Datenbank.
    supabase.from("profiles").select("role"),
  ]);

  if (rechteAntwort.error) throw rechteAntwort.error;

  rollenRechte = new Map();
  (rechteAntwort.data ?? []).forEach(({ role_key, permission_key }) => {
    if (!rollenRechte.has(role_key)) rollenRechte.set(role_key, new Set());
    rollenRechte.get(role_key).add(permission_key);
  });

  kontenJeRolle = null;
  if (!kontenAntwort.error && Array.isArray(kontenAntwort.data)) {
    kontenJeRolle = new Map();
    kontenAntwort.data.forEach((zeile) => {
      kontenJeRolle.set(zeile.role, (kontenJeRolle.get(zeile.role) ?? 0) + 1);
    });
  }

  // Abgleich mit dem Rechtekatalog in der Datenbank: taucht dort ein
  // Schlüssel auf, den js/permissions.js nicht kennt (oder umgekehrt), würde
  // die Matrix stillschweigend danebenliegen. Dann lieber ein Hinweis.
  if (!katalogAntwort.error) {
    const inDb = new Set((katalogAntwort.data ?? []).map((z) => z.key));
    const inApp = new Set(permissionKeys());
    const fehlt = [...inDb].filter((k) => !inApp.has(k));
    const zuviel = [...inApp].filter((k) => !inDb.has(k));
    if (fehlt.length > 0 || zuviel.length > 0) {
      setStatus(`${t("ui.rechtekatalog_weicht_ab")} ${[...fehlt, ...zuviel].join(", ")}`, true);
    } else {
      setStatus("");
    }
  }
}

function badge(text, klasse) {
  const el = document.createElement("span");
  el.className = klasse;
  el.textContent = text;
  return el;
}

function rechteBlock(role, editierbar) {
  const wrapper = document.createElement("div");
  wrapper.className = "role-perm-grid";
  const gesetzt = rollenRechte.get(role.key) ?? new Set();

  permissionsByGroup().forEach((gruppe) => {
    const spalte = document.createElement("div");
    spalte.className = "role-perm-group";

    const titel = document.createElement("h4");
    titel.textContent = t(gruppe.labelKey);
    spalte.appendChild(titel);

    gruppe.permissions.forEach((perm) => {
      const label = document.createElement("label");
      label.className = "role-perm";

      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = perm.key;
      box.checked = gesetzt.has(perm.key);
      box.disabled = !editierbar;

      const text = document.createElement("span");
      text.className = "role-perm-text";
      const name = document.createElement("span");
      name.textContent = permissionLabel(perm.key);
      text.appendChild(name);

      if (perm.sichtbarkeitNur) {
        text.appendChild(badge(t("ui.nur_sichtbarkeit"), "role-perm-flag"));
      }
      if (RANK_BASED_PERMISSIONS.includes(perm.key)) {
        text.appendChild(badge(t("ui.mit_rangfolge"), "role-perm-flag"));
      }

      const hinweis = document.createElement("span");
      hinweis.className = "role-perm-hint";
      hinweis.textContent = permissionHint(perm.key);
      text.appendChild(hinweis);

      label.append(box, text);
      spalte.appendChild(label);
    });

    wrapper.appendChild(spalte);
  });

  return wrapper;
}

function roleCard(role, eigenerRang) {
  const oberste = role.rank >= 100;
  const editierbar = !oberste && role.rank < eigenerRang;

  const card = document.createElement("div");
  card.className = "role-card";
  if (!editierbar) card.classList.add("role-card-locked");
  card.dataset.role = role.key;

  const kopf = document.createElement("div");
  kopf.className = "role-card-head";

  const titel = document.createElement("h3");
  titel.textContent = role.label;
  kopf.appendChild(titel);

  kopf.appendChild(badge(`${t("ui.rang")} ${role.rank}`, "role-rank-badge"));
  if (role.is_system) kopf.appendChild(badge(t("ui.systemrolle"), "role-flag"));
  const anzahl = kontenJeRolle?.get(role.key);
  if (anzahl != null) kopf.appendChild(badge(`${anzahl} ${t("ui.konten")}`, "role-flag"));
  card.appendChild(kopf);

  const schluessel = document.createElement("p");
  schluessel.className = "prep-meta";
  schluessel.textContent = role.key;
  card.appendChild(schluessel);

  if (oberste) {
    const hinweis = document.createElement("p");
    hinweis.className = "hint";
    hinweis.textContent = t("ui.diese_rolle_hat_immer_alle_rechte");
    card.appendChild(hinweis);
    return card;
  }

  if (!editierbar) {
    const hinweis = document.createElement("p");
    hinweis.className = "hint";
    hinweis.textContent = t("ui.gleiche_oder_hoehere_ebene_nicht_aenderbar");
    card.appendChild(hinweis);
  }

  if (editierbar) {
    const nameFeld = document.createElement("label");
    nameFeld.className = "role-label-field";
    const nameText = document.createElement("span");
    nameText.textContent = t("ui.bezeichnung");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "role-label-input";
    nameInput.value = role.label;
    nameInput.maxLength = 60;
    nameFeld.append(nameText, nameInput);
    card.appendChild(nameFeld);
  }

  card.appendChild(rechteBlock(role, editierbar));

  if (editierbar) {
    const aktionen = document.createElement("div");
    aktionen.className = "actions";

    const speichern = document.createElement("button");
    speichern.type = "button";
    speichern.className = "btn-primary role-save";
    speichern.textContent = t("ui.speichern");
    aktionen.appendChild(speichern);

    if (!role.is_system) {
      const loeschen = document.createElement("button");
      loeschen.type = "button";
      loeschen.className = "btn-secondary role-delete";
      loeschen.textContent = t("ui.loeschen");
      aktionen.appendChild(loeschen);
    }

    const meldung = document.createElement("span");
    meldung.className = "role-card-status";
    aktionen.appendChild(meldung);

    card.appendChild(aktionen);
  }

  return card;
}

function fussnote() {
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = t("ui.rechte_wirken_nach_der_naechsten_anmeldung");
  return p;
}

function render() {
  if (!matrixEl) return;
  const eigenerRang = myRank();
  matrixEl.textContent = "";

  const rollen = getRolesSync();
  if (rollen.length === 0) {
    const leer = document.createElement("p");
    leer.className = "empty-note";
    leer.textContent = t("ui.keine_rollen_gefunden");
    matrixEl.appendChild(leer);
    return;
  }

  [...rollen]
    .sort((a, b) => b.rank - a.rank)
    .forEach((role) => matrixEl.appendChild(roleCard(role, eigenerRang)));

  matrixEl.appendChild(fussnote());

  // Rang-Obergrenze fürs Anlegen: immer unter dem eigenen Rang.
  if (newRankEl) {
    newRankEl.max = String(Math.max(eigenerRang - 1, 1));
    if (!newRankEl.value) newRankEl.value = String(Math.max(Math.min(eigenerRang - 20, eigenerRang - 1), 1));
  }
}

async function neuLaden() {
  try {
    await ladeDaten();
  } catch (error) {
    setStatus(`${t("ui.rollen_konnten_nicht_geladen_werden")} ${error.message}`, true);
  }
  render();
}

async function speichern(card) {
  const roleKey = card.dataset.role;
  const role = getRolesSync().find((r) => r.key === roleKey);
  const meldung = card.querySelector(".role-card-status");
  if (!role) return;

  const gewuenscht = new Set(
    [...card.querySelectorAll(".role-perm input[type='checkbox']")]
      .filter((box) => box.checked)
      .map((box) => box.value)
  );
  const vorher = rollenRechte.get(roleKey) ?? new Set();
  const hinzu = [...gewuenscht].filter((k) => !vorher.has(k));
  const weg = [...vorher].filter((k) => !gewuenscht.has(k));
  const neuesLabel = card.querySelector(".role-label-input")?.value.trim() ?? role.label;

  if (meldung) meldung.textContent = t("ui.wird_gespeichert");
  const supabase = getSupabaseClient();

  try {
    if (neuesLabel && neuesLabel !== role.label) {
      const { error } = await supabase.from("roles").update({ label: neuesLabel }).eq("key", roleKey);
      if (error) throw error;
    }
    if (weg.length > 0) {
      const { error } = await supabase
        .from("role_permissions")
        .delete()
        .eq("role_key", roleKey)
        .in("permission_key", weg);
      if (error) throw error;
    }
    if (hinzu.length > 0) {
      const { error } = await supabase
        .from("role_permissions")
        .insert(hinzu.map((permission_key) => ({ role_key: roleKey, permission_key })));
      if (error) throw error;
    }
    await neuLaden();
    setStatus(`${role.label}: ${t("ui.rechte_gespeichert")}`);
  } catch (error) {
    if (meldung) meldung.textContent = "";
    setStatus(`${t("ui.speichern_fehlgeschlagen")} ${error.message}`, true);
  }
}

async function loeschen(card) {
  const roleKey = card.dataset.role;
  const role = getRolesSync().find((r) => r.key === roleKey);
  if (!role) return;
  const anzahl = kontenJeRolle?.get(roleKey) ?? 0;
  if (anzahl > 0) {
    setStatus(`${t("ui.rolle_hat_noch_konten")} ${anzahl}`, true);
    return;
  }
  if (!confirm(`${t("ui.rolle_wirklich_loeschen")} ${role.label}?`)) return;

  const supabase = getSupabaseClient();
  try {
    // Zuerst die Rechte, dann die Rolle: der Fremdschlüssel in
    // role_permissions würde das Löschen sonst abweisen.
    const { error: rechteFehler } = await supabase.from("role_permissions").delete().eq("role_key", roleKey);
    if (rechteFehler) throw rechteFehler;
    const { error } = await supabase.from("roles").delete().eq("key", roleKey);
    if (error) throw error;
    await neuLaden();
    setStatus(`${role.label}: ${t("ui.rolle_geloescht")}`);
  } catch (error) {
    // 23503 = Fremdschlüssel: an der Rolle hängen noch Konten.
    const text =
      error.code === "23503" ? t("ui.rolle_hat_noch_konten_kurz") : `${t("ui.loeschen_fehlgeschlagen")} ${error.message}`;
    setStatus(text, true);
    await neuLaden();
  }
}

async function anlegen(e) {
  e.preventDefault();
  if (createError) createError.hidden = true;
  const key = (newKeyEl?.value ?? "").trim().toLowerCase();
  const label = (newLabelEl?.value ?? "").trim();
  const rank = Number(newRankEl?.value);

  const fehler = (text) => {
    if (!createError) return;
    createError.hidden = false;
    createError.textContent = text;
  };

  if (!KEY_PATTERN.test(key)) return fehler(t("ui.rollenschluessel_ungueltig"));
  if (!label) return fehler(t("ui.bezeichnung_fehlt"));
  if (!Number.isInteger(rank) || rank < 1 || rank >= myRank()) {
    return fehler(`${t("ui.rang_muss_kleiner_sein_als")} ${myRank()}`);
  }
  if (getRolesSync().some((r) => r.key === key)) return fehler(t("ui.rollenschluessel_vergeben"));
  if (getRolesSync().some((r) => r.rank === rank)) return fehler(t("ui.rang_bereits_belegt"));

  const sort = Math.max(0, ...getRolesSync().map((r) => r.sort ?? 0)) + 10;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("roles").insert({ key, label, rank, is_system: false, sort });
  if (error) return fehler(`${t("ui.rolle_konnte_nicht_angelegt_werden")} ${error.message}`);

  createForm?.reset();
  await neuLaden();
  setStatus(`${label}: ${t("ui.rolle_angelegt")}`);
}

export async function initAdminRoles() {
  if (!matrixEl || geladen) return;
  geladen = true;

  matrixEl.addEventListener("click", (e) => {
    const card = e.target.closest(".role-card");
    if (!card) return;
    if (e.target.closest(".role-save")) speichern(card);
    if (e.target.closest(".role-delete")) loeschen(card);
  });

  createForm?.addEventListener("submit", anlegen);

  // Sprachwechsel: die Rechte-Labels kommen aus t(), also neu zeichnen.
  // Die Rollen-Labels selbst bleiben, wie sie in der Datenbank stehen.
  onLanguageChanged(render);

  await neuLaden();
}

// Nur für die Konsole beim Nachschauen: welches Recht wirkt wo.
export function permissionOverview() {
  return PERMISSIONS.map((p) => `${p.key} -> ${p.policy}`);
}
