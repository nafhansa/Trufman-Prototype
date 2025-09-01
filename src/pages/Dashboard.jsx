// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

function Badge({ children }) {
  return (
    <span className="inline-flex items-center rounded-md bg-zinc-700 text-stone-200 px-2 py-0.5 text-xs shadow-sm">
      {children}
    </span>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // profile
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  // password (ubah)
  const [currentPw, setCurrentPw] = useState(""); // password lama (hanya untuk email/password)
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  // change email
  const [newEmail, setNewEmail] = useState("");
  const [emailPw, setEmailPw] = useState(""); // konfirmasi password saat ganti email (untuk email/password)
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return nav("/", { replace: true });
      if (!alive) return;
      setUser(user);

      const { data: prof } = await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("id", user.id)
        .maybeSingle();

      setUsername(prof?.username || "");
      setDisplayName(prof?.display_name || "");
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [nav]);

  const providers = useMemo(
    () => user?.identities?.map(i => i.provider) || [],
    [user]
  );
  const usesEmailPassword = providers.includes("email");

  // --- notifikasi & state kirim reset
  const [sendingReset, setSendingReset] = useState(false);
  const [toast, setToast] = useState({ show: false, type: "success", text: "" });
  const notify = (type, text) => {
    setToast({ show: true, type, text });
    setTimeout(() => setToast(s => ({ ...s, show: false })), 4000);
  };
  const maskEmail = (e) => {
    if (!e) return "";
    const [u, d] = e.split("@");
    return (u?.slice(0, 2) || "") + "****@" + d;
  };

  async function saveProfile() {
    setProfileMsg("");
    const uname = username.trim().toLowerCase();
    const dname = displayName.trim();

    if (!/^[a-z0-9_]{3,20}$/.test(uname)) {
      setProfileMsg("Username harus 3–20 karakter (huruf/angka/underscore).");
      return;
    }

    setSavingProfile(true);
    try {
      const { data: cur } = await supabase
        .from("profiles").select("username").eq("id", user.id).maybeSingle();

      if (!cur || cur.username.toLowerCase() !== uname) {
        const { data: exists } = await supabase
          .from("profiles").select("id").ilike("username", uname).maybeSingle();
        if (exists) throw new Error("Username sudah dipakai.");
      }

      const { error } = await supabase
        .from("profiles")
        .update({ username: uname, display_name: dname })
        .eq("id", user.id);
      if (error) throw error;

      setProfileMsg("Profil tersimpan ✔");
    } catch (e) {
      setProfileMsg(e.message || "Gagal menyimpan profil.");
    } finally {
      setSavingProfile(false);
      setTimeout(() => setProfileMsg(""), 2000);
    }
  }

  async function savePassword() {
    setPwMsg("");
    if (newPw.length < 8) return setPwMsg("Password minimal 8 karakter.");
    if (newPw !== newPw2) return setPwMsg("Konfirmasi password tidak cocok.");

    setSavingPw(true);
    try {
      const { data: { user: curUser } } = await supabase.auth.getUser();
      if (!curUser) throw new Error("Belum login.");

      // wajib re-auth kalau akun email/password
      if (usesEmailPassword) {
        if (!currentPw) throw new Error("Masukkan password lama.");
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email: curUser.email,
          password: currentPw,
        });
        if (signErr) throw new Error("Password lama salah.");
      }

      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;

      setPwMsg("Password diubah ✔");
      setCurrentPw(""); setNewPw(""); setNewPw2("");
    } catch (e) {
      setPwMsg(e.message || "Gagal mengubah password.");
    } finally {
      setSavingPw(false);
      setTimeout(() => setPwMsg(""), 2500);
    }
  }

  async function sendResetLink() {
    setPwMsg("");
    setSendingReset(true);
    try {
      const { data: { user: curUser } } = await supabase.auth.getUser();
      if (!curUser?.email) throw new Error("Email akun tidak ditemukan.");
      const { error } = await supabase.auth.resetPasswordForEmail(curUser.email, {
        redirectTo: `${location.origin}/reset-password`
      });
      if (error) throw error;
      const ok = `Link reset dikirim ke ${maskEmail(curUser.email)}. Cek inbox/spam lalu klik tautannya.`;
      setPwMsg(ok);
      notify("success", ok);
    } catch (e) {
      const msg = e?.message?.includes("rate")
        ? "Terlalu sering mengirim. Coba lagi beberapa menit."
        : (e.message || "Gagal mengirim link reset.");
      setPwMsg(msg);
      notify("error", msg);
    } finally {
      setSendingReset(false);
      setTimeout(() => setPwMsg(""), 4000);
    }
  }

  async function changeEmail() {
    setEmailMsg("");
    const e = newEmail.trim().toLowerCase();
    if (!e || !e.includes("@")) return setEmailMsg("Masukkan email baru yang valid.");
    if (e === (user.email || "").toLowerCase())
      return setEmailMsg("Email baru sama dengan email sekarang.");

    setSavingEmail(true);
    try {
      const { data: { user: curUser } } = await supabase.auth.getUser();
      if (!curUser) throw new Error("Belum login.");

      if (usesEmailPassword) {
        if (!emailPw) throw new Error("Masukkan password akun untuk konfirmasi.");
        const { error: signErr } = await supabase.auth.signInWithPassword({
          email: curUser.email,
          password: emailPw,
        });
        if (signErr) throw new Error("Password salah.");
      }

      // Kirim link verifikasi ke email baru; email akan berpindah setelah dikonfirmasi.
      const { error } = await supabase.auth.updateUser({ email: e });
      if (error) throw error;

      setEmailMsg("Link verifikasi sudah dikirim ke email baru. Selesaikan lewat email untuk mengganti.");
      setNewEmail(""); setEmailPw("");
    } catch (err) {
      setEmailMsg(err.message || "Gagal mengganti email.");
    } finally {
      setSavingEmail(false);
      setTimeout(() => setEmailMsg(""), 6000);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen w-screen bg-zinc-900 text-stone-200 grid place-items-center">
        <div className="text-stone-400">Memuat…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-screen bg-zinc-900 text-stone-200">
      <div className="mx-auto w-full max-w-[900px] px-4 py-4">
        <header className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-stone-300 text-sm underline">← Lobby</Link>
            <h1 className="text-2xl font-extrabold text-amber-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.7)]">Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge>User: <span className="tabular-nums ml-1">{user.id.slice(0,8)}…</span></Badge>
            <Badge>Provider: {providers.length ? providers.join(", ") : "email"}</Badge>
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-4">
          {/* =================== Profil =================== */}
          <section className="bg-zinc-800 rounded-xl shadow p-4 border border-zinc-700">
            <h2 className="font-semibold text-stone-100 mb-2">Profil</h2>

            <label className="text-sm block mb-1 text-stone-300">Username</label>
            <input
              className="w-full mb-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-stone-100"
              value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="mis. trufmaster"
            />

            <label className="text-sm block mb-1 text-stone-300">Display name</label>
            <input
              className="w-full mb-3 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-stone-100"
              value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Nama panggilan (opsional)"
            />

            <div className="flex items-center justify-between gap-2">
              <button
                onClick={saveProfile}
                disabled={savingProfile}
                className="px-4 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold disabled:opacity-50"
              >
                {savingProfile ? "Menyimpan..." : "Simpan Profil"}
              </button>
              {profileMsg && <div className="text-sm">{profileMsg}</div>}
            </div>
          </section>

          {/* =================== Ganti Password =================== */}
          <section className="bg-zinc-800 rounded-xl shadow p-4 border border-zinc-700">
            <h2 className="font-semibold text-stone-100 mb-2">Ganti Password</h2>
            <p className="text-xs text-stone-400 mb-3">
              {usesEmailPassword
                ? "Wajib isi password lama sebelum mengganti."
                : "Akun OAuth/guest tidak punya password lama. Jika ingin menambahkan password, kirim tautan reset di bawah."}
            </p>

            {usesEmailPassword && (
              <>
                <label className="text-sm block mb-1 text-stone-300">Password Lama</label>
                <input
                  type="password"
                  className="w-full mb-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-stone-100"
                  value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="••••••••"
                />
              </>
            )}

            <label className="text-sm block mb-1 text-stone-300">Password Baru</label>
            <input
              type="password"
              className="w-full mb-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-stone-100"
              value={newPw} onChange={(e) => setNewPw(e.target.value)}
              placeholder="min. 8 karakter"
            />

            <label className="text-sm block mb-1 text-stone-300">Ulangi Password Baru</label>
            <input
              type="password"
              className="w-full mb-3 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-stone-100"
              value={newPw2} onChange={(e) => setNewPw2(e.target.value)}
              placeholder="ketik ulang"
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={savePassword}
                  disabled={savingPw}
                  className="px-4 py-2 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-stone-100 font-bold disabled:opacity-50"
                >
                  {savingPw ? "Menyimpan..." : "Simpan Password"}
                </button>
                {usesEmailPassword && (
                  <button
                    type="button"
                    onClick={sendResetLink}
                    disabled={sendingReset}
                    className={`px-3 py-2 rounded-xl font-semibold text-stone-900
                      ${sendingReset ? "bg-amber-600/70 cursor-not-allowed" : "bg-amber-600 hover:bg-amber-500"}`}
                    title="Kirim tautan reset ke email akun"
                  >
                    {sendingReset ? "Mengirim..." : "Lupa password?"}
                  </button>
                )}
              </div>
              {pwMsg && <div className="text-sm">{pwMsg}</div>}
            </div>

            {/* Lupa Password (untuk user tanpa email/password) */}
            {!usesEmailPassword && (
              <div className="mt-4 border-t border-zinc-700 pt-3">
                <h3 className="font-semibold mb-2">Lupa Password</h3>
                <p className="text-xs text-stone-400 mb-3">
                  Kirim tautan reset ke email akun ini. Setelah set password, kamu juga bisa login pakai email+password.
                </p>
                <button
                  type="button"
                  onClick={sendResetLink}
                  disabled={sendingReset}
                  className={`px-3 py-2 rounded-xl font-semibold text-stone-900
                    ${sendingReset ? "bg-amber-600/70 cursor-not-allowed" : "bg-amber-600 hover:bg-amber-500"}`}
                  title="Kirim tautan reset ke email akun"
                >
                  {sendingReset ? "Mengirim..." : "Kirim Link Reset Password"}
                </button>
                {pwMsg && <div className="mt-2 text-sm">{pwMsg}</div>}
              </div>
            )}
          </section>
        </div>

        {/* =================== Ganti Email =================== */}
        {user.email && (
          <section className="mt-4 bg-zinc-800 rounded-xl shadow p-4 border border-zinc-700">
            <h2 className="font-semibold text-stone-100 mb-2">Ganti Email</h2>
            <div className="text-sm text-stone-400 mb-3">
              Email saat ini: <span className="text-stone-200">{user.email}</span><br/>
              {usesEmailPassword
                ? "Demi keamanan, masukkan password akun saat ini untuk konfirmasi."
                : "Akun OAuth tidak perlu password. Kami akan kirim link verifikasi ke email baru."}
            </div>

            {usesEmailPassword && (
              <>
                <label className="text-sm block mb-1 text-stone-300">Password Akun</label>
                <input
                  type="password"
                  className="w-full mb-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-stone-100"
                  value={emailPw} onChange={(e)=>setEmailPw(e.target.value)}
                  placeholder="••••••••"
                />
              </>
            )}

            <label className="text-sm block mb-1 text-stone-300">Email Baru</label>
            <input
              type="email"
              className="w-full mb-3 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-stone-100"
              value={newEmail} onChange={(e)=>setNewEmail(e.target.value)}
              placeholder="email-baru@contoh.com"
            />

            <div className="flex items-center justify-between gap-2">
              <button
                onClick={changeEmail}
                disabled={savingEmail}
                className="px-4 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold disabled:opacity-50"
              >
                {savingEmail ? "Mengirim..." : "Kirim Link Ganti Email"}
              </button>
              {emailMsg && <div className="text-sm">{emailMsg}</div>}
            </div>
          </section>
        )}

        {/* =================== Info akun =================== */}
        <section className="mt-4 bg-zinc-800 rounded-xl shadow p-4 border border-zinc-700">
          <h2 className="font-semibold text-stone-100 mb-2">Info Akun</h2>
          <div className="text-sm text-stone-300 space-y-1">
            <div>Email: <span className="text-stone-100">{user.email || "—"}</span></div>
            <div>Dibuat: <span className="text-stone-100">{new Date(user.created_at).toLocaleString()}</span></div>
            {user.last_sign_in_at && (
              <div>Login terakhir: <span className="text-stone-100">{new Date(user.last_sign_in_at).toLocaleString()}</span></div>
            )}
          </div>
        </section>
      </div>

      {/* Toast */}
      {toast.show && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg border text-sm
           ${toast.type === "success"
             ? "bg-emerald-600/90 border-emerald-500 text-white"
             : "bg-red-600/90 border-red-500 text-white"}`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
