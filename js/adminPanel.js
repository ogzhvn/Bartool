import { getSupabaseClient } from "./supabaseClient.js";
import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { switchTab } from "./tabs.js";
import { onLanguageChanged, t } from "./i18n.js";

// Übersicht des Adminbereichs (Sub-Tab "admin", Paket 34).
//
// Kontenverwaltung und Quiz-Pflege sind nach js/adminUsers.js bzw.
// js/adminQuiz.js gewandert. Hier bleibt nur die Startseite des Bereichs:
// je Unterpunkt eine Kachel mit einer Kennzahl, die den Weg dorthin abkürzt.
// Die Kennzahlen sind bewusst billig – zwei count-Abfragen und zwei Listen,
// die ohnehin schon im Speicher liegen.

const cardsEl = document.getElementById("admin-overview-cards");

const CARDS = [
  { tab: "admin-users", icon: "ph-users", titleKey: "ui.konten", descKey: "ui.konten_anlegen_rollen_setzen_passwoerter_b71a" },
  { tab: "admin-roles", icon: "ph-shield-check", titleKey: "ui.rollen_und_rechte", descKey: "ui.wer_darf_was_folgt_in_einem_der_e2c5" },
  { tab: "admin-requests", icon: "ph-git-pull-request", titleKey: "ui.offene_vorschlaege", descKey: "ui.aenderungsvorschlaege_aus_dem_team_6ab3" },
  { tab: "admin-quiz", icon: "ph-brain", titleKey: "ui.quiz_fragen", descKey: "ui.eigene_fragen_pflegen_und_das_team_4d19" },
  { tab: "admin-data", icon: "ph-list-magnifying-glass", titleKey: "ui.datenqualitaet", descKey: "ui.welche_angaben_fehlen_noch_im_katalog_c0f5" },
  { tab: "admin-audit", icon: "ph-clock-counter-clockwise", titleKey: "ui.aenderungsverlauf", descKey: "ui.wer_hat_wann_was_geaendert_d3b8" },
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
  const [konten, vorschlaege] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("change_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return {
    "admin-users": konten.error ? null : konten.count,
    "admin-requests": vorschlaege.error ? null : vorschlaege.count,
    "admin-data": katalogLuecken(),
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
  CARDS.forEach((card) => {
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
