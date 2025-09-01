// src/pages/ResetPassword.jsx
import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

export default function ResetPassword() {
  const nav = useNavigate();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Saat user buka link dari email, Supabase otomatis membuat session di halaman redirect.
    // Kita tunggu session lalu tampilkan form.
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setMsg("");
    try {
      if (pw1.length < 8) throw new Error("Minimal 8 karakter.");
      if (pw1 !== pw2) throw new Error("Konfirmasi tidak cocok.");
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;
      setMsg("Password berhasil diubah. Mengalihkan ke Dashboard…");
      setTimeout(() => nav("/dashboard", { replace: true }), 1000);
    } catch (err) {
      setMsg(err.message || "Gagal menyimpan password.");
    }
  }

  if (!ready) return (
    <div className="min-h-screen grid place-items-center bg-zinc-900 text-stone-200">
      <div>Menyiapkan sesi reset…</div>
    </div>
  );

  return (
    <div className="min-h-screen grid place-items-center bg-zinc-900 text-stone-200 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md p-6 bg-zinc-800/60 border border-zinc-700 rounded-2xl">
        <h1 className="text-xl font-bold text-amber-300 mb-3">Set Password Baru</h1>
        <input className="w-full mb-2 px-3 py-2 rounded bg-zinc-900 border border-zinc-700" type="password" placeholder="Password baru" value={pw1} onChange={(e)=>setPw1(e.target.value)} />
        <input className="w-full mb-3 px-3 py-2 rounded bg-zinc-900 border border-zinc-700" type="password" placeholder="Ulangi password baru" value={pw2} onChange={(e)=>setPw2(e.target.value)} />
        <button className="w-full py-2 rounded bg-red-700 hover:bg-red-600 font-bold">Simpan</button>
        {msg && <div className="mt-2 text-sm">{msg}</div>}
      </form>
    </div>
  );
}
