import React, { useState } from "react";
import {
  signInUsername,
  signUpUsername,
  signInWithGoogle,
} from "../lib/auth";
import { supabase } from "../lib/supabaseClient";

export default function SignIn() {
  const [tab, setTab] = useState("login"); // 'login' | 'register'
  const [login, setLogin] = useState(""); // username ATAU email
  const [regUser, setRegUser] = useState("");
  const [regPass, setRegPass] = useState("");
  const [regName, setRegName] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function doLogin(e) {
    e?.preventDefault();
    setBusy(true); setErr("");
    const { error } = await signInUsername({ login, password: pass });
    if (error) setErr(error.message);
    setBusy(false);
  }

  async function doRegister(e) {
    e?.preventDefault();
    if (!regUser || !regPass) {
      setErr("Username dan password wajib diisi");
      return;
    }
    setBusy(true); setErr("");
    const { error } = await signUpUsername({
      username: regUser,
      password: regPass,
      fullName: regName || regUser,
    });
    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }
    // Auto-login setelah sign up
    const { error: e2 } = await signInUsername({
      login: regUser,
      password: regPass,
    });
    if (e2) setErr(e2.message);
    setBusy(false);
  }

  async function doGoogle() {
    setErr("");
    const { error } = await signInWithGoogle();
    if (error) setErr(error.message);
  }

  return (
    <div className="min-h-[60vh] max-w-md mx-auto bg-zinc-900/70 border border-zinc-800 rounded-2xl p-5 text-stone-100">
      <h2 className="text-2xl font-bold mb-3 text-center">Masuk ke Trufman</h2>

      {/* Tabs */}
      <div className="grid grid-cols-2 mb-4 rounded-lg overflow-hidden border border-zinc-700">
        <button
          className={`py-2 text-sm font-semibold ${tab==="login" ? "bg-zinc-800" : "bg-zinc-900 hover:bg-zinc-800/70"}`}
          onClick={() => setTab("login")}
        >
          Login
        </button>
        <button
          className={`py-2 text-sm font-semibold ${tab==="register" ? "bg-zinc-800" : "bg-zinc-900 hover:bg-zinc-800/70"}`}
          onClick={() => setTab("register")}
        >
          Register
        </button>
      </div>

      {tab === "login" ? (
        <form onSubmit={doLogin} className="space-y-3">
          <div>
            <label className="text-sm">Username atau Email</label>
            <input
              className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 outline-none focus:ring-2 focus:ring-red-500"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="contoh: renjana atau renjana@mail.com"
            />
          </div>
          <div>
            <label className="text-sm">Password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 outline-none focus:ring-2 focus:ring-red-500"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full mt-1 rounded-lg bg-red-700 hover:bg-red-600 disabled:bg-zinc-700 px-4 py-2 font-semibold"
          >
            {busy ? "Memproses..." : "Login"}
          </button>
        </form>
      ) : (
        <form onSubmit={doRegister} className="space-y-3">
          <div>
            <label className="text-sm">Username (atau Email)</label>
            <input
              className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 outline-none focus:ring-2 focus:ring-red-500"
              value={regUser}
              onChange={(e) => setRegUser(e.target.value)}
              placeholder="ex. renjana"
            />
          </div>
          <div>
            <label className="text-sm">Nama Tampilan (opsional)</label>
            <input
              className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 outline-none focus:ring-2 focus:ring-red-500"
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
              placeholder="Nama yang tampil di game"
            />
          </div>
          <div>
            <label className="text-sm">Password</label>
            <input
              type="password"
              className="mt-1 w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 outline-none focus:ring-2 focus:ring-red-500"
              value={regPass}
              onChange={(e) => setRegPass(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          {err && <p className="text-red-400 text-sm">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full mt-1 rounded-lg bg-red-700 hover:bg-red-600 disabled:bg-zinc-700 px-4 py-2 font-semibold"
          >
            {busy ? "Memproses..." : "Buat Akun & Login"}
          </button>
        </form>
      )}

      <div className="my-5 flex items-center gap-3 text-stone-400">
        <div className="h-px bg-zinc-700 flex-1" />
        <span className="text-xs">atau</span>
        <div className="h-px bg-zinc-700 flex-1" />
      </div>

      <button
        onClick={doGoogle}
        className="w-full rounded-lg bg-white text-zinc-900 hover:bg-zinc-100 px-4 py-2 font-semibold"
      >
        Lanjut dengan Google
      </button>
    </div>
  );
}
