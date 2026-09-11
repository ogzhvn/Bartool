import { getSupabaseClient } from "./supabaseClient.js";
import { getCurrentUser, myRank } from "./auth.js";
import { escapeHtml, functionErrorMessage } from "./utils.js";
import { onLanguageChanged, t } from "./i18n.js";
import { loadRoles, getRolesSync, roleRank } from "./roles.js";

// Kontenverwaltung im Adminbereich (Sub-Tab "admin-users").
// Aus js/adminPanel.js herausgelöst (Paket 34) – der Inhalt ist unverändert,
// nur die Initialisierung läuft jetzt erst beim ersten Öffnen des Sub-Tabs.
const createForm = document.getElementById("admin-create-form");
const createError = document.getElementById("admin-create-error");
const employeeListEl = document.getElementById("admin-employee-list");
const newRoleSelect = document.getElementById("admin-new-role");

// Rollen kommen seit Paket 35 aus der DB-Tabelle "roles" (mit Rangfolge),
// nicht mehr aus einem festen Enum. Die Labels sind bewusst nicht übersetzt.
//
// Vergeben werden dürfen nur Rollen unterhalb des eigenen Rangs (Paket 36) –
// so steht es in der Policy auf "profiles" und in der Edge Function
// "admin-users". Eine Rolle, die dieses Konto nicht setzen darf, taucht
// deshalb nicht in der Auswahl auf. Ausnahme: die bereits gesetzte Rolle
// eines Kontos bleibt sichtbar, sonst stünde in der Liste die falsche.
function roleOptions(selectedKey) {
  const eigenerRang = myRank();
  return getRolesSync()
    .filter((r) => r.rank < eigenerRang || r.key === selectedKey)
    .map(
      (r) =>
        `<option value="${escapeHtml(r.key)}"${r.key === selectedKey ? " selected" : ""}>${escapeHtml(r.label)}</option>`
    )
    .join("");
}

// Dreizustands-Umschalter fuer die Quiz-Auswertung (Paket 40).
//   ""      -> NULL: richtet sich nach der Rolle (Rang >= 60 ist ausgeblendet)
//   "true"  -> immer sichtbar
//   "false" -> immer ausgeblendet
// Wer befoerdert wird, verschwindet damit von selbst aus Heatmap und
// Rangliste, ohne dass jemand daran denken muss. Schreiben darf das nur, wer
// das Recht users.manage hat – das setzt die Policy auf "profiles" durch.
function quizVisibleOptions(wert) {
  const gewaehlt = wert === true ? "true" : wert === false ? "false" : "";
  return [
    ["", t("ui.rolle_standard")],
    ["true", t("ui.sichtbar")],
    ["false", t("ui.ausgeblendet")],
  ]
    .map(
      ([key, label]) =>
        `<option value="${key}"${key === gewaehlt ? " selected" : ""}>${escapeHtml(label)}</option>`
    )
    .join("");
}

function fillCreateRoleSelect() {
  if (!newRoleSelect) return;
  const previous = newRoleSelect.value;
  newRoleSelect.innerHTML = roleOptions(previous || "barkeeper");
}

async function loadEmployees() {
  await loadRoles();
  fillCreateRoleSelect();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("profiles").select("*").order("email");
  if (error) {
    employeeListEl.innerHTML = `<p class="empty-note">${t("ui.konten_konnten_nicht_geladen_werden")} ${escapeHtml(error.message)}</p>`;
    return;
  }
  renderEmployees(data ?? []);
}

