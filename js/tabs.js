// On the collapsed mobile nav, picking an entry should close the dropdown
// instead of leaving it open over the newly shown panel. Auch von den
// Unterpunkten des Produkt-Kategoriebaums aufgerufen.
export function closeMobileNav() {
  const sidebar = document.getElementById("sidebar");
  const navToggle = document.getElementById("nav-toggle");
  sidebar?.classList.remove("open");
  navToggle?.setAttribute("aria-expanded", "false");
}

const LAST_TAB_KEY = "bartool-last-tab";

function tabExists(tabId) {
  return !!tabId && !!document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
}

export function initTabs() {
  const sidebar = document.getElementById("sidebar");
  const navToggle = document.getElementById("nav-toggle");

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
      closeMobileNav();
    });
  });

  navToggle?.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
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

export function switchTab(tabId, { updateHash = true, replace = false } = {}) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
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
