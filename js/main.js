import { initTabs, closeMobileNav, ensureVisibleTab } from "./tabs.js";
import { initHome } from "./home.js";
import { initBatching } from "./batching.js";
import { initRecipes } from "./recipes.js";
import { initProducts } from "./products.js";
import { initSuperjuice } from "./superjuice.js";
import { initSyrup } from "./syrup.js";
import { initDilution } from "./dilution.js";
import { initCalculation } from "./calculation.js";
import { initMenuCosting } from "./menuCosting.js";
import { initPreparations } from "./preparations.js";
import { initInventory } from "./inventory.js";
import { initBuildable } from "./buildable.js";
import { initQuiz } from "./quiz.js";
import { initKnowledge } from "./knowledge.js";
import { initEvents } from "./events.js";
import { initShiftLog } from "./shiftLog.js";
import { initLosses } from "./losses.js";
import { initChecklists } from "./checklists.js";
import { initProductImport } from "./productImport.js";
import { initAdminSections, ADMIN_AREA_PERMISSIONS } from "./adminSections.js";
import { initQuickSearch } from "./quickSearch.js";
import { initHeaderMenu } from "./headerMenu.js";
import { initMyChangeRequests } from "./changeRequests.js";
import {
  initRecipeSync,
  initProductSync,
  initPreparationSync,
  initInventorySync,
  initEventSync,
  initShiftLogSync,
  initLossSync,
  initChecklistTemplateSync,
  initChecklistRunSync,
  initQuizQuestionSync,
  initKnowledgeSync,
} from "./storage.js";
import { initPriceHistorySync } from "./priceHistory.js";
import {
  initAuth,
  onAuthChange,
  signIn,
  signOut,
  isAdmin,
  can,
  canAny,
  canSee,
  changePassword,
  completeFirstLogin,
} from "./auth.js";
import { loadRoles, roleLabel } from "./roles.js";
import { t, formatDecimal, initI18n, onLanguageChanged } from "./i18n.js";
import { initLanguageSwitcher, applyProfileLanguage } from "./language.js";

// Auto-Logout am Tresen-Tablet: Gerät ist öffentlich zugänglich, nach
// längerer Inaktivität lieber neu anmelden lassen statt dauerhaft offen zu
// lassen. 6h deckt eine volle Schicht ohne Zwischen-Logout ab.
const SESSION_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const authScreen = document.getElementById("auth-screen");
const forcedPasswordScreen = document.getElementById("forced-password-screen");
const appShell = document.getElementById("app-shell");
const headerUser = document.getElementById("header-user");
const navToggle = document.getElementById("nav-toggle");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const userInfoEl = document.getElementById("current-user-info");
const logoutBtn = document.getElementById("logout-btn");

const forcedPasswordForm = document.getElementById("forced-password-form");
const forcedPasswordError = document.getElementById("forced-password-error");

const changePasswordBtn = document.getElementById("change-password-nav-btn");
const passwordModalOverlay = document.getElementById("password-modal-overlay");
const passwordModalForm = document.getElementById("password-modal-form");
const passwordModalError = document.getElementById("password-modal-error");
const passwordModalCancelBtn = document.getElementById("password-modal-cancel");

let appInitialized = false;
let currentAuthState = { session: null, profile: null };
let lastActivityAt = Date.now();
let sessionTimeoutIntervalId = null;

// Sichtbarkeit nach Rechten (Paket 36). Drei Marker am Element:
//   data-admin-only        – nur oberste Ebene (Rang >= 100)
//   data-perm="x.y"        – nur mit diesem Recht
//   data-perm-any="a,b"    – mit mindestens einem der Rechte
// Das ist bewusst reine Kosmetik: verboten wird in den Policies, hier wird
// nur weggeräumt, was das Konto ohnehin nicht darf.
function applyRoleVisibility() {
  const admin = isAdmin();
  document.querySelectorAll("[data-admin-only]").forEach((el) => {
    el.hidden = !admin;
  });
  document.querySelectorAll("[data-perm]").forEach((el) => {
    el.hidden = !can(el.dataset.perm);
  });
  document.querySelectorAll("[data-perm-any]").forEach((el) => {
    const rechte = el.dataset.permAny
      .split(",")
      .map((eintrag) => eintrag.trim())
      .filter(Boolean);
    el.hidden = !canAny(rechte.length > 0 ? rechte : ADMIN_AREA_PERMISSIONS);
  });
  applyModuleVisibility();
}

