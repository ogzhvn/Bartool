import { getProduct } from "./productLibrary.js";
import { getLanguage, germanOnlyNote, hasTranslation, t } from "./i18n.js";

// Allergene eines Drinks aus den Angaben der einzelnen Produkte.
//
// Bewusst zurückhaltend: Bartool sagt nie "allergenfrei". Rund ein Drittel der
// Produkte hat gar keinen Allergen-Eintrag, und selbst gepflegte Angaben sind
// keine Rechtsauskunft. Zutaten ohne belastbare Angabe werden deshalb als
// ausdrücklich ungeprüft ausgewiesen, statt sie stillschweigend wegzulassen.

// Einträge, die im Katalog "nichts bekannt" bedeuten und keine echte Angabe sind.
// Vergleich gegen den Produktkatalog, nicht gegen Oberflächentext: die
// Werte stehen so in den Produktdaten und bleiben deshalb deutsch.
const OHNE_BEFUND = ["keine bekannten", "keine", "-", "keine bekannt"];

function istOhneBefund(text) {
  return OHNE_BEFUND.includes(String(text ?? "").trim().toLowerCase());
}

// Allergenangaben aus dem Produktkatalog sind eine feste, überschaubare Liste
// (Stand Paket 33: 17 verschiedene Texte über alle 176 Produkte). Sie werden
// deshalb hier auf einen Schlüssel abgebildet und in den Sprachdateien
// übersetzt – nicht in der Datenbank. Der Katalog bleibt unangetastet.
//
// Der Schlüssel des Vergleichs ist der kleingeschriebene deutsche Text, so wie
// er in den Produktdaten steht. Kommt ein Text vor, der hier fehlt (neues
// Produkt), bleibt er deutsch und wird als solcher gekennzeichnet.
const ALLERGEN_KEYS = {
  "keine bekannten": "allergen.keine_bekannten",
  "enthält sulfite": "allergen.enthaelt_sulfite",
  "enthält sulfite (weinbasiert)": "allergen.enthaelt_sulfite_weinbasiert",
  "enthält koffein": "allergen.enthaelt_koffein",
  "enthält milch/laktose": "allergen.enthaelt_milch_laktose",
  "milch/laktose": "allergen.milch_laktose",
  "enthält gluten (gerste)": "allergen.enthaelt_gluten_gerste",
  "enthält gluten (weizen)": "allergen.enthaelt_gluten_weizen",
  "enthält ei": "allergen.enthaelt_ei",
  "enthält fisch (sardellen)": "allergen.enthaelt_fisch_sardellen",
  "enthält mandeln (nussallergie beachten)": "allergen.enthaelt_mandeln_nussallergie",
  "aus getreide – destillierter alkohol gilt meist als glutenfrei":
    "allergen.aus_getreide_destilliert",
  "aus weizen – destillierter alkohol gilt meist als glutenfrei":
    "allergen.aus_weizen_destilliert",
  "aus roggen – destillierter alkohol gilt meist als glutenfrei":
    "allergen.aus_roggen_destilliert",
  "aus getreide (roggen) – destillierter alkohol gilt meist als glutenfrei":
    "allergen.aus_getreide_roggen_destilliert",
  "kann spuren von nüssen enthalten": "allergen.kann_spuren_von_nuessen",
  "kann spuren von nüssen/aprikosenkernen enthalten – bei nussallergie prüfen":
    "allergen.kann_spuren_nuesse_aprikosenkerne",
};

// Übersetzt eine Allergenangabe für die Anzeige. Mehrfachangaben stehen im
// Katalog kommagetrennt ("Enthält Koffein, Milch/Laktose") und werden Teil für
// Teil übersetzt. Rückgabe wie bei localizedContent(): { text, isGermanOnly }.
export function allergenLabel(angabe) {
  const text = String(angabe ?? "").trim();
  if (!text || getLanguage() === "de") return { text, isGermanOnly: false };

  let unuebersetzt = false;
  const teile = text.split(",").map((teil) => {
    const roh = teil.trim();
    const key = ALLERGEN_KEYS[roh.toLowerCase()];
    if (key && hasTranslation(key)) return t(key);
    unuebersetzt = true;
    return roh;
  });
  return { text: teile.join(", "), isGermanOnly: unuebersetzt };
}

// Fertiger Anzeigetext inklusive Hinweis, wenn ein Teil deutsch geblieben ist.
export function allergenText(angabe) {
  const { text, isGermanOnly } = allergenLabel(angabe);
  return isGermanOnly ? `${text} (${germanOnlyNote()})` : text;
}

// Liefert:
//   entries   – [{ product, allergens }] je Zutat mit echter Angabe
//   unchecked – [{ name, reason }] Zutaten ohne belastbare Angabe
//   clear     – [Namen] Zutaten, die ausdrücklich als unbedenklich gepflegt sind
export function allergensForRecipe(recipe) {
  const entries = [];
  const unchecked = [];
  const clear = [];

  (recipe?.ingredients ?? []).forEach((ing) => {
    const name = String(ing?.name ?? "").trim();
    if (!name) return;

    const produkt = getProduct(name);
    if (!produkt) {
      unchecked.push({ name, reason: t("ui.nicht_im_produktkatalog") });
      return;
    }

    const angabe = String(produkt.allergens ?? "").trim();
    if (!angabe) {
      unchecked.push({ name: produkt.name, reason: t("ui.kein_eintrag_im_katalog") });
      return;
    }
    if (istOhneBefund(angabe)) {
      clear.push(produkt.name);
      return;
    }
    entries.push({ product: produkt.name, allergens: angabe });
  });

  return { entries, unchecked, clear };
}
