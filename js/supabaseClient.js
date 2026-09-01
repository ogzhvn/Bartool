import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabaseConfig.js";

let client = null;

export function getSupabaseClient() {
  if (client) return client;
  if (!window.supabase?.createClient) {
    throw new Error("Supabase-JS wurde nicht geladen. Prüfe den <script>-Tag in index.html.");
  }
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