// Sichtbarkeit nach Abteilung (Paket 51): data-module="<key>" an Tab-Button,
// Panel, Startkachel und Kategoriebaum. Trägt ein Element zusätzlich einen
// Rechte-Marker, darf die Abteilung es nur weiter einschränken, nie wieder
// einblenden, was die Rechte schon ausgeblendet haben.
// Danach fallen Sidebar-Gruppen weg, in denen kein Modul mehr übrig ist; die
// Verwaltung hängt nur an Rechten und bleibt davon unberührt.
function applyModuleVisibility() {
  document.querySelectorAll("[data-module]").forEach((el) => {
    const sichtbar = canSee(el.dataset.module);
    if (el.matches("[data-admin-only], [data-perm], [data-perm-any]")) {
      if (!sichtbar) el.hidden = true;
    } else {
      el.hidden = !sichtbar;
    }
  });
  document.querySelectorAll(".sidebar-group").forEach((group) => {
    const module = group.querySelectorAll(".tab-btn[data-module]");
    if (module.length === 0) return;
    group.hidden = [...module].every((btn) => btn.hidden);
  });
  // Ist der offene Tab gerade weggefallen (Profil neu geladen), zurück auf Start.
  if (appInitialized) ensureVisibleTab();
}

function resetActivityTimer() {
  lastActivityAt = Date.now();
}

function startSessionTimeoutWatch() {
  if (sessionTimeoutIntervalId) return;
  ["click", "keydown", "touchstart"].forEach((evt) =>
    document.addEventListener(evt, resetActivityTimer, { passive: true })
  );
  resetActivityTimer();
  sessionTimeoutIntervalId = setInterval(() => {
    if (Date.now() - lastActivityAt > SESSION_TIMEOUT_MS) {
      signOut();
    }
  }, 60 * 1000);
}

// Zeigt, wie viele Sync-Aufträge schon fertig sind. Blockiert nichts: die
// Anzeige sitzt fest unten rechts und verschwindet, sobald alle Syncs durch sind.
function showBootProgress(tasks) {
  const box = document.getElementById("boot-progress");
  const bar = box.querySelector(".boot-progress-bar");
  const label = box.querySelector(".boot-progress-label");
  let done = 0;
  const render = () => {
    const pct = Math.round((done / tasks.length) * 100);
    bar.style.width = `${pct}%`;
    box.setAttribute("aria-valuenow", String(pct));
    label.textContent = t("ui.daten_laden_prozent", { pct: formatDecimal(pct, 0) });
  };
  box.hidden = false;
  render();
  const stopLanguageWatch = onLanguageChanged(render);
  return Promise.all(tasks.map((task) => task.finally(() => { done += 1; render(); })))
    .finally(() => {
      stopLanguageWatch();
      box.hidden = true;
    });
}

async function bootstrapAppOnce() {
  if (appInitialized) return;
  appInitialized = true;
  // Syncs laufen parallel, ohne die UI zu blockieren: jedes Modul rendert
  // sofort mit dem Offline-Puffer und aktualisiert sich über on*Changed().
  const syncsReady = showBootProgress([
    initRecipeSync(),
    initProductSync(),
    initPreparationSync(),
    initInventorySync(),
    initEventSync(),
    initShiftLogSync(),
    initLossSync(),
    initChecklistTemplateSync(),
    initChecklistRunSync(),
    initQuizQuestionSync(),
    initKnowledgeSync(),
    initPriceHistorySync(),
  ]);
  // Muss vor initTabs() stehen: initTabs() schaltet direkt auf den Start-Tab,
  // und ist das per Deep-Link ein Admin-Unterpunkt, soll er dabei schon laden.
  initAdminSections();
  initTabs();
  initHome();
  initRecipes();
  initBatching();
  initProducts();
  initSuperjuice();
  initSyrup();
  initDilution();
  initCalculation();
  initMenuCosting();
  initPreparations();
  initInventory();
  initBuildable();
  initQuiz();
  initKnowledge();
  initEvents();
  initShiftLog();
  initLosses();
  initChecklists();
  initProductImport();
  initQuickSearch();
  initHeaderMenu();
  initMyChangeRequests();
  startSessionTimeoutWatch();
  await syncsReady;
}

// Kopfzeile "Name · Rolle" – eigene Funktion, damit sie beim Sprachwechsel
// noch einmal laufen kann.
function renderHeaderUser() {
  const { session, profile } = currentAuthState;
  if (!session) return;
  // Rollenname kommt aus der DB (Tabelle "roles"), nicht aus der Übersetzung.
  userInfoEl.textContent = `${profile?.display_name || profile?.username || session.user.email} · ${roleLabel(
    profile?.role
  )}`;
}

