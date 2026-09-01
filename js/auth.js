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

export async function signIn(email, password) {
  const supabase = getSupabaseClient();
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  const supabase = getSupabaseClient();
  return supabase.auth.signOut();
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
