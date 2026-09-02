// Bartool – Edge Function "login-with-username"
//
// Supabase Auth arbeitet intern mit E-Mail-Adressen, im Service-Alltag
// hinterm Tresen ist ein Benutzername aber leichter zu merken/einzutippen.
// Diese Function löst den Benutzernamen serverseitig (per Service-Role) auf
// die hinterlegte E-Mail auf und meldet den Nutzer damit an – der Client
// sieht nur den Benutzernamen, nie die E-Mail.
//
// Läuft ohne JWT-Prüfung (verify_jwt=false), da der Aufrufer beim Login
// naturgemäß noch nicht angemeldet ist.
//
// Deployment: `supabase functions deploy login-with-username --no-verify-jwt`

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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Ungültige Anfrage." }, 400);
  }

  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!username || !password) {
    return jsonResponse({ error: "Benutzername oder Passwort ist falsch." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile } = await adminClient
    .from("profiles")
    .select("email")
    .eq("username", username)
    .maybeSingle();

  // Bewusst dieselbe Fehlermeldung wie bei falschem Passwort – kein
  // Aufschluss darüber geben, ob der Benutzername überhaupt existiert.
  if (!profile) {
    return jsonResponse({ error: "Benutzername oder Passwort ist falsch." }, 400);
  }

  const authClient = createClient(supabaseUrl, anonKey);
  const { data, error } = await authClient.auth.signInWithPassword({
    email: profile.email,
    password,
  });

  if (error || !data.session) {
    return jsonResponse({ error: "Benutzername oder Passwort ist falsch." }, 400);
  }

  return jsonResponse({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
});
