import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function LogoutButton({ className = "" }) {
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function onLogout() {
    try {
      setBusy(true);
      await supabase.auth.signOut();
      nav("/", { replace: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onLogout}
      disabled={busy}
      className={
        "px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-700 text-stone-200 border border-zinc-600 hover:bg-zinc-600 disabled:opacity-50 " +
        className
      }
      title="Keluar"
    >
      {busy ? "Keluar..." : "Logout"}
    </button>
  );
}
