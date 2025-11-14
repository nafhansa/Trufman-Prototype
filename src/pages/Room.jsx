import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { getUser } from "../lib/supabaseClient";
import {
  fetchSeats, claimSeat, releaseSeat, fetchState, subscribeRoom,
  startGame, endGame,
  addBotToSeat, removeBotByUserId, isBotUserId, isBotRow,
  updateRoomOptions,
} from "../lib/rooms";

const SeatName = ["P1", "P2", "P3", "P4"];

function displayNameFromUser(u) {
  return (
    u?.user_metadata?.full_name ||
    u?.user_metadata?.name ||
    u?.email?.split("@")[0] ||
    "Player"
  );
}

async function copyText(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  return ok;
}

export default function Room() {
  const { id: roomId } = useParams();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  async function onCopyId() {
    const ok = await copyText(String(roomId));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      alert(`Gagal menyalin. Room ID:\n${roomId}`);
    }
  }

  const [seats, setSeats]   = useState([]);
  const [state, setState]   = useState(null); // row room_state
  const [online, setOnline] = useState([]);
  const [me, setMe]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");

  const [savingOpt, setSavingOpt] = useState(false);
  const requireTrumpBroken = !!state?.require_trump_broken;
  const isWaiting = state?.status === "waiting";

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

  // redirect ke play saat status berubah
  useEffect(() => {
    if (state?.status === "playing") {
      navigate(`/play/${roomId}`, { replace: true });
    }
  }, [state?.status, roomId, navigate]);

  async function onClaim(i) {
    try { 
      setErr("");
      await claimSeat(roomId, i); 
    }
    catch (e) { 
      setErr(e.message || "Gagal claim kursi");
      alert(e.message || "Gagal claim kursi (mungkin sudah terisi)"); 
    }
  }
  async function onRelease(i) {
    try { 
      setErr("");
      await releaseSeat(roomId, i); 
    }
    catch (e) { 
      setErr(e.message || "Gagal release kursi");
      alert(e.message || "Gagal release kursi"); 
    }
  }

  async function onAddBot(i) {
    try { 
      setErr("");
      await addBotToSeat(roomId, i); 
    }
    catch (e) { 
      setErr(e.message || "Gagal add bot");
      alert(e.message || "Gagal add bot"); 
    }
  }
  async function onRemoveBot(userId) {
    try { 
      setErr("");
      await removeBotByUserId(roomId, userId); 
    }
    catch (e) { 
      setErr(e.message || "Gagal remove bot");
      alert(e.message || "Gagal remove bot"); 
    }
  }

  const takenBy   = (i) => seats.find((s) => s.seat === i);
  const isTaken   = (i) => !!takenBy(i);
  const isHost    = me?.id && state?.created_by === me.id;

  const canStart  = isHost && isWaiting && seats.length === 4;

  const handleStart = async () => {
    try {
      setErr("");
      if (!canStart) {
        alert("Butuh 4 pemain untuk memulai game");
        return;
      }
      await startGame(roomId);
      // Redirect akan otomatis terjadi karena useEffect yang memantau state.status
    } catch (e) {
      setErr(e.message || "Gagal memulai game");
      alert(e.message || "Gagal memulai game");
    }
  };

  async function onToggleRule() {
    if (!isHost) return;
    try {
      setErr("");
      setSavingOpt(true);
      await updateRoomOptions(roomId, { requireTrumpBroken: !requireTrumpBroken });
      const st = await fetchState(roomId);
      setState(st);
    } catch (e) {
      setErr(e.message || "Gagal menyimpan opsi");
      alert(e.message || "Gagal menyimpan opsi");
    } finally {
      setSavingOpt(false);
    }
  }

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

        <div className="flex items-center gap-2 text-sm text-stone-300">
          <span>Room ID: <code>{roomId}</code></span>
          <button
            onClick={onCopyId}
            className="px-2 py-1 rounded-md bg-zinc-700 hover:bg-zinc-600 text-stone-100 border border-zinc-600"
            title="Copy Room ID"
            >
            {copied ? "Copied!" : "Copy ID"}
          </button>
        </div>

        {err && <div className="mt-3 text-sm text-red-400">{err}</div>}
        {loading ? (
          <div className="mt-6 text-sm opacity-70">Loading…</div>
        ) : (
          <>
            {/* Seats */}
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

            {/* Room options */}
            <div className="mt-6 p-4 rounded-xl border border-zinc-700 bg-zinc-800/60">
              <div className="font-semibold mb-2">Aturan</div>

              <div className="flex items-start justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium">Perlu Truf Broken?</div>
                  <div className="text-stone-300">
                    Jika aktif, pemain <em>tidak boleh</em> lead truf di awal trik
                    sebelum ada yang motong (atau kartu pemain itu tinggal truf semua).
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs">{requireTrumpBroken ? "Aktif" : "Nonaktif"}</span>
                  <button
                    onClick={onToggleRule}
                    disabled={!isHost || !isWaiting || savingOpt}
                    className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800"
                    title={!isHost ? "Hanya host" : (!isWaiting ? "Ubah saat waiting" : "Toggle")}
                  >
                    {savingOpt ? "Menyimpan..." : "Toggle"}
                  </button>
                </div>
              </div>

              <div className="text-xs text-stone-400 mt-2">
                * Perubahan berlaku untuk ronde berikutnya.
              </div>
            </div>

            {/* Debug state */}
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
