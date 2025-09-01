// src/pages/Room.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getUser } from "../lib/supabaseClient";
import {
  fetchSeats, claimSeat, releaseSeat, fetchState, subscribeRoom,
  startGame, endGame,
  addBotToSeat, removeBotByUserId, isBotUserId, isBotRow
} from "../lib/rooms"; // <-- pastikan impor dari lib/rooms

const SeatName = ["P1", "P2", "P3", "P4"];

function displayNameFromUser(u) {
  return (
    u?.user_metadata?.full_name ||
    u?.user_metadata?.name ||
    u?.email?.split("@")[0] ||
    "Player"
  );
}

export default function Room() {
  const { id: roomId } = useParams();
  const navigate = useNavigate();

  const [seats, setSeats]   = useState([]);
  const [state, setState]   = useState(null);
  const [online, setOnline] = useState([]);
  const [me, setMe]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");

  const mySeat = useMemo(
    () => seats.find(s => s.user_id === me?.id)?.seat ?? null,
    [seats, me]
  );

  // initial load + realtime
  useEffect(() => {
    let off = () => {};
    (async () => {
      try {
        setLoading(true);
        const u = await getUser();
        setMe(u);

        const [s, st] = await Promise.all([fetchSeats(roomId), fetchState(roomId)]);
        setSeats(s); setState(st);

        off = subscribeRoom(roomId, { onSeats: setSeats, onState: setState });
      } catch (e) {
        setErr(e.message || "Gagal memuat room");
      } finally {
        setLoading(false);
      }
    })();
    return () => off();
  }, [roomId]);

  // presence
  useEffect(() => {
    let ctrl;
    (async () => {
      const u = await getUser();
      const { joinRoomPresence } = await import("../lib/presence");
      ctrl = await joinRoomPresence(
        roomId,
        { display_name: displayNameFromUser(u), seat: null },
        setOnline
      );
    })();
    return () => ctrl?.leave?.();
  }, [roomId]);

  // redirect ke /play/:id ketika status berubah ke "playing"
  useEffect(() => {
    if (state?.status === "playing") {
      navigate(`/play/${roomId}`, { replace: true });
    }
  }, [state?.status, roomId, navigate]);

  async function onClaim(i) {
    try {
      await claimSeat(roomId, i);
    } catch (e) {
      alert(e.message || "Gagal claim kursi (mungkin sudah terisi)");
    }
  }
  async function onRelease(i) {
    try {
      await releaseSeat(roomId, i);
    } catch (e) {
      alert(e.message || "Gagal release kursi");
    }
  }

  async function onAddBot(i) {
    try { await addBotToSeat(roomId, i); }
    catch (e) { alert(e.message || "Gagal add bot"); }
  }
  async function onRemoveBot(userId) {
    try { await removeBotByUserId(roomId, userId); }
    catch (e) { alert(e.message || "Gagal remove bot"); }
  }

  const takenBy   = (i) => seats.find((s) => s.seat === i);
  const isTaken   = (i) => !!takenBy(i);
  const isWaiting = state?.status === "waiting";
  const isHost    = me?.id && state?.created_by === me.id;

  // hanya host yang bisa start; wajib 4 kursi terisi (termasuk bot)
  const canStart  = isHost && isWaiting && seats.length === 4;

  const handleStart = async () => {
    try {
      await startGame(roomId);
      navigate(`/play/${roomId}`);
    } catch (e) {
      alert(e.message || "Gagal memulai game");
    }
  };

  return (
    <div className="min-h-screen w-full bg-zinc-900 text-stone-200 px-4 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold text-amber-300">Room</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs opacity-70">
              Online: {online.length}
              {online.length > 0 && (
                <> — {online.map(o => o.display_name || "Player").join(", ")}</>
              )}
            </span>

            {/* Host controls */}
            {isHost && isWaiting && (
              <button
                onClick={handleStart}
                disabled={!canStart}
                className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:bg-zinc-700 text-sm"
                title={!canStart ? "Butuh 4 pemain & status waiting" : "Mulai game"}
              >
                Start Game
              </button>
            )}
            {isHost && state?.status === "playing" && (
              <button
                onClick={() => endGame(roomId)}
                className="px-3 py-1.5 rounded bg-rose-700 hover:bg-rose-600 text-sm"
              >
                End Game
              </button>
            )}

            <Link className="text-sm underline text-stone-300" to="/">← Lobby</Link>
          </div>
        </div>

        <div className="mt-1 text-xs opacity-70 break-all">
          Room ID: <code>{roomId}</code> • Status: <code>{state?.status || "-"}</code>
        </div>

        {err && <div className="mt-3 text-sm text-red-400">{err}</div>}
        {loading ? (
          <div className="mt-6 text-sm opacity-70">Loading…</div>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[0,1,2,3].map((i) => {
                const t = takenBy(i);
                const mine = t?.user_id === me?.id;
                const isBot = !!t && (isBotRow(t) || isBotUserId(t.user_id));
                return (
                  <div key={i} className="rounded-xl border border-zinc-700 bg-zinc-800/60 p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{SeatName[i]}</div>
                      {t ? (
                        <span className="text-xs bg-zinc-700 px-2 py-0.5 rounded">
                          {t.display_name}{isBot ? " (Bot)" : ""}{mine && " (you)"}
                        </span>
                      ) : (
                        <span className="text-xs opacity-60">Empty</span>
                      )}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => onClaim(i)}
                        disabled={isTaken(i) || !isWaiting}
                        className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 disabled:bg-zinc-700"
                      >
                        Claim
                      </button>
                      <button
                        onClick={() => onRelease(i)}
                        disabled={!mine || !isWaiting}
                        className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50"
                      >
                        Release
                      </button>

                      {/* Bot controls */}
                      {isHost && isWaiting && !t && (
                        <button
                          onClick={() => onAddBot(i)}
                          className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500"
                        >
                          Add Bot
                        </button>
                      )}
                      {isHost && isWaiting && isBot && (
                        <button
                          onClick={() => onRemoveBot(t.user_id)}
                          className="px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600"
                        >
                          Remove Bot
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 p-4 rounded-xl border border-zinc-700 bg-zinc-800/60">
              <div className="font-semibold mb-1">State</div>
              <pre className="text-xs overflow-auto">{JSON.stringify(state, null, 2)}</pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