async function handleAuthState({ session, profile }) {
  currentAuthState = { session, profile };
  if (!session) {
    // Nach einem Logout wird neu geladen statt den App-Zustand (Caches,
    // offene Formulare) manuell zurückzusetzen.
    if (appInitialized) {
      location.reload();
      return;
    }
    authScreen.hidden = false;
    forcedPasswordScreen.hidden = true;
    appShell.hidden = true;
    headerUser.hidden = true;
    navToggle.hidden = true;
    return;
  }

  if (profile?.must_change_password) {
    authScreen.hidden = true;
    appShell.hidden = true;
    headerUser.hidden = true;
    navToggle.hidden = true;
    document.getElementById("forced-password-username").value = profile?.username ?? "";
    forcedPasswordScreen.hidden = false;
    return;
  }

  authScreen.hidden = true;
  forcedPasswordScreen.hidden = true;
  appShell.hidden = false;
  headerUser.hidden = false;
  navToggle.hidden = false;
  // Rollenliste einmal holen, danach steht das Label für die Kopfzeile bereit.
  await loadRoles();
  renderHeaderUser();
  applyProfileLanguage(profile);
  applyRoleVisibility();
  await bootstrapAppOnce();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const { error } = await signIn(username, password);
  if (error) {
    loginError.hidden = false;
    loginError.textContent = t("ui.login_fehlgeschlagen") + error.message;
  }
});

logoutBtn.addEventListener("click", () => {
  closeMobileNav();
  signOut();
});

forcedPasswordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  forcedPasswordError.hidden = true;
  const username = document.getElementById("forced-password-username").value.trim().toLowerCase();
  const newPassword = document.getElementById("forced-password-new").value;
  const confirmPassword = document.getElementById("forced-password-confirm").value;
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    forcedPasswordError.hidden = false;
    forcedPasswordError.textContent =
      t("ui.benutzername_darf_nur_kleinbuchstaben_1c7d");
    return;
  }
  if (newPassword !== confirmPassword) {
    forcedPasswordError.hidden = false;
    forcedPasswordError.textContent = t("ui.die_beiden_passwoerter_stimmen_nicht_d8fe");
    return;
  }
  const { error } = await completeFirstLogin(username, newPassword);
  if (error) {
    forcedPasswordError.hidden = false;
    forcedPasswordError.textContent =
      t("ui.konto_konnte_nicht_eingerichtet_werden") +
      (error.message.includes("profiles_username_key") ? t("ui.dieser_benutzername_ist_bereits_vergeben") : error.message);
    return;
  }
  forcedPasswordForm.reset();
});

changePasswordBtn.addEventListener("click", () => {
  passwordModalError.hidden = true;
  passwordModalForm.reset();
  passwordModalOverlay.hidden = false;
  closeMobileNav();
});

passwordModalCancelBtn.addEventListener("click", () => {
  passwordModalOverlay.hidden = true;
});

passwordModalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  passwordModalError.hidden = true;
  const newPassword = document.getElementById("password-modal-new").value;
  const confirmPassword = document.getElementById("password-modal-confirm").value;
  if (newPassword !== confirmPassword) {
    passwordModalError.hidden = false;
    passwordModalError.textContent = t("ui.die_beiden_passwoerter_stimmen_nicht_d8fe");
    return;
  }
  const { error } = await changePassword(newPassword);
  if (error) {
    passwordModalError.hidden = false;
    passwordModalError.textContent = t("ui.passwort_konnte_nicht_geaendert_werden") + error.message;
    return;
  }
  passwordModalOverlay.hidden = true;
});

// Offline-Hinweis: zeigt an, dass gerade nur gelesen und gerechnet werden
// kann. Die eigentliche Sperre beim Speichern sitzt in storage.js – dieses
// Banner ist nur die sichtbare Ansage dazu.
const offlineBanner = document.getElementById("offline-banner");

function updateOfflineBanner() {
  offlineBanner.hidden = navigator.onLine;
}

window.addEventListener("online", updateOfflineBanner);
window.addEventListener("offline", updateOfflineBanner);
updateOfflineBanner();

// Sprache steht vor allem anderen: so erscheint auch die Login-Maske in der
// zuletzt gewählten Sprache, ohne dass etwas nachträglich umspringt.
initI18n();
initLanguageSwitcher();
onLanguageChanged(renderHeaderUser);

onAuthChange(handleAuthState);
initAuth();

// Service Worker: macht Bartool installierbar und die Oberfläche offline
// startklar. Bewusst defensiv – schlägt die Registrierung fehl (file://,
// altes Gerät, blockierter Storage), läuft die App unverändert weiter.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});
  });
}
