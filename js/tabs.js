export function initTabs() {
  const sidebar = document.getElementById("sidebar");
  const navToggle = document.getElementById("nav-toggle");

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
      // On the collapsed mobile nav, picking a tab should close the dropdown
      // instead of leaving it open over the newly shown panel.
      sidebar?.classList.remove("open");
      navToggle?.setAttribute("aria-expanded", "false");
    });
  });

  navToggle?.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(isOpen));
  });
}

export function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });
}
