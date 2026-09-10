import { can, canAny } from "./auth.js";
import { initAdminPanel } from "./adminPanel.js";
import { initAdminReports } from "./adminReports.js";
import { initAdminUsers } from "./adminUsers.js";
import { initAdminRoles } from "./adminRoles.js";
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
//
// Seit Paket 36 hängt jeder Unterpunkt an seinem Recht statt am Adminstatus:
// die Barleitung soll Konten verwalten können, ohne Rollen und Rechte zu
// ändern, und umgekehrt.
const SECTIONS = {
  admin: { init: initAdminPanel, perm: null },
  "admin-reports": { init: initAdminReports, perm: "reports.view" },
  "admin-users": { init: initAdminUsers, perm: "users.manage" },
  "admin-roles": { init: initAdminRoles, perm: "roles.manage" },
  "admin-requests": { init: initChangeRequestsAdmin, perm: "requests.review" },
  "admin-quiz": { init: initAdminQuiz, perm: "quiz.manage" },
  "admin-data": { init: initDataQuality, perm: "data.manage" },
  "admin-audit": { init: initAuditLog, perm: "audit.view" },
};

// Wer mindestens eines dieser Rechte hat, sieht die Gruppe "Admin" in der
// Seitenleiste und die Übersichtsseite dahinter. Wird auch von
// js/main.js (data-perm-any ohne Wert) und js/adminPanel.js gebraucht.
export const ADMIN_AREA_PERMISSIONS = Object.values(SECTIONS)
  .map((eintrag) => eintrag.perm)
  .filter(Boolean);

const gestartet = new Set();

function darfSehen(id) {
  const perm = SECTIONS[id]?.perm;
  if (!perm) return canAny(ADMIN_AREA_PERMISSIONS);
  return can(perm);
}

function starteWennNoetig(panel) {
  if (!panel?.classList.contains("active")) return;
  const eintrag = SECTIONS[panel.id];
  // Ohne das nötige Recht ist der Bereich weder sichtbar noch erlaubt – dann
  // darf auch kein Ladevorgang anlaufen, selbst wenn jemand die Adresse rät.
  if (!eintrag || gestartet.has(panel.id) || !darfSehen(panel.id)) return;
  gestartet.add(panel.id);
  eintrag.init();
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
