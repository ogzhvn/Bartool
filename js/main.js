import { initTabs, closeMobileNav } from "./tabs.js";
import { initHome } from "./home.js";
import { initBatching } from "./batching.js";
import { initRecipes } from "./recipes.js";
import { initProducts } from "./products.js";
import { initSuperjuice } from "./superjuice.js";
import { initSyrup } from "./syrup.js";
import { initDilution } from "./dilution.js";
import { initCalculation } from "./calculation.js";
import { initAdminPanel } from "./adminPanel.js";
import { initAuditLog } from "./auditLog.js";
import { initDataQuality } from "./dataQuality.js";
import { initChangeRequestsAdmin, initMyChangeRequests } from "./changeRequests.js";
import { initRecipeSync, initProductSync } from "./storage.js";
import { initAuth, onAuthChange, signIn, signOut, isAdmin, changePassword, completeFirstLogin } from "./auth.js";

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
let lastActivityAt = Date.now();
let sessionTimeoutIntervalId = null;

function applyRoleVisibility() {
  const admin = isAdmin();
  document.querySelectorAll("[data-admin-only]").forEach((el) => {
    el.hidden = !admin;
  });
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

async function bootstrapAppOnce() {
  if (appInitialized) return;
  appInitialized = true;
  await Promise.all([initRecipeSync(), initProductSync()]);
  initTabs();
  initHome();
  initRecipes();
  initBatching();
  initProducts();
  initSuperjuice();
  initSyrup();
  initDilution();
  initCalculation();
  initAdminPanel();
  initAuditLog();
  initDataQuality();
  initChangeRequestsAdmin();
  initMyChangeRequests();
  startSessionTimeoutWatch();
}

async function handleAuthState({ session, profile }) {
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
  userInfoEl.textContent = `${profile?.display_name || profile?.username || session.user.email} · ${
    profile?.role === "admin" ? "Admin" : "Mitarbeiter"
  }`;
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
    loginError.textContent = "Login fehlgeschlagen: " + error.message;
  }
});

logoutBtn.addEventListener("click", () => signOut());

forcedPasswordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  forcedPasswordError.hidden = true;
  const username = document.getElementById("forced-password-username").value.trim().toLowerCase();
  const newPassword = document.getElementById("forced-password-new").value;
  const confirmPassword = document.getElementById("forced-password-confirm").value;
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    forcedPasswordError.hidden = false;
    forcedPasswordError.textContent =
      "Benutzername darf nur Kleinbuchstaben, Zahlen, Punkt, Unterstrich und Bindestrich enthalten (3–32 Zeichen).";
    return;
  }
  if (newPassword !== confirmPassword) {
    forcedPasswordError.hidden = false;
    forcedPasswordError.textContent = "Die beiden Passwörter stimmen nicht überein.";
    return;
  }
  const { error } = await completeFirstLogin(username, newPassword);
  if (error) {
    forcedPasswordError.hidden = false;
    forcedPasswordError.textContent =
      "Konto konnte nicht eingerichtet werden: " +
      (error.message.includes("profiles_username_key") ? "Dieser Benutzername ist bereits vergeben." : error.message);
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
    passwordModalError.textContent = "Die beiden Passwörter stimmen nicht überein.";
    return;
  }
  const { error } = await changePassword(newPassword);
  if (error) {
    passwordModalError.hidden = false;
    passwordModalError.textContent = "Passwort konnte nicht geändert werden: " + error.message;
    return;
  }
  passwordModalOverlay.hidden = true;
});

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
