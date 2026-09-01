import { initTabs } from "./tabs.js";
import { initHome } from "./home.js";
import { initBatching } from "./batching.js";
import { initRecipes } from "./recipes.js";
import { initProducts } from "./products.js";
import { initSuperjuice } from "./superjuice.js";
import { initDilution } from "./dilution.js";
import { initAdminPanel } from "./adminPanel.js";
import { initRecipeSync, initProductSync } from "./storage.js";
import { initAuth, onAuthChange, signIn, signOut, isAdmin } from "./auth.js";

const authScreen = document.getElementById("auth-screen");
const appShell = document.getElementById("app-shell");
const headerUser = document.getElementById("header-user");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const userInfoEl = document.getElementById("current-user-info");
const logoutBtn = document.getElementById("logout-btn");

let appInitialized = false;

function applyRoleVisibility() {
  const admin = isAdmin();
  document.querySelectorAll("[data-admin-only]").forEach((el) => {
    el.hidden = !admin;
  });
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
  initDilution();
  initAdminPanel();
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
    appShell.hidden = true;
    headerUser.hidden = true;
    return;
  }

  authScreen.hidden = true;
  appShell.hidden = false;
  headerUser.hidden = false;
  userInfoEl.textContent = `${profile?.display_name || session.user.email} · ${
    profile?.role === "admin" ? "Admin" : "Mitarbeiter"
  }`;
  applyRoleVisibility();
  await bootstrapAppOnce();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const { error } = await signIn(email, password);
  if (error) {
    loginError.hidden = false;
    loginError.textContent = "Login fehlgeschlagen: " + error.message;
  }
});

logoutBtn.addEventListener("click", () => signOut());

onAuthChange(handleAuthState);
initAuth();
