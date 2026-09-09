// Bartool – Edge Function "admin-users"
//
// Läuft auf Supabase (Deno), kein eigener Node-Server nötig. Legt Konten an
// oder löscht sie. Aufrufbar von jedem angemeldeten Konto, dessen Rolle das
// Recht "users.manage" hat – geprüft wird unten anhand des mitgesendeten JWTs
// und der Tabellen profiles/roles/role_permissions, bevor der Service-Role-Key
// benutzt wird.
//
// Rangfolge (Paket 35): Eine Rolle darf nur für Rollen mit kleinerem Rang
// vergeben werden, und ein Konto darf nur bearbeitet/gelöscht werden, wenn
// seine Rolle einen kleineren Rang hat als die eigene. Damit kann z. B. ein
// Barchef (Rang 80) kein Admin-Konto (Rang 100) anlegen, zurücksetzen oder
// löschen. Das letzte Admin-Konto ist zusätzlich per Datenbank-Trigger gegen
// Herabstufen und Löschen gesichert.
//
// Deployment: `supabase functions deploy admin-users`
// (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY stellt
// Supabase Edge Functions automatisch als Env-Vars bereit.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Nicht angemeldet." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Client im Namen des Aufrufers (respektiert RLS) – nur um zu prüfen, wer
  // den Request stellt und welche Rolle dieses Konto hat.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user: caller },
    error: userError,
  } = await callerClient.auth.getUser();
  if (userError || !caller) {
    return jsonResponse({ error: "Nicht angemeldet." }, 401);
  }

  const { data: callerProfile, error: profileError } = await callerClient
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .single();
  if (profileError || !callerProfile?.role) {
    return jsonResponse({ error: "Rolle des eigenen Kontos ist nicht lesbar." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Ungültige Anfrage." }, 400);
  }

  // Admin-Client mit Service-Role für die eigentliche Aktion.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Rang einer Rolle; null, wenn die Rolle nicht existiert.
  async function rankOf(roleKey: string): Promise<number | null> {
    const { data } = await adminClient.from("roles").select("rank").eq("key", roleKey).maybeSingle();
    return typeof data?.rank === "number" ? data.rank : null;
  }

  const callerRole = String(callerProfile.role);
  const callerRank = (await rankOf(callerRole)) ?? 0;

  // Spiegelt private.has_permission(): ab Rang 100 gilt alles als erlaubt,
  // sonst zählt der Eintrag in role_permissions.
  async function callerHasPermission(permission: string): Promise<boolean> {
    if (callerRank >= 100) return true;
    const { data } = await adminClient
      .from("role_permissions")
      .select("permission_key")
      .eq("role_key", callerRole)
      .eq("permission_key", permission)
      .maybeSingle();
    return Boolean(data);
  }

  if (!(await callerHasPermission("users.manage"))) {
    return jsonResponse({ error: "Für die Kontenverwaltung fehlt dir die Berechtigung." }, 403);
  }

  // Zielkonto laden und gegen den eigenen Rang prüfen.
  async function loadTarget(userId: string) {
    const { data } = await adminClient.from("profiles").select("id, role").eq("id", userId).maybeSingle();
    return data;
  }

  function rankTooHigh(targetRank: number | null): boolean {
    return targetRank === null || targetRank >= callerRank;
  }

  if (body.action === "create") {
    const email = String(body.email ?? "").trim();
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? "").trim() || null;
    const role = String(body.role ?? "barkeeper").trim();

    if (!email || !username || password.length < 8) {
      return jsonResponse(
        { error: "E-Mail, Benutzername und ein Passwort mit mindestens 8 Zeichen werden benötigt." },
        400
      );
    }
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return jsonResponse(
        {
          error:
            "Benutzername darf nur Kleinbuchstaben, Zahlen, Punkt, Unterstrich und Bindestrich enthalten (3–32 Zeichen).",
        },
        400
      );
    }

    const roleRank = await rankOf(role);
    if (roleRank === null) {
      return jsonResponse({ error: "Diese Rolle gibt es nicht." }, 400);
    }
    if (rankTooHigh(roleRank)) {
      return jsonResponse(
        { error: "Du kannst nur Konten mit einer Rolle unterhalb deiner eigenen anlegen." },
        403
      );
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      return jsonResponse({ error: createError?.message ?? "Konto konnte nicht angelegt werden." }, 400);
    }

    const { error: insertError } = await adminClient.from("profiles").insert({
      id: created.user.id,
      email,
      username,
      display_name: displayName,
      role,
    });
    if (insertError) {
      // Aufräumen, damit kein verwaister Auth-User ohne Profil zurückbleibt.
      await adminClient.auth.admin.deleteUser(created.user.id);
      const message = insertError.message.includes("profiles_username_key")
        ? "Dieser Benutzername ist bereits vergeben."
        : insertError.message;
      return jsonResponse({ error: message }, 400);
    }

    return jsonResponse({ userId: created.user.id });
  }

  if (body.action === "reset-password") {
    const userId = String(body.userId ?? "");
    const password = String(body.password ?? "");
    if (!userId || password.length < 8) {
      return jsonResponse({ error: "userId und ein Passwort mit mindestens 8 Zeichen werden benötigt." }, 400);
    }

    const target = await loadTarget(userId);
    if (!target) {
      return jsonResponse({ error: "Konto nicht gefunden." }, 404);
    }
    if (rankTooHigh(await rankOf(String(target.role)))) {
      return jsonResponse(
        { error: "Du kannst nur Konten mit einer Rolle unterhalb deiner eigenen bearbeiten." },
        403
      );
    }

    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, { password });
    if (updateError) {
      return jsonResponse({ error: updateError.message }, 400);
    }

    // Wie bei der Konto-Neuanlage: nächster Login zwingt zum Setzen eines
    // eigenen Passworts, das temporäre bleibt nicht dauerhaft gültig.
    const { error: profileError } = await adminClient
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", userId);
    if (profileError) {
      return jsonResponse({ error: profileError.message }, 400);
    }

    return jsonResponse({ ok: true });
  }

  if (body.action === "delete") {
    const userId = String(body.userId ?? "");
    if (!userId) {
      return jsonResponse({ error: "userId fehlt." }, 400);
    }
    if (userId === caller.id) {
      return jsonResponse({ error: "Das eigene Konto kann hier nicht gelöscht werden." }, 400);
    }

    const target = await loadTarget(userId);
    if (!target) {
      return jsonResponse({ error: "Konto nicht gefunden." }, 404);
    }
    if (rankTooHigh(await rankOf(String(target.role)))) {
      return jsonResponse(
        { error: "Du kannst nur Konten mit einer Rolle unterhalb deiner eigenen löschen." },
        403
      );
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 400);
    }
    // profiles-Zeile fällt per "on delete cascade" automatisch weg.
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Unbekannte Aktion." }, 400);
});
