// src/lib/auth.js
import { supabase } from "./supabaseClient";

/* ============== Helpers umum ============== */

export function normalizeUsername(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_")
    .replace(/_+/g, "_");
  return s;
}

export function validateUsername(u) {
  return /^[a-z0-9._-]{3,30}$/.test(u || "");
}

/** pastikan row profiles ada untuk user.id. kalau belum, buat. */
export async function ensureProfile(user, { username, display_name } = {}) {
  if (!user) return;

  const { data: p, error } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return;

  if (!p) {
    const base = normalizeUsername(
      username ||
      user.user_metadata?.username ||
      user.user_metadata?.login_id ||
      (user.email || "").split("@")[0] ||
      `user_${user.id.slice(0, 6)}`
    ).slice(0, 30) || `user_${user.id.slice(0, 6)}`;

    const uname = await reserveUsername(base);
    await supabase.from("profiles").insert({
      id: user.id,
      username: uname,
      display_name:
        display_name ||
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        uname,
    });
  }
}

/** ambil username unik; kalau sudah ada, tambah suffix -1, -2, dst */
async function reserveUsername(base) {
  const root = normalizeUsername(base) || "user";
  let uname = root;
  let n = 0;
  // hindari loop panjang; batas 50 percobaan sudah sangat cukup
  // (atau ganti ke random suffix kalau mau)
  while (n < 50) {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .ilike("username", uname)
      .limit(1);
    if (!data?.length) return uname;
    n += 1;
    uname = `${root}-${n}`;
  }
  return `${root}-${crypto.randomUUID().slice(0, 6)}`;
}

/* ============== Jalur login/register ============== */

/** 1) Guest (anonymous) — tanpa email */
export async function signInGuestUsername({ username, fullName }) {
  const uname = normalizeUsername(username);
  if (!validateUsername(uname)) {
    return { data: null, error: new Error("Username 3–30, huruf/angka/._-") };
  }

  // anonymous sign-in
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) return { data: null, error };

  // buat/isi profiles
  await ensureProfile(data.user, { username: uname, display_name: fullName });

  return { data, error: null };
}

/** 2) Email + Password (signup) */
export async function signUpWithEmail({ email, password, fullName }) {
  email = String(email || "").trim().toLowerCase();
  if (!email.includes("@")) return { data: null, error: new Error("Email tidak valid") };
  if ((password || "").length < 8) return { data: null, error: new Error("Password min. 8") };

  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: fullName || "" } }
  });
  if (error) return { data: null, error };

  // jika Email Confirmations OFF → user langsung ada
  if (data.user) await ensureProfile(data.user);
  return { data, error: null };
}

/** 3) Email + Password (login) */
export async function signInWithEmail({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error && data?.user) await ensureProfile(data.user);
  return { data, error };
}

/** 4) OAuth (Google, dsb) */
export async function signInWithOAuth(provider = "google") {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${location.origin}/` }
  });
  return { data, error };
}

/** logout */
export async function signOut() {
  await supabase.auth.signOut();
}

/** upgrade guest/OAuth → tambah email+password */
export async function linkEmailPassword({ email, password }) {
  email = String(email || "").trim().toLowerCase();
  if (!email.includes("@")) return { error: new Error("Email tidak valid") };
  if ((password || "").length < 8) return { error: new Error("Password min. 8") };
  const { error } = await supabase.auth.updateUser({ email, password });
  return { error };
}
