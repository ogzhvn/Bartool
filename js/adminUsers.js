import { getSupabaseClient } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";
import { escapeHtml, functionErrorMessage } from "./utils.js";
import { onLanguageChanged, t } from "./i18n.js";

// Kontenverwaltung im Adminbereich (Sub-Tab "admin-users").
// Aus js/adminPanel.js herausgelöst (Paket 34) – der Inhalt ist unverändert,
// nur die Initialisierung läuft jetzt erst beim ersten Öffnen des Sub-Tabs.
const createForm = document.getElementById("admin-create-form");
const createError = document.getElementById("admin-create-error");
const employeeListEl = document.getElementById("admin-employee-list");

async function loadEmployees() {
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
      <thead><tr><th>${t("ui.benutzername")}</th><th>${t("ui.e_mail")}</th><th>${t("ui.name")}</th><th>${t("ui.rolle")}</th><th></th></tr></thead>
      <tbody>
        ${profiles
          .map(
            (p) => `
          <tr data-id="${p.id}">
            <td><input type="text" class="username-input" value="${escapeHtml(p.username ?? "")}" pattern="[a-z0-9._-]{3,32}" /></td>
            <td>${escapeHtml(p.email)}</td>
            <td>${escapeHtml(p.display_name ?? "")}</td>
            <td>
              <select class="role-select" ${p.id === getCurrentUser()?.id ? "disabled" : ""}>
                <option value="mitarbeiter" ${p.role === "mitarbeiter" ? "selected" : ""}>${t("ui.mitarbeiter")}</option>
                <option value="admin" ${p.role === "admin" ? "selected" : ""}>${t("ui.admin")}</option>
              </select>
            </td>
            <td>
              <button type="button" class="btn-secondary reset-password-btn" ${p.id === getCurrentUser()?.id ? "disabled" : ""}>${t("ui.passwort_zuruecksetzen")}</button>
              <button type="button" class="btn-secondary delete-employee-btn" ${p.id === getCurrentUser()?.id ? "disabled" : ""}>${t("ui.loeschen")}</button>
            </td>
          </tr>`
          )
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
  const role = document.getElementById("admin-new-role").value;

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
