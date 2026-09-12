import { t } from "./i18n.js";

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

// "reporting" war bis Paket 37 ein eigener Hauptpunkt und ist jetzt der
// Sub-Tab "admin-reports". Alte Lesezeichen und der gemerkte letzte Tab
// (localStorage) sollen nicht ins Leere laufen.
const TAB_ALIASES = { reporting: "admin-reports" };

function resolveTab(tabId) {
  return TAB_ALIASES[tabId] ?? tabId;
}

function tabExists(tabId) {
  return !!tabId && !!document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
}

function currentTabId() {
  return document.querySelector(".tab-btn.active")?.dataset.tab ?? null;
}

// Im mobilen Header (< 900px) steht statt "Bartool" der Name des offenen
// Tabs, damit man nach dem Schließen des Drawers noch weiß, wo man ist.
// Quelle ist der data-i18n-Key des zugehörigen .tab-btn, deshalb bleibt der
// Titel auch nach einem Sprachwechsel korrekt (applyTranslations() rendert
// jedes [data-i18n]-Element neu, dieses hier eingeschlossen).
function updateMobileHeaderTitle(tabId) {
  const titleTab = document.getElementById("app-title-tab");
  if (!titleTab) return;
  const key = document.querySelector(`.tab-btn[data-tab="${tabId}"]`)?.dataset.i18n;
  if (!key) return;
  titleTab.dataset.i18n = key;
  titleTab.textContent = t(key);
}

function setGroupExpanded(group, expanded) {
  group.classList.toggle("collapsed", !expanded);
  group.querySelector(".sidebar-group-toggle")?.setAttribute("aria-expanded", String(expanded));
}

// Immer nur die Gruppe des aktiven Tabs offen halten. Komplett ausgeklappt ist
// die Navigation hoeher als der Bildschirm - auf dem Handy im Drawer genauso
// wie auf einem kleinen Laptop.
// Start haengt in keiner Gruppe: dort bleibt offen, was offen war, statt die
// Navigation komplett zuzuklappen.
function syncGroupsToTab(tabId) {
  const groups = [...document.querySelectorAll(".sidebar-group")].filter((group) =>
    group.querySelector(".sidebar-group-toggle")
  );
  const target = groups.find((group) => group.querySelector(`.tab-btn[data-tab="${tabId}"]`));
  if (!target) return;
  groups.forEach((group) => setGroupExpanded(group, group === target));
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

// Module mit ungespeicherten Eingaben können hier eine Rückfrage anmelden
// (Katalogtabelle: offene Zelländerungen). Gibt ein Guard false zurück,
// bleibt der aktuelle Tab stehen und switchTab() meldet false zurück.
const tabGuards = new Set();

export function registerTabGuard(guard) {
  tabGuards.add(guard);
  return () => tabGuards.delete(guard);
}

function darfWechseln(tabId) {
  return [...tabGuards].every((guard) => guard(tabId) !== false);
}

// Filterfeld im Kopf des mobilen Drawers: durchsucht die Nav-Einträge
// (.tab-btn, .subnav-btn – Haupttabs, Admin-Unterpunkte, Rezept-/Produkt-
// Kategoriebäume) live per Teilstring-Vergleich. Verändert dabei nie die
// echten collapsed/expanded-Klassen, sondern nur die eigenen
// nav-filter-*-Klassen (siehe CSS) – so muss beim Leeren des Felds nichts
// zurückgesetzt werden, der vorherige Accordion-Zustand steht einfach
// wieder da.
function filterNav(rawQuery) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  const query = rawQuery.trim().toLowerCase();
  const active = query !== "";
  sidebar.classList.toggle("nav-filtering", active);

  const items = sidebar.querySelectorAll(".tab-btn, .subnav-btn");
  const containers = sidebar.querySelectorAll(".sidebar-group, .sidebar-subnav");

  if (!active) {
    items.forEach((el) => el.classList.remove("nav-filter-hidden"));
    containers.forEach((el) => el.classList.remove("nav-filter-hidden", "nav-filter-expanded"));
    return;
  }

  items.forEach((el) => {
    const matches = el.textContent.trim().toLowerCase().includes(query);
    el.classList.toggle("nav-filter-hidden", !matches);
  });

  containers.forEach((container) => {
    const hasVisibleItem = [...container.querySelectorAll(".tab-btn, .subnav-btn")].some(
      (el) => !el.classList.contains("nav-filter-hidden")
    );
    container.classList.toggle("nav-filter-hidden", !hasVisibleItem);
    container.classList.toggle("nav-filter-expanded", hasVisibleItem);
  });
}

function setupNavFilter() {
  const filterInput = document.getElementById("nav-filter-input");
  filterInput?.addEventListener("input", () => filterNav(filterInput.value));
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

  document.querySelectorAll(".sidebar-group-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const group = toggle.closest(".sidebar-group");
      if (group) setGroupExpanded(group, group.classList.contains("collapsed"));
    });
  });

  navToggle?.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
    if (navBackdrop) navBackdrop.hidden = !isOpen;
  });

  navBackdrop?.addEventListener("click", closeMobileNav);

  setupNavFilter();

  document.getElementById("app-title")?.addEventListener("click", () => {
    switchTab("home");
    closeMobileNav();
  });

  window.addEventListener("hashchange", () => {
    const tabId = resolveTab(location.hash.slice(1));
    if (!tabExists(tabId)) return;
    // Hat ein Guard abgelehnt, steht der neue Hash schon in der Adresszeile,
    // der Tab aber nicht – deshalb den Hash zurückdrehen.
    if (switchTab(tabId, { updateHash: false })) return;
    const aktiv = currentTabId();
    if (aktiv) history.replaceState(null, "", `${location.pathname}${location.search}#${aktiv}`);
  });

  const hashTab = resolveTab(location.hash.slice(1));
  const lastTab = resolveTab(localStorage.getItem(LAST_TAB_KEY));
  const defaultTab = document.querySelector(".tab-btn.active")?.dataset.tab;
  const initialTab = [hashTab, lastTab, defaultTab].find(tabExists);
  if (initialTab) {
    switchTab(initialTab, { updateHash: true, replace: true });
  }
}

export function switchTab(tabId, { updateHash = true, replace = false, keepEditReturn = false } = {}) {
  tabId = resolveTab(tabId);
  if (tabId !== currentTabId() && !darfWechseln(tabId)) return false;
  if (!keepEditReturn) pendingEditReturn = null;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
  syncGroupsToTab(tabId);
  updateMobileHeaderTitle(tabId);
  document.querySelectorAll(".sidebar-subnav").forEach((subnav) => {
    // Offen bleibt eine Untergruppe, solange ihr eigener Punkt aktiv ist
    // (Kategoriebaum bei Rezepten/Produkten) oder der aktive Tab selbst in
    // ihr steht (Admin-Unterpunkte, Paket 34). Alles andere klappt zu.
    if (subnav.querySelector(`.tab-btn[data-tab="${tabId}"]`)) {
      subnav.classList.add("expanded");
    } else if (subnav.previousElementSibling?.dataset.tab !== tabId) {
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
  return true;
}
