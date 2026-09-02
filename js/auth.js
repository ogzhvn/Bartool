import { getSupabaseClient } from "./supabaseClient.js";

let currentSession = null;
let currentProfile = null;
const listeners = new Set();

function notify() {
  listeners.forEach((callback) => callback({ session: currentSession, profile: currentProfile }));
}

async function loadProfile() {
  if (!currentSession) {
    currentProfile = null;
    return;
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentSession.user.id)
    .single();
  currentProfile = error ? null : data;
}

export async function initAuth() {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  currentSession = data.session;
  await loadProfile();
  notify();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentSession = session;
    await loadProfile();
    notify();
  });
}

export function onAuthChange(callback) {
  listeners.add(callback);
}

// Login läuft über die Edge Function "login-with-username": sie löst den
// Benutzernamen serverseitig auf die hinterlegte E-Mail auf und meldet den
// Nutzer bei Supabase Auth an. Der Client bekommt nur die Session-Tokens
// zurück und übernimmt sie hier lokal.
export async function signIn(username, password) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("login-with-username", {
    body: { username: username.trim().toLowerCase(), password },
  });

  if (error || !data?.access_token || !data?.refresh_token) {
    return { error: new Error(data?.error || error?.message || "Login fehlgeschlagen.") };
  }

  return supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
}

export async function signOut() {
  const supabase = getSupabaseClient();
  return supabase.auth.signOut();
}

// Setzt das eigene Passwort neu und quittiert einen erzwungenen
// Erstwechsel (must_change_password) über einen eng begrenzten RPC-Aufruf,
// der nur das eigene Profil anfassen darf.
export async function changePassword(newPassword) {
  const supabase = getSupabaseClient();
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return { error: updateError };
  }

  const { error: rpcError } = await supabase.rpc("mark_password_changed");
  if (rpcError) {
    return { error: rpcError };
  }

  await loadProfile();
  notify();
  return { error: null };
}

// Erzwungener Erst-Login: setzt Passwort und selbstgewählten Benutzernamen
// (statt des vom Admin vergebenen Platzhalters) in einem Zug und quittiert
// must_change_password.
export async function completeFirstLogin(username, newPassword) {
  const supabase = getSupabaseClient();
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) {
    return { error: updateError };
  }

  const { error: rpcError } = await supabase.rpc("complete_first_login", {
    new_username: username.trim().toLowerCase(),
  });
  if (rpcError) {
    return { error: rpcError };
  }

  await loadProfile();
  notify();
  return { error: null };
}

export function getCurrentUser() {
  return currentSession?.user ?? null;
}

export function getCurrentProfile() {
  return currentProfile;
}

export function isAdmin() {
  return currentProfile?.role === "admin";
}
