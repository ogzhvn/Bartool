import { getSupabaseClient } from "./supabaseClient.js";

// Rollen aus der DB-Tabelle "roles" (Paket 35). Die Labels stehen bewusst in
// der Datenbank und werden nicht übersetzt – wie Produktkatalog und
// Kategorienamen. Die Rechte-Labels dagegen kommen aus dem Frontend (t()).
//
// Rangfolge: "rank" entscheidet, wer wen verwalten darf. admin = 100 ist die
// oberste Rolle, durchgesetzt wird das in der Datenbank (RLS + Trigger) und in
// der Edge Function "admin-users", nicht hier.

let rolesCache = null;
let pendingLoad = null;

export async function loadRoles({ force = false } = {}) {
  if (rolesCache && !force) return rolesCache;
  if (pendingLoad && !force) return pendingLoad;

  pendingLoad = (async () => {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("roles")
      .select("key, label, rank, is_system, sort")
      .order("sort");
    if (error) {
      // Ohne Rollenliste bleibt die Oberfläche bedienbar: die Rolle wird dann
      // als Schlüssel angezeigt statt als Klartext.
      console.warn("Rollen konnten nicht geladen werden:", error.message);
      rolesCache = rolesCache ?? [];
    } else {
      rolesCache = data ?? [];
    }
    pendingLoad = null;
    return rolesCache;
  })();

  return pendingLoad;
}

export function getRolesSync() {
  return rolesCache ?? [];
}

export function roleLabel(key) {
  if (!key) return "";
  return getRolesSync().find((r) => r.key === key)?.label ?? key;
}

export function roleRank(key) {
  return getRolesSync().find((r) => r.key === key)?.rank ?? 0;
}
