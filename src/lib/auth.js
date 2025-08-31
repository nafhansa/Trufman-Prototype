// src/lib/auth.js
import { supabase } from "./supabaseClient";

/** Domain dummy untuk username-only. Hindari .local — pakai .test */
export const USERNAME_DOMAIN = "trufman.test";

/* ==================== Helpers ==================== */

/** Normalize username: huruf kecil + hanya [a-z0-9._-], panjang 3–30 */
export function normalizeUsername(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "_") // non-allowed -> _
    .replace(/_+/g, "_");          // merge underscores
  return s;
}

export function validateUsername(u) {
  return /^[a-z0-9._-]{3,30}$/.test(u);
}

/** Terima login (username atau email) → selalu kembalikan email */
export function loginIdToEmail(login) {
  if (!login) return "";
  const s = String(login).trim();
  return s.includes("@") ? s : `${normalizeUsername(s)}@${USERNAME_DOMAIN}`;
}

/** Mapping pesan error Supabase jadi human friendly */
function mapSupabaseError(error) {
  if (!error) return null;
  const msg = String(error.message || error.error_description || error.toString());
  if (/(duplicate key|unique constraint|Already registered)/i.test(msg)) return "Username sudah dipakai.";
  if (/invalid login credentials/i.test(msg)) return "Username/Password salah.";
  if (/email not confirmed/i.test(msg)) return "Email belum dikonfirmasi.";
  return msg;
}

/* ==================== Auth APIs ==================== */

/**
 * Register (username-only atau email). 
 * CATATAN:
 * - Jika Email Confirmations OFF di Dashboard, signUp mengembalikan `session`
 *   sehingga user langsung login.
 * - Kalau ON, tidak ada session; pembuatan baris `profiles` ditangani oleh
 *   trigger SQL `handle_new_user` (lihat skrip SQL yang sudah dikirim).
 */
export async function signUpUsername({ username, password, fullName }) {
  const uname = normalizeUsername(username);
  if (!validateUsername(uname)) {
    return { data: null, error: new Error("Username harus 3–30, hanya huruf/angka/._-") };
  }

  const email = loginIdToEmail(uname);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName || uname,
        login_id: uname,
      },
      // redirectTo: window.location.origin, // opsional jika pakai email confirm
    },
  });

  if (error) return { data: null, error: new Error(mapSupabaseError(error)) };

  // ⬇️ PATCH: Upsert profile dari client HANYA kalau ada session (email confirm OFF).
  // Jika tidak ada session, biarkan trigger SQL yang memasukkan ke `public.profiles`.
  if (data?.session && data?.user?.id) {
    const { error: perr } = await supabase
      .from("profiles")
      .upsert(
        { id: data.user.id, username: uname, display_name: fullName || uname },
        { onConflict: "id" }
      );
    if (perr) return { data, error: new Error(mapSupabaseError(perr)) };
  }

  return { data, error: null };
}

/** Login pakai username ATAU email + password */
export async function signInUsername({ login, password }) {
  const email = loginIdToEmail(login);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { data: null, error: new Error(mapSupabaseError(error)) } : { data, error: null };
}

/** OAuth Google */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin, // atau origin + '/auth/callback' jika perlu
    },
  });
  return error ? { data: null, error: new Error(mapSupabaseError(error)) } : { data, error: null };
}

/** Logout */
export async function signOut() {
  await supabase.auth.signOut();
}

/** Ambil user aktif (dari session) */
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

/**
 * Pastikan baris profile ada setelah login (terutama OAuth).
 * Aman dipanggil kapan saja; jika sudah ada, tidak apa-apa.
 */
export async function ensureProfileFromSession() {
  const user = await getUser();
  if (!user?.id) return;

  // sudah ada?
  const { data: p, error: gerr } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (gerr) return; // diamkan; tidak memblokir UI

  if (!p) {
    const local = (user.email || "").split("@")[0] || "user";
    const uname = (normalizeUsername(user.user_metadata?.login_id || local).slice(0, 30)) || `user_${user.id.slice(0, 6)}`;
    await supabase.from("profiles").insert({
      id: user.id,
      username: uname,
      display_name: user.user_metadata?.full_name || user.user_metadata?.name || uname,
    });
  }
}
