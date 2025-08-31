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

  // password
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState("");

  const providers = useMemo(() => user?.identities?.map(i => i.provider) || [], [user]);

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
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setPwMsg("Password diubah ✔");
      setNewPw(""); setNewPw2("");
    } catch (e) {
      setPwMsg(e.message || "Gagal mengubah password.");
    } finally {
      setSavingPw(false);
      setTimeout(() => setPwMsg(""), 2500);
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

          <section className="bg-zinc-800 rounded-xl shadow p-4 border border-zinc-700">
            <h2 className="font-semibold text-stone-100 mb-2">Ganti Password</h2>
            <p className="text-xs text-stone-400 mb-3">
              {providers.includes("google")
                ? "Akunmu terhubung Google. Password opsional (hanya jika ingin juga login email/password)."
                : "Ubah password untuk login email/password."}
            </p>

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

            <div className="flex items-center justify-between gap-2">
              <button
                onClick={savePassword}
                disabled={savingPw}
                className="px-4 py-2 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-stone-100 font-bold disabled:opacity-50"
              >
                {savingPw ? "Menyimpan..." : "Simpan Password"}
              </button>
              {pwMsg && <div className="text-sm">{pwMsg}</div>}
            </div>
          </section>
        </div>

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
    </div>
  );
}
