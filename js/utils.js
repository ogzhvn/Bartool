import { t, formatDecimal } from "./i18n.js";
// Zahlen laufen über Intl (js/i18n.js), damit sie der eingestellten Sprache
// folgen: 12,5 auf Deutsch, 12.5 auf Englisch.
export function formatNumber(n) {
  return formatDecimal(Number(n), 2);
}

// Alias aus der Zeit, als es nur Deutsch gab. Beide formatieren heute
// gleich – der Name bleibt, weil ihn viele Module importieren.
export const formatNumberLocal = formatNumber;

// supabase-js liefert bei einer Edge Function, die einen Fehlerstatus (4xx)
// zurückgibt, nur einen generischen Fehler ("Edge Function returned a
// non-2xx status code") in `error` – die eigentliche Fehlermeldung steckt
// im JSON-Body der Response, erreichbar über `error.context`. Ohne diese
// Auswertung sehen Nutzer:innen nie den echten Grund (falsches Passwort,
// Benutzername vergeben, ...).
export async function functionErrorMessage(error, data) {
  if (data?.error) return data.error;
  if (error?.context?.json) {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error;
    } catch {
      // Response ohne JSON-Body - Fallback unten verwenden.
    }
  }
  return error?.message ?? t("ui.unbekannter_fehler");
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}
