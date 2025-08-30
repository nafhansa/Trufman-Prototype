// Helpers & wrapper untuk autentikasi (username OR email) + Google OAuth.
import { supabase } from "./supabaseClient";

export const USERNAME_DOMAIN = "user.trufman.local"; // domain fiktif untuk username-only

export function loginIdToEmail(id) {
  if (!id) return "";
  const s = String(id).trim();
  return s.includes("@") ? s : `${s}@${USERNAME_DOMAIN}`;
}

export async function signUpUsername({ username, password, fullName }) {
  const email = loginIdToEmail(username);
  // Note: kalau "Confirm email" di Supabase ON, signUp akan kirim verifikasi
  // ke email sintetis—jadi nyalakan auto-confirm atau pakai email asli.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName || username,
        login_id: username,
      },
    },
  });
  return { data, error };
}

export async function signInUsername({ login, password }) {
  const email = loginIdToEmail(login);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  return { data, error };
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  return { data, error };
}

export async function signOut() {
  await supabase.auth.signOut();
}
