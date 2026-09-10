import { getSupabaseClient } from "./supabaseClient.js";
import { functionErrorMessage } from "./utils.js";

let currentSession = null;
let currentProfile = null;
// Rechte und Rang der eigenen Rolle (Paket 36). Beides kommt aus der DB und
// wird beim Laden des Profils mitgeholt, damit can() überall synchron
// aufrufbar bleibt. Durchgesetzt wird trotzdem in den Policies – hier geht es
// nur um die Sichtbarkeit in der Oberfläche.
let currentPermissions = new Set();
let currentRank = 0;
const listeners = new Set();

function notify() {
  listeners.forEach((callback) => callback({ session: currentSession, profile: currentProfile }));
}

async function loadProfile() {
  if (!currentSession) {
    currentProfile = null;
    currentPermissions = new Set();
    currentRank = 0;
    return;
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentSession.user.id)
    .single();
  currentProfile = error ? null : data;
  await loadPermissions();
}

// Rang und Rechte der eigenen Rolle. Beide Tabellen sind für angemeldete
// Konten lesbar (Paket 35), es braucht also keine eigene Funktion dafür.
// Fällt eine der Abfragen aus (kein Netz), bleibt es bei Rang 0 und leerer
// Rechteliste: die Oberfläche zeigt dann nur, was allen offensteht, statt
// Schaltflächen anzubieten, die die Policy hinterher abweist.
async function loadPermissions() {
  currentPermissions = new Set();
  currentRank = 0;
  const role = currentProfile?.role;
  if (!role) return;
  const supabase = getSupabaseClient();
  const [rangAntwort, rechteAntwort] = await Promise.all([
    supabase.from("roles").select("rank").eq("key", role).maybeSingle(),
    supabase.from("role_permissions").select("permission_key").eq("role_key", role),
  ]);
  currentRank = rangAntwort.data?.rank ?? 0;
  (rechteAntwort.data ?? []).forEach((zeile) => currentPermissions.add(zeile.permission_key));
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
    return { error: new Error(await functionErrorMessage(error, data)) };
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

// Spiegelt private.has_permission(): Rang 100 gilt immer als berechtigt,
// damit ein falsch gesetztes Häkchen die Verwaltung nicht aussperrt.
export function can(permission) {
  return currentRank >= 100 || currentPermissions.has(permission);
}

export function canAny(permissions) {
  return permissions.some((permission) => can(permission));
}

export function myRank() {
  return currentRank;
}

export function myPermissions() {
  return [...currentPermissions];
}

// Bleibt erhalten und bedeutet jetzt "oberste Ebene" statt "Rolle heißt
// admin" – gleichbedeutend mit private.is_admin() in der Datenbank.
export function isAdmin() {
  return currentRank >= 100;
}
