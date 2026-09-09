import { isAdmin } from "./auth.js";
import { initAdminPanel } from "./adminPanel.js";
import { initAdminUsers } from "./adminUsers.js";
import { initAdminQuiz } from "./adminQuiz.js";
import { initChangeRequestsAdmin } from "./changeRequests.js";
import { initDataQuality } from "./dataQuality.js";
import { initAuditLog } from "./auditLog.js";

// Registrar für die Admin-Unterpunkte (Paket 34).
//
// Vorher lief beim Login alles auf einmal an: Konten, Vorschläge, Quiz-Fragen,
// Quiz-Team, Datenqualität und Änderungsverlauf – auch wenn niemand hinschaut.
// Jetzt startet jeder Bereich erst, wenn sein Sub-Tab zum ersten Mal sichtbar
// wird, und danach nie wieder.
//
// Ausgelöst wird das über die Klasse "active" am Panel, die switchTab() setzt.
// So hängt der Registrar an keinem zweiten Router und die Tab-Mechanik in
// js/tabs.js bleibt unverändert – egal ob per Klick, Deep-Link (#admin-data)
// oder gemerktem letzten Tab geöffnet wird.
const SECTIONS = {
  admin: initAdminPanel,
  "admin-users": initAdminUsers,
  "admin-requests": initChangeRequestsAdmin,
  "admin-quiz": initAdminQuiz,
  "admin-data": initDataQuality,
  "admin-audit": initAuditLog,
  // "admin-roles" ist bis Paket 36 ein reiner Hinweistext ohne Modul.
};

const gestartet = new Set();

function starteWennNoetig(panel) {
  if (!panel?.classList.contains("active")) return;
  const init = SECTIONS[panel.id];
  // Ohne Adminrecht ist der Bereich weder sichtbar noch erlaubt – dann darf
  // auch kein Ladevorgang anlaufen, selbst wenn jemand die Adresse rät.
  if (!init || gestartet.has(panel.id) || !isAdmin()) return;
  gestartet.add(panel.id);
  init();
}

export function initAdminSections() {
  const beobachter = new MutationObserver((eintraege) => {
    eintraege.forEach((eintrag) => starteWennNoetig(eintrag.target));
  });

  Object.keys(SECTIONS).forEach((id) => {
    const panel = document.getElementById(id);
    if (!panel) return;
    beobachter.observe(panel, { attributes: true, attributeFilter: ["class"] });
    // Falls der Tab beim Start schon aktiv ist (Deep-Link, gemerkter Tab).
    starteWennNoetig(panel);
  });
}
