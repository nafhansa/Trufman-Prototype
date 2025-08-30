import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom, joinByCode } from "../lib/rooms";

export default function Lobby() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onCreate() {
    try {
      setErr(""); setBusy(true);
      const roomId = await createRoom();
      nav(`/room/${roomId}`);
    } catch (e) {
      setErr(e.message || "Gagal membuat room");
    } finally {
      setBusy(false);
    }
  }

  async function onJoin(e) {
    e.preventDefault();
    try {
      setErr(""); setBusy(true);
      const roomId = await joinByCode(code.trim());
      nav(`/room/${roomId}`);
    } catch (e) {
      setErr(e.message || "Gagal join room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-zinc-900 text-stone-200 grid place-items-center px-4">
      <div className="w-full max-w-md bg-zinc-800/60 border border-zinc-700 rounded-2xl p-5 shadow">
        <h1 className="text-2xl font-extrabold text-amber-300 mb-4">Trufman — Lobby</h1>

        <button
          disabled={busy}
          onClick={onCreate}
          className="w-full px-4 py-3 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold"
        >
          {busy ? "Creating…" : "Create New Room"}
        </button>

        <div className="my-5 h-px bg-zinc-700" />

        <form onSubmit={onJoin} className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Room ID / prefix"
            className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-stone-200"
          />
          <button
            disabled={busy || !code.trim()}
            className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white"
          >
            Join
          </button>
        </form>

        {err && <div className="mt-3 text-sm text-red-400">{err}</div>}

        <p className="mt-4 text-xs opacity-60">
          Tips: setelah room dibuat, URL bisa dibagikan. Join juga bisa pakai prefix UUID (contoh 8–10 karakter pertama).
        </p>
      </div>
    </div>
  );
}
