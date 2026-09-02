// On the collapsed mobile nav, picking an entry should close the dropdown
// instead of leaving it open over the newly shown panel. Auch von den
// Unterpunkten des Produkt-Kategoriebaums aufgerufen.
export function closeMobileNav() {
  const sidebar = document.getElementById("sidebar");
  const navToggle = document.getElementById("nav-toggle");
  const navBackdrop = document.getElementById("nav-backdrop");
  sidebar?.classList.remove("open");
  navToggle?.setAttribute("aria-expanded", "false");
  if (navBackdrop) navBackdrop.hidden = true;
}

const LAST_TAB_KEY = "bartool-last-tab";

function tabExists(tabId) {
  return !!tabId && !!document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
}

function currentTabId() {
  return document.querySelector(".tab-btn.active")?.dataset.tab ?? null;
}

// Wird gesetzt, bevor man aus einer Liste (z.B. Datenqualität im Admin-Tab)
// direkt ins Bearbeiten-Formular eines anderen Tabs springt, damit man nach
// dem Bearbeiten (Zurück/Speichern/Löschen) wieder auf der Ausgangsseite mit
// der ursprünglichen Scroll-Position landet, statt in der Listenansicht des
// Zieltabs zu bleiben.
let pendingEditReturn = null;

export function setPendingEditReturn() {
  pendingEditReturn = { tabId: currentTabId(), scrollY: window.scrollY };
}

export function takePendingEditReturn() {
  const target = pendingEditReturn;
  pendingEditReturn = null;
  return target;
}

export function initTabs() {
  const sidebar = document.getElementById("sidebar");
  const navToggle = document.getElementById("nav-toggle");
  const navBackdrop = document.getElementById("nav-backdrop");

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    if (!btn.dataset.tab) return;
    btn.addEventListener("click", () => {
      const subnav = btn.nextElementSibling;
      const hasSubnav = subnav?.classList.contains("sidebar-subnav");
      // Erster Klick auf einen Punkt mit Unterkategorien klappt die nur auf,
      // statt sofort in die Seite zu wechseln. Erst ein zweiter Klick (oder
      // eine Unterkategorie) navigiert wirklich.
      if (hasSubnav && !subnav.classList.contains("expanded") && !btn.classList.contains("active")) {
        subnav.classList.add("expanded");
        return;
      }
      switchTab(btn.dataset.tab);
      closeMobileNav();
    });
  });

  navToggle?.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
    if (navBackdrop) navBackdrop.hidden = !isOpen;
  });

  navBackdrop?.addEventListener("click", closeMobileNav);

  document.getElementById("app-title")?.addEventListener("click", () => {
    switchTab("home");
    closeMobileNav();
  });

  window.addEventListener("hashchange", () => {
    const tabId = location.hash.slice(1);
    if (tabExists(tabId)) switchTab(tabId, { updateHash: false });
  });

  const hashTab = location.hash.slice(1);
  const lastTab = localStorage.getItem(LAST_TAB_KEY);
  const defaultTab = document.querySelector(".tab-btn.active")?.dataset.tab;
  const initialTab = [hashTab, lastTab, defaultTab].find(tabExists);
  if (initialTab) {
    switchTab(initialTab, { updateHash: true, replace: true });
  }
}

export function switchTab(tabId, { updateHash = true, replace = false, keepEditReturn = false } = {}) {
  if (!keepEditReturn) pendingEditReturn = null;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
  document.querySelectorAll(".sidebar-subnav.expanded").forEach((subnav) => {
    if (subnav.previousElementSibling?.dataset.tab !== tabId) {
      subnav.classList.remove("expanded");
    }
  });
  localStorage.setItem(LAST_TAB_KEY, tabId);

  if (updateHash && location.hash.slice(1) !== tabId) {
    const url = `${location.pathname}${location.search}#${tabId}`;
    if (replace) {
      history.replaceState(null, "", url);
    } else {
      history.pushState(null, "", url);
    }
  }
}
