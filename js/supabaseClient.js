import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseConfig.js";
import { alleRaeumbarenPuffer, schreibeMitPlatz } from "./localSpace.js";

// Die Sitzung geht vor jedem Offline-Puffer: ohne sie kommt niemand mehr
// hinein. Ist der localStorage voll, räumt das Speichern der Sitzung so viele
// Puffer frei wie nötig (js/localSpace.js) – vorher blieb der Login still
// hängen.
const authSpeicher = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, wert) => schreibeMitPlatz(key, wert, alleRaeumbarenPuffer(key)),
  removeItem: (key) => localStorage.removeItem(key),
};

let client = null;

export function getSupabaseClient() {
  if (client) return client;
  if (!window.supabase?.createClient) {
    throw new Error("Supabase-JS wurde nicht geladen. Prüfe den <script>-Tag in index.html.");
  }
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { storage: authSpeicher },
  });
  return client;
}
