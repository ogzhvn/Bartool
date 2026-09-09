import { getProduct } from "./productLibrary.js";
import { t } from "./i18n.js";

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
