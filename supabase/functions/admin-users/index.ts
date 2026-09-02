// Bartool – Edge Function "admin-users"
//
// Läuft auf Supabase (Deno), kein eigener Node-Server nötig. Legt
// Mitarbeiter-/Admin-Konten an oder löscht sie. Nur aufrufbar von bereits
// eingeloggten Admins – die Berechtigung wird unten anhand des mitgesendeten
// JWTs und der profiles-Tabelle geprüft, bevor der Service-Role-Key benutzt
// wird.
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
  // den Request stellt und ob diese Person Admin ist.
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
  if (profileError || callerProfile?.role !== "admin") {
    return jsonResponse({ error: "Nur Admins dürfen Konten verwalten." }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Ungültige Anfrage." }, 400);
  }

  // Admin-Client mit Service-Role für die eigentliche Aktion.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  if (body.action === "create") {
    const email = String(body.email ?? "").trim();
    const username = String(body.username ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? "").trim() || null;
    const role = body.role === "admin" ? "admin" : "mitarbeiter";

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

  if (body.action === "delete") {
    const userId = String(body.userId ?? "");
    if (!userId) {
      return jsonResponse({ error: "userId fehlt." }, 400);
    }
    if (userId === caller.id) {
      return jsonResponse({ error: "Das eigene Konto kann hier nicht gelöscht werden." }, 400);
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
