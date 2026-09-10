import { getSupabaseClient } from "./supabaseClient.js";
import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { switchTab } from "./tabs.js";
import { onLanguageChanged, t } from "./i18n.js";
import { can } from "./auth.js";

// Übersicht des Adminbereichs (Sub-Tab "admin", Paket 34).
//
// Kontenverwaltung und Quiz-Pflege sind nach js/adminUsers.js bzw.
// js/adminQuiz.js gewandert. Hier bleibt nur die Startseite des Bereichs:
// je Unterpunkt eine Kachel mit einer Kennzahl, die den Weg dorthin abkürzt.
// Die Kennzahlen sind bewusst billig – zwei count-Abfragen und zwei Listen,
// die ohnehin schon im Speicher liegen.

const cardsEl = document.getElementById("admin-overview-cards");

// perm: das Recht, das den Unterpunkt sichtbar macht (Paket 36). Wer es nicht
// hat, bekommt die Kachel nicht zu sehen – sonst führt sie in ein Panel, das
// die Rechteprüfung ohnehin leer lässt.
const CARDS = [
  { tab: "admin-users", perm: "users.manage", icon: "ph-users", titleKey: "ui.konten", descKey: "ui.konten_anlegen_rollen_setzen_passwoerter_b71a" },
  { tab: "admin-roles", perm: "roles.manage", icon: "ph-shield-check", titleKey: "ui.rollen_und_rechte", descKey: "ui.je_rolle_festlegen_welche_rechte_gelten_f7a2" },
  { tab: "admin-requests", perm: "requests.review", icon: "ph-git-pull-request", titleKey: "ui.offene_vorschlaege", descKey: "ui.aenderungsvorschlaege_aus_dem_team_6ab3" },
  { tab: "admin-quiz", perm: "quiz.manage", icon: "ph-brain", titleKey: "ui.quiz_fragen", descKey: "ui.eigene_fragen_pflegen_und_das_team_4d19" },
  { tab: "admin-data", perm: "data.manage", icon: "ph-list-magnifying-glass", titleKey: "ui.datenqualitaet", descKey: "ui.welche_angaben_fehlen_noch_im_katalog_c0f5" },
  { tab: "admin-audit", perm: "audit.view", icon: "ph-clock-counter-clockwise", titleKey: "ui.aenderungsverlauf", descKey: "ui.wer_hat_wann_was_geaendert_d3b8" },
];

// Fehlende Pflichtangaben im Katalog – dieselben Felder, die die
// Datenqualität ausführlich auflistet, hier nur als eine Zahl.
function katalogLuecken() {
  const produkte = getAllProducts().filter(
    (p) => !p.priceValue || !p.quickPitch || !p.originCountry || !p.baseMaterial || !p.verified
  ).length;
  const rezepte = getAllRecipes().filter((r) => !r.quickPitch || !r.method).length;
  return produkte + rezepte;
}

async function ladeKennzahlen() {
  const supabase = getSupabaseClient();
  // Ohne das jeweilige Recht wird gar nicht gefragt: die Policy würde die
  // Abfrage ohnehin leer beantworten.
  const [konten, vorschlaege] = await Promise.all([
    can("users.manage")
      ? supabase.from("profiles").select("id", { count: "exact", head: true })
      : Promise.resolve({ error: true }),
    can("requests.review")
      ? supabase.from("change_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ error: true }),
  ]);
  return {
    "admin-users": konten.error ? null : konten.count,
    "admin-requests": vorschlaege.error ? null : vorschlaege.count,
    "admin-data": can("data.manage") ? katalogLuecken() : null,
  };
}

function kennzahlText(tab, wert) {
  if (wert == null) return "";
  if (tab === "admin-users") return `${wert} ${t("ui.konten")}`;
  if (tab === "admin-requests") return `${wert} ${t("ui.offen")}`;
  if (tab === "admin-data") return `${wert} ${t("ui.luecken")}`;
  return "";
}

function render(kennzahlen = {}) {
  if (!cardsEl) return;
  cardsEl.innerHTML = "";
  CARDS.filter((card) => can(card.perm)).forEach((card) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tool-card";

    const icon = document.createElement("i");
    icon.className = `ph ${card.icon} tool-card-icon`;
    icon.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "tool-card-title";
    title.textContent = t(card.titleKey);

    const desc = document.createElement("span");
    desc.className = "tool-card-desc";
    const zahl = kennzahlText(card.tab, kennzahlen[card.tab]);
    desc.textContent = zahl ? `${zahl} · ${t(card.descKey)}` : t(card.descKey);

    btn.append(icon, title, desc);
    btn.addEventListener("click", () => switchTab(card.tab));
    cardsEl.appendChild(btn);
  });
}

export async function initAdminPanel() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist. Die Kennzahlen
  // werden dabei frisch geholt – der Adminbereich ist keine Dauerschleife.
  onLanguageChanged(() => ladeKennzahlen().then(render));

  render();
  render(await ladeKennzahlen());
}