function renderEmployees(profiles) {
  if (profiles.length === 0) {
    employeeListEl.innerHTML = `<p class="empty-note">${t("ui.keine_konten_gefunden")}</p>`;
    return;
  }

  employeeListEl.innerHTML = `
    <table>
      <thead><tr><th>${t("ui.benutzername")}</th><th>${t("ui.e_mail")}</th><th>${t("ui.name")}</th><th>${t("ui.rolle")}</th><th>${t("ui.quiz_auswertung")}</th><th></th></tr></thead>
      <tbody>
        ${profiles
          .map((p) => {
            // Gesperrt ist das eigene Konto und jedes Konto auf der eigenen
            // oder einer höheren Ebene – Policy und Edge Function lehnen es
            // ohnehin ab, hier bleiben die Felder nur konsequent grau.
            const gesperrt = p.id === getCurrentUser()?.id || roleRank(p.role) >= myRank();
            const disabled = gesperrt ? "disabled" : "";
            return `
          <tr data-id="${p.id}">
            <td><input type="text" class="username-input" value="${escapeHtml(p.username ?? "")}" pattern="[a-z0-9._-]{3,32}" ${disabled} /></td>
            <td>${escapeHtml(p.email)}</td>
            <td>${escapeHtml(p.display_name ?? "")}</td>
            <td>
              <select class="role-select" ${disabled}>
                ${roleOptions(p.role)}
              </select>
            </td>
            <td>
              <select class="quiz-visible-select" ${disabled}>
                ${quizVisibleOptions(p.quiz_visible)}
              </select>
            </td>
            <td>
              <button type="button" class="btn-secondary reset-password-btn" ${disabled}>${t("ui.passwort_zuruecksetzen")}</button>
              <button type="button" class="btn-secondary delete-employee-btn" ${disabled}>${t("ui.loeschen")}</button>
            </td>
          </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;

  employeeListEl.querySelectorAll(".username-input").forEach((input) => {
    input.addEventListener("change", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      const username = e.target.value.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        alert(t("ui.benutzername_darf_nur_kleinbuchstaben_1c7d"));
        loadEmployees();
        return;
      }
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("profiles").update({ username }).eq("id", id);
      if (error) {
        alert(
          t("ui.benutzername_konnte_nicht_geaendert_werden") +
            (error.message.includes("profiles_username_key") ? t("ui.dieser_benutzername_ist_bereits_vergeben") : error.message)
        );
        loadEmployees();
      }
    });
  });

  employeeListEl.querySelectorAll(".role-select").forEach((select) => {
    select.addEventListener("change", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("profiles").update({ role: e.target.value }).eq("id", id);
      if (error) {
        alert(t("ui.rolle_konnte_nicht_geaendert_werden") + error.message);
        loadEmployees();
      }
    });
  });

  employeeListEl.querySelectorAll(".quiz-visible-select").forEach((select) => {
    select.addEventListener("change", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      const wert = e.target.value === "" ? null : e.target.value === "true";
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("profiles").update({ quiz_visible: wert }).eq("id", id);
      if (error) {
        alert(t("ui.sichtbarkeit_konnte_nicht_geaendert_werden") + error.message);
        loadEmployees();
      }
    });
  });

  employeeListEl.querySelectorAll(".reset-password-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      const password = prompt(t("ui.neues_temporaeres_passwort_mind_8_zeichen"));
      if (password === null) return;
      if (password.length < 8) {
        alert(t("ui.das_passwort_muss_mindestens_8_zeichen_haben"));
        return;
      }
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "reset-password", userId: id, password },
      });
      if (error || data?.error) {
        alert(t("ui.passwort_konnte_nicht_zurueckgesetzt_werden") + (await functionErrorMessage(error, data)));
        return;
      }
      alert(t("ui.passwort_wurde_zurueckgesetzt_die_person_1e04"));
    });
  });

  employeeListEl.querySelectorAll(".delete-employee-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      if (!confirm(t("ui.dieses_konto_wirklich_loeschen_der_zugriff_1784"))) return;
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "delete", userId: id },
      });
      if (error || data?.error) {
        alert(t("ui.konto_konnte_nicht_geloescht_werden") + (await functionErrorMessage(error, data)));
        return;
      }
      loadEmployees();
    });
  });
}

async function handleCreate(e) {
  e.preventDefault();
  createError.hidden = true;

  const email = document.getElementById("admin-new-email").value.trim();
  const username = document.getElementById("admin-new-username").value.trim().toLowerCase();
  const password = document.getElementById("admin-new-password").value;
  const displayName = document.getElementById("admin-new-name").value.trim();
  const role = newRoleSelect.value;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "create", email, username, password, displayName, role },
  });

  if (error || data?.error) {
    createError.hidden = false;
    createError.textContent = t("ui.konto_konnte_nicht_angelegt_werden") + (await functionErrorMessage(error, data));
    return;
  }

  createForm.reset();
  loadEmployees();
}

export function initAdminUsers() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(loadEmployees);

  createForm.addEventListener("submit", handleCreate);
  loadEmployees();
}
