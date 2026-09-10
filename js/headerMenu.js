// Konto-Menue in der Kopfzeile: Passwort aendern und Abmelden lagen frueher als
// Pseudo-Tabs in der Sidebar (mit role="tab", aber ohne Panel) und haben dort
// Platz gekostet, den die eigentliche Navigation braucht.
export function initHeaderMenu() {
  const toggle = document.getElementById("user-menu-toggle");
  const popover = document.getElementById("user-menu-popover");
  if (!toggle || !popover) return;

  const close = () => {
    popover.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = popover.hidden;
    popover.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });

  // Die Aktionen selbst haengen in main.js an den Buttons; hier wird nur das
  // Menue wieder geschlossen, damit es nicht ueber dem Modal stehen bleibt.
  popover.querySelectorAll(".user-menu-item").forEach((item) => {
    item.addEventListener("click", close);
  });

  document.addEventListener("click", (e) => {
    if (!popover.hidden && !popover.contains(e.target)) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popover.hidden) {
      close();
      toggle.focus();
    }
  });
}
