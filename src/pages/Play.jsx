/* eslint-disable react-hooks/exhaustive-deps */
import { maybeRunBots } from "../bots/learningBot";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase, getUser } from "../lib/supabaseClient";
import { fetchSeats, fetchState } from "../lib/rooms";
import { joinRoomPresence } from "../lib/presence";
import { createLearningBot, isBotUserId } from "../bots/learningBot";

/* ========================= Helpers & constants ========================= */

const SUITS = [
  { key: "C", label: "Clover", icon: "♣" },
  { key: "D", label: "Diamond", icon: "♦" },
  { key: "H", label: "Heart", icon: "♥" },
  { key: "S", label: "Spade", icon: "♠" },
];
const suitOrder = { C: 0, D: 1, H: 2, S: 3 };
const SeatName = ["P1", "P2", "P3", "P4"];
const MAX_ROUNDS = 4;

const rankLabel = (r) =>
  r <= 10 ? String(r) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" }[r]);
const betFromRank = (rank) =>
  rank === 14 ? 1 : rank >= 11 && rank <= 13 ? 0 : rank;
const suitIcon = (s) => SUITS.find((x) => x.key === s)?.icon || "?";

function cardFromId(id) {
  const s = id.slice(-1).toUpperCase();
  const rRaw = id.slice(0, -1).toUpperCase();
  const rank =
    rRaw === "A" ? 14 :
    rRaw === "K" ? 13 :
    rRaw === "Q" ? 12 :
    rRaw === "J" ? 11 :
    rRaw === "T" ? 10 :
    Number(rRaw);
  const suitIco = suitIcon(s);
  return { id, suit: s, rank, label: `${rankLabel(rank)}${suitIco}`, suitIcon: suitIco };
}

function makeDeck() {
  const ranks = [2,3,4,5,6,7,8,9,10,11,12,13,14];
  const suits = ["C","D","H","S"];
  const asId = (r,s) =>
    (r===14?"A":r===13?"K":r===12?"Q":r===11?"J":r===10?"T":String(r)) + s;
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push(asId(r,s));
  return deck;
}
function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ========================= Audio (match App.jsx, no trump-break) ========================= */
function playSound(src, vol = 1.0) {
  try {
    const a = new Audio(src);
    a.volume = Math.max(0, Math.min(1, vol));
    a.play().catch(() => {});
  } catch (_) {}
}
const MUSIC_URL =
  "https://github.com/nafhansa/Trufman-Prototype/releases/download/v1.0-assets/background-music.mp3";
const SFX_CARD_NORMAL =
  "https://github.com/nafhansa/Trufman-Prototype/releases/download/v1.0-assets/card-place-normal.wav";
const SFX_CARD_TRUMP =
  "https://github.com/nafhansa/Trufman-Prototype/releases/download/v1.0-assets/card-place-trump.wav";

function playCardPlace(isTrump) {
  playSound(isTrump ? SFX_CARD_TRUMP : SFX_CARD_NORMAL, 1.0);
}

/* ========================= UI atoms ========================= */

function Badge({ children }) {
  return (
    <span className="inline-flex items-center rounded-md bg-zinc-700 text-stone-200 px-2 py-0.5 text-xs shadow-sm">
      {children}
    </span>
  );
}

function SimpleCardBack({ small, vertical }) {
  const cls = `bg-red-600 rounded-lg border-2 border-red-300 shadow ${small ? "h-6 w-4" : "h-10 w-7"} ${vertical ? "" : ""}`;
  return <div className={cls} />;
}

function SimpleCardFace({ card }) {
  const red = card.suit === "H" || card.suit === "D";
  return (
    <div className="px-2 py-1 rounded-lg border bg-white font-mono text-sm shadow">
      <span className={red ? "text-rose-600" : "text-slate-800"}>{card.label}</span>
    </div>
  );
}

function CardFace({ card, onClick, disabled }) {
  const red = card.suit === "H" || card.suit === "D";
  const colorCls = red ? "is-red" : "is-black";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={card.label}
      className={`card-base animate-deal ${disabled ? "opacity-100 cursor-not-allowed" : "hover:-translate-y-2"}`}
    >
      <div className={`card-face ${colorCls}`}>
        <div className="card-label">{card.label}</div>
        <div className="card-label-rt">{card.label}</div>
        <div className="card-center-pip">{card.suitIcon}</div>
      </div>
    </button>
  );
}

function TableSlot({ play }) {
  return (
    <div className="h-20 w-28 bg-black/40 rounded-lg border-2 border-zinc-700/50 flex items-center justify-center shadow-inner">
      {play ? (play.hidden ? <SimpleCardBack small /> : <SimpleCardFace card={cardFromId(play.card)} />) : null}
    </div>
  );
}

function PlayerBidForm({ handBySuit, onSubmit, disabled }) {
  const [suit, setSuit] = useState("S");
  const ranks = handBySuit[suit] || [];
  const [rank, setRank] = useState(ranks[0] || 2);

  useEffect(() => {
    const r = handBySuit[suit] || [];
    if (!r.includes(rank)) setRank(r[0] || 2);
  }, [suit, handBySuit]);

  const canSubmit = !disabled && ranks.length > 0;

  return (
    <div className="flex items-center gap-2 text-sm">
      <select
        className="rounded-lg border border-zinc-600 px-2 py-1 bg-zinc-700 text-stone-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
        value={suit}
        onChange={(e) => setSuit(e.target.value)}
        disabled={disabled}
      >
        {SUITS.map((s) => (
          <option key={s.key} value={s.key}>{s.icon}</option>
        ))}
      </select>

      <select
        className="flex-1 rounded-lg border border-zinc-600 px-2 py-1 bg-zinc-700 text-stone-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
        value={rank}
        onChange={(e) => setRank(Number(e.target.value))}
        disabled={disabled || ranks.length === 0}
      >
        {ranks.length === 0 ? (
          <option>–</option>
        ) : (
          ranks.map((r) => (
            <option key={r} value={r}>{rankLabel(r)} ({betFromRank(r)})</option>
          ))
        )}
      </select>

      <button
        type="button"
        className="px-3 py-1 rounded-lg text-white font-semibold transition text-xs bg-red-700 hover:bg-red-600 disabled:bg-zinc-600 disabled:cursor-not-allowed"
        disabled={!canSubmit}
        onClick={() => onSubmit(suit, rank)}
      >
        Bet
      </button>
    </div>
  );
}

/* ========================= Page ========================= */

export default function Play() {
  const { id: roomId } = useParams();
  const navigate = useNavigate();

  const [online, setOnline] = useState([]);
  const [seats, setSeats] = useState([]); // [{seat, display_name, user_id}]
  const [roomInfo, setRoomInfo] = useState(null); // room_state

  const meRef = useRef(null);
  const [meId, setMeId] = useState(null);

  const [toast, setToast] = useState("");
  
  const [g, setG] = useState({
    adjustPending: false,
    adjustDecider: null,
    adjustChoice: null,
    round: 1,
    dealer: 0,
    phase: "bidding",
    currentPlayer: 0,
    leadSuit: null,
    trump: null,
    trumpBroken: false,
    mode: null,
    bids: [null, null, null, null],
    bidsRevealed: false,
    targets: [0, 0, 0, 0],
    table: [],
    tricksWon: [0, 0, 0, 0],
    scores: [0, 0, 0, 0],
    handSizes: [13, 13, 13, 13],
    myHand: [],
    // aturan dari room (default false, host siarkan saat ronde baru)
    requireTrumpBroken: false,
  });

  const chRef = useRef(null);
  const pgHandsRef = useRef(null);
  const timersRef = useRef(new Set());
  const [ready, setReady] = useState(false);

  // throttle handle: persist room_state
  const persistTimerRef = useRef(null);

  // ===== Background music & audio unlock =====
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const audioRef = useRef(null);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(MUSIC_URL);
      audioRef.current.loop = true;
      audioRef.current.volume = 0.3;
    }
  }, []);

  const toggleMusic = useCallback(() => {
    if (!audioRef.current) return;
    if (isMusicPlaying) audioRef.current.pause();
    else audioRef.current.play().catch(() => {});
    setIsMusicPlaying((v) => !v);
  }, [isMusicPlaying]);

  useEffect(() => {
    function unlockAudio() {
      try {
        const silent = new Audio();
        silent.muted = true;
        silent.play().catch(() => {});
      } catch (_) {}
      [SFX_CARD_NORMAL, SFX_CARD_TRUMP].forEach((src) => {
        try {
          const a = new Audio(src);
          a.volume = 0;
          a.play().then(() => a.pause()).catch(() => {});
        } catch (_) {}
      });
    }
    window.addEventListener("click", unlockAudio, { once: true });
    return () => window.removeEventListener("click", unlockAudio);
  }, []);

  const goBack = useCallback(
    (to = "/") => {
      try { if (chRef.current) supabase.removeChannel(chRef.current); } catch {}
      try { if (pgHandsRef.current) supabase.removeChannel(pgHandsRef.current); } catch {}
      try { supabase.getChannels().forEach((c) => supabase.removeChannel(c)); } catch {}
      try { for (const t of timersRef.current) clearTimeout(t); timersRef.current.clear(); } catch {}
      try { if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; } } catch {}
      navigate(to, { replace: true });
    },
    [navigate]
  );

  // initial data
  useEffect(() => {
    (async () => {
      const u = await getUser();
      meRef.current = u;
      setMeId(u?.id ?? null);

      const [seatsRows, st] = await Promise.all([
        fetchSeats(roomId),
        fetchState(roomId),
      ]);
      setSeats(seatsRows);
      setRoomInfo(st);
      setReady(true);

      if (u?.id) {
        const { data: myRows, error } = await supabase
          .from("hands")
          .select("card")
          .eq("room_id", roomId)
          .eq("owner", u.id);
        if (!error && Array.isArray(myRows)) {
          setG((o) => ({ ...o, myHand: (myRows || []).map((r) => cardFromId(r.card)) }));
        }
      }

      try {
        const { data: rs } = await supabase
          .from("room_states")
          .select("state_json")
          .eq("room_id", roomId)
          .maybeSingle();
        const s = rs?.state_json;
        if (s) {
          setG((old) => ({
            ...old,
            ...s,
            requireTrumpBroken: typeof s.requireTrumpBroken === "boolean"
              ? s.requireTrumpBroken
              : !!st?.require_trump_broken,
            myHand: old.myHand,
            table: (s.table || []).map((t) => ({ ...t })),
          }));
        }
      } catch {}
    })();

    return () => {
      try { if (chRef.current) supabase.removeChannel(chRef.current); } catch {}
      try { if (pgHandsRef.current) supabase.removeChannel(pgHandsRef.current); } catch {}
      try { supabase.getChannels().forEach((c) => supabase.removeChannel(c)); } catch {}
      try { for (const t of timersRef.current) clearTimeout(t); timersRef.current.clear(); } catch {}
      try { if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; } } catch {}
    };
  }, [roomId]);

  // presence
  useEffect(() => {
    let ctrl;
    (async () => {
      ctrl = await joinRoomPresence(roomId, { at: Date.now() }, setOnline);
    })();
    return () => ctrl?.leave?.();
  }, [roomId]);

  const isHost =
    !!roomInfo?.created_by && meRef.current?.id === roomInfo.created_by;

  const mySeat = useMemo(
    () => seats.find((s) => s.user_id === meId)?.seat ?? null,
    [seats, meId]
  );

  const absToRel = useCallback(
    (abs) => (mySeat == null ? abs : (abs - mySeat + 4) % 4),
    [mySeat]
  );
  const relToAbs = useCallback(
    (rel) => (mySeat == null ? rel : (mySeat + rel) % 4),
    [mySeat]
  );

  // realtime channel (broadcast)
  useEffect(() => {
    if (!ready) return;
    const ch = supabase.channel(`game:${roomId}`, {
      config: { broadcast: { self: true, ack: true } },
    });
    chRef.current = ch;

    ch.on("broadcast", { event: "state" }, ({ payload }) => {
      const s = payload || {};
      setG((old) => ({
        ...old,
        ...s,
        myHand: old.myHand,
        table: (s.table || []).map((t) => ({ ...t })),
      }));
    });

    ch.on("broadcast", { event: "hand" }, ({ payload }) => {
      const userId = payload?.to;
      const cards = Array.isArray(payload?.cards) ? payload.cards : payload;
      if (userId && userId !== meRef.current?.id) return;
      if (!Array.isArray(cards)) return;
      setG((o) => ({ ...o, myHand: cards.map(cardFromId) }));
    });

    ch.on("broadcast", { event: "toast" }, ({ payload }) => {
      if (!payload) return;
      if (payload.to && payload.to !== meRef.current?.id) return;
      setToast(String(payload.msg || payload));
      const t = setTimeout(() => setToast(""), 1500);
      timersRef.current.add(t);
    });

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.send({ type: "broadcast", event: "sync", payload: { hello: "sync" } });
      }});

    return () => {
      try { supabase.removeChannel(ch); } catch {}
    };
  }, [roomId, ready]);

  // Fallback polling ketika Realtime belum joined (mis. WS terblokir/putus)
  const isRealtimeJoined = useCallback(() => {
    try {
      const ch = chRef.current;
      if (!ch) return false;
      return ch.state === "joined" || (typeof ch.state === "function" && ch.state() === "joined");
    } catch { return false; }
  }, []);
  useEffect(() => {
    if (!roomId) return;
    let stopped = false;
    const iv = setInterval(async () => {
      if (stopped) return;
      if (isRealtimeJoined()) return;
      try {
        const { data, error } = await supabase
          .from("room_states")
          .select("state_json")
          .eq("room_id", roomId)
          .maybeSingle();
        if (!error && data?.state_json) {
          const s = data.state_json;
          setG((old) => ({
            ...old,
            ...s,
            myHand: old.myHand,
            table: (s.table || []).map((t) => ({ ...t })),
          }));
        }
      } catch {}
    }, 1000);
    return () => { stopped = true; clearInterval(iv); };
  }, [roomId, isRealtimeJoined]);

  // Postgres Changes: my hand
  useEffect(() => {
    if (!meRef.current?.id) return;
    const uid = meRef.current.id;
    const chan = supabase
      .channel(`room:${roomId}:hands:${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "hands",
          filter: `room_id=eq.${roomId} AND owner=eq.${uid}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const c = cardFromId(payload.new.card);
            setG((o) => ({ ...o, myHand: [...(o.myHand || []), c] }));
          } else if (payload.eventType === "DELETE") {
            const id = payload.old.card;
            setG((o) => ({ ...o, myHand: (o.myHand || []).filter((h) => h.id !== id) }));
          }
        }
      )
      .subscribe();

    pgHandsRef.current = chan;
    return () => {
      try { if (pgHandsRef.current) supabase.removeChannel(pgHandsRef.current); } catch {}
    };
  }, [roomId, meId]);

  // ====== SFX when a new card appears on table (no trump-break SFX) ======
  const firstTableHydrate = useRef(true);
  const lastTableCountRef = useRef(0);

  useEffect(() => {
    const count = g.table?.length ?? 0;

    if (firstTableHydrate.current) {
      firstTableHydrate.current = false;
      lastTableCountRef.current = count;
      return;
    }

    // kartu baru → bunyi (pilih trump vs normal)
    if (count > lastTableCountRef.current) {
      const last = g.table[count - 1];
      if (last?.card) {
        const suit = cardFromId(last.card).suit;
        const isTrump = g.trump && suit === g.trump;
        playCardPlace(!!isTrump);
      }
    }

    lastTableCountRef.current = count;
  }, [g.table, g.trump]);

  // Host Controller
  useHostController(isHost, roomId, seats, chRef, timersRef, roomInfo, persistTimerRef);

  // Derived — urutkan kartu tangan biar stabil di UI
  const myHandSorted = useMemo(() => {
    const h = (g.myHand || []).slice();
    h.sort((a, b) => {
      const s = (suitOrder[a.suit] ?? 0) - (suitOrder[b.suit] ?? 0);
      return s !== 0 ? s : (a.rank - b.rank);
    });
    return h;
  }, [g.myHand]);

  const handBySuit = useMemo(() => {
    const map = { C: [], D: [], H: [], S: [] };
    for (const c of g.myHand || []) map[c.suit].push(c.rank);
    for (const k of Object.keys(map))
      map[k] = Array.from(new Set(map[k])).sort((a, b) => a - b);
    return map;
  }, [g.myHand]);

  const allBidsIn = g.bids.every(Boolean);
  const sumBids = g.bids.reduce((a, b) => a + (b?.count || 0), 0);

  const leaderboard = useMemo(() => {
    return [0, 1, 2, 3]
      .map((i) => ({
        i,
        name: seats.find((s) => s.seat === i)?.display_name || SeatName[i],
        score: g.scores?.[i] ?? 0,
      }))
      .sort((a, b) => b.score - a.score);
  }, [seats, g.scores]);

  const oppCounts = useMemo(() => {
    if (mySeat == null) return [13, 13, 13];
    return [
      g.handSizes?.[(mySeat + 1) % 4] ?? 13,
      g.handSizes?.[(mySeat + 2) % 4] ?? 13,
      g.handSizes?.[(mySeat + 3) % 4] ?? 13,
    ];
  }, [g.handSizes, mySeat]);

  function submitBid(suit, rank) {
    if (mySeat == null) return;
    const bid = { count: betFromRank(rank), suit, rank, from: meRef.current?.id };
    chRef.current?.send({ type: "broadcast", event: "bid", payload: bid });
  }

  // Guard boleh main kartu
  const canPlayCard = useCallback(
    (c) => {
      if (g.phase !== "play" || mySeat == null) return false;
      if (g.currentPlayer !== mySeat) return false;

      const atStart = (g.table?.length ?? 0) === 0;

      // Awal trik
      if (atStart) {
        if (g.requireTrumpBroken && c.suit === g.trump && !g.trumpBroken) {
          const hasNonTrump = (g.myHand || []).some((h) => h.suit !== g.trump);
          if (hasNonTrump) return false;
        }
        return true;
      }

      // Bukan awal trik: default follow-suit wajib
      const hasLead = (g.myHand || []).some((h) => h.suit === g.leadSuit);
      if (hasLead && c.suit !== g.leadSuit) {
        // mode bebas: boleh menyimpang asal truf
        if (!g.requireTrumpBroken && c.suit === g.trump) return true;
        return false;
      }
      return true;
    },
    [
      g.phase, g.currentPlayer, g.table, g.leadSuit, g.myHand, mySeat,
      g.trump, g.trumpBroken, g.requireTrumpBroken
    ]
  );

  function playCard(card) {
    if (!canPlayCard(card)) return;
    chRef.current?.send({
      type: "broadcast",
      event: "play_card",
      payload: { from: meRef.current?.id, card: card.id },
    });
  }

  const targetOrDash = (absSeat) =>
    g.phase === "play" && g.targets[absSeat] !== undefined
      ? g.targets[absSeat] : "–";

  const relToName = (abs) =>
    seats.find((s) => s.seat === abs)?.display_name || SeatName[abs];

  const relName = (relIdx) => relToName(relToAbs(relIdx));
  const relTricks = (relIdx) => g.tricksWon[relToAbs(relIdx)] ?? 0;
  const relTarget = (relIdx) => targetOrDash(relToAbs(relIdx));

  const winner = g.phase === "ended" && leaderboard.length ? leaderboard[0] : null;

  // ===== Modal kondisi (hanya pemenang bidding saat total bet = 13 & belum reveal) =====
  const showAdjustModal =
    g.phase === "bidding" &&
    allBidsIn &&
    !g.bidsRevealed &&
    sumBids === 13 &&
    g.adjustPending &&
    mySeat === g.adjustDecider;

  return (
    <div className="min-h-screen w-screen bg-zinc-900 text-stone-800">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-4">
        <header className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button className="text-stone-300 text-sm underline" onClick={() => goBack(`/`)}>
              ← Lobby
            </button>
            <h1 className="text-3xl font-extrabold text-amber-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.7)]">
              Trufman
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleMusic}
              className="px-3 py-1.5 rounded-lg text-lg bg-red-900/50 text-stone-200 border border-red-500/30 hover:bg-red-900/80 transition"
              title={isMusicPlaying ? "Matikan musik" : "Nyalakan musik"}
            >
              {isMusicPlaying ? '🔇' : '🔊'}
            </button>
            <div className="text-stone-300 text-sm">
              Room: <span className="tabular-nums">{roomId.slice(0, 8)}</span> •
              Ronde: {g.round}/{MAX_ROUNDS} • Dealer: P{g.dealer + 1}
            </div>
            <div className="text-xs text-stone-300">
              Online: {online.length} — {online.map((o) => o.display_name || "Player").join(", ")}
            </div>
          </div>
        </header>

        {/* BOARD */}
        <div className="relative mx-auto w-full max-w-[1200px] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-800 to-red-950 rounded-2xl shadow-inner border-4 border-zinc-950 min-h-[560px] overflow-hidden">
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-stone-200 font-semibold drop-shadow">
            {relName(2)} • {relTricks(2)}/{relTarget(2)}
          </div>
          <div className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-stone-200 font-semibold drop-shadow">
            {relName(1)} • {relTricks(1)}/{relTarget(1)}
          </div>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-stone-200 font-semibold drop-shadow">
            {relName(3)} • {relTricks(3)}/{relTarget(3)}
          </div>

          {/* backs */}
          <div className="absolute top-10 left-1/2 -translate-x-1/2 flex gap-2">
            {Array.from({ length: oppCounts[1] }).map((_, i) => (<SimpleCardBack key={`t-${i}`} small />))}
          </div>
          <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {Array.from({ length: oppCounts[0] }).map((_, i) => (<SimpleCardBack key={`l-${i}`} vertical small />))}
          </div>
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {Array.from({ length: oppCounts[2] }).map((_, i) => (<SimpleCardBack key={`r-${i}`} vertical small />))}
          </div>

          {/* table slots */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-80 h-64">
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-auto">
                <TableSlot play={g.table.find((t) => absToRel(t.player) === 0)} />
              </div>
              <div className="absolute left-0 top-1/2 -translate-y-1/2 pointer-events-auto">
                <TableSlot play={g.table.find((t) => absToRel(t.player) === 1)} />
              </div>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-auto">
                <TableSlot play={g.table.find((t) => absToRel(t.player) === 2)} />
              </div>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-auto">
                <TableSlot play={g.table.find((t) => absToRel(t.player) === 3)} />
              </div>
            </div>
          </div>

          {/* my hand */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[95%] z-30">
            <div className="mb-2 text-center text-stone-200 font-semibold drop-shadow">
              {(mySeat != null ? seats.find((s) => s.seat === mySeat)?.display_name : "Kamu") || "Kamu"}
              {" • "}
              {mySeat != null ? g.tricksWon[mySeat] ?? 0 : 0}/{mySeat != null ? targetOrDash(mySeat) : "–"}
            </div>
            <div className="flex flex-wrap gap-2 items-center justify-center">
              {myHandSorted.map((c) => (
                <CardFace key={c.id} card={c} disabled={!canPlayCard(c)} onClick={() => playCard(c)} />
              ))}
            </div>
          </div>

          {/* toast */}
          {toast && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 text-stone-100 px-3 py-1 rounded pointer-events-none">
              {toast}
            </div>
          )}
        </div>

        {/* Info bar */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge>Fase: {g.phase}</Badge>
          <Badge>Giliran: P{(g.currentPlayer ?? 0) + 1}</Badge>
          <Badge>Lead: {g.leadSuit ? suitIcon(g.leadSuit) : "–"}</Badge>
          <Badge>Truf: {g.trump ? suitIcon(g.trump) : "–"}</Badge>
          <Badge>Truf Broken: {g.trumpBroken ? "Ya" : "Belum"}</Badge>
          <Badge>Mode: {g.mode || "–"}</Badge>
          <Badge>Aturan: {g.requireTrumpBroken ? "Butuh Broken" : "Bebas Ngetruf"}</Badge>
          <Badge>Total Bet: {g.bidsRevealed ? `${sumBids}/13` : "—/13"}</Badge>
        </div>

        {/* Bidding */}
        {g.phase === "bidding" && (
          <div className="mx-auto w-full max-w-[1200px] mt-3 grid md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((p) => {
              const bid = g.bids[p];
              const isYou = p === mySeat;
              const bidCard = bid ? {
                id: `BID${p}`, suit: bid.suit, rank: bid.rank,
                label: `${rankLabel(bid.rank)}${suitIcon(bid.suit)}`, suitIcon: suitIcon(bid.suit),
              } : null;
              return (
                <div key={p} className="bg-zinc-800 rounded-xl shadow p-3 text-stone-100">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">{relToName(p)} {isYou ? "(Kamu)" : ""}</div>
                    <Badge>Bid: {bid ? (g.bidsRevealed ? `${bid.count}${suitIcon(bid.suit)}` : "...") : "..."}</Badge>
                  </div>

                  {bid ? (
                    <div className="h-10 flex items-center">
                      {g.bidsRevealed ? <SimpleCardFace card={bidCard} /> : <SimpleCardBack small />}
                      <span className="ml-2 text-xs text-stone-400">
                        {g.bidsRevealed ? "Terbuka" : "Menunggu..."}
                      </span>
                    </div>
                  ) : isYou ? (
                    <PlayerBidForm handBySuit={handBySuit} onSubmit={submitBid} disabled={!!g.bids[mySeat ?? -1]} />
                  ) : (
                    <div className="text-stone-400 text-sm h-10 flex items-center">Menunggu...</div>
                  )}
                </div>
              );
            })}

            <div className="md:col-span-4 flex justify-end">
              <button
                className="px-4 py-2 rounded-xl text-white font-bold transition disabled:bg-zinc-600 bg-red-700 hover:bg-red-600"
                onClick={() => chRef.current?.send({ type: "broadcast", event: "start_play" })}
                disabled={!allBidsIn || g.adjustPending}
              >
                Mulai Main
              </button>
            </div>
          </div>
        )}

        {/* Skor */}
        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((p) => {
              const name = relToName(p);
              const isYou = seats.find((s) => s.seat === p)?.user_id === meId;
              return (
                <div key={p} className="bg-zinc-800 rounded-xl shadow p-3">
                  <div className="flex items-center justify-between text-stone-100">
                    <div className="font-semibold">{isYou ? "Skor Kamu" : `Skor ${name}`}</div>
                    <Badge>Total: {g.scores?.[p] ?? 0}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-stone-300 grid grid-cols-2 gap-1">
                    <div>Bid</div>
                    <div className="text-right">{g.bids[p] ? (g.bidsRevealed ? `${g.bids[p].count}${suitIcon(g.bids[p].suit)}` : "...") : "–"}</div>
                    <div>Target</div>
                    <div className="text-right">{g.targets[p] ?? "–"}</div>
                    <div>Trik</div>
                    <div className="text-right">{g.tricksWon[p] ?? 0}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bg-zinc-800 rounded-xl shadow p-3">
            <h3 className="font-semibold text-stone-100 mb-2">Leaderboard</h3>
            <ol className="space-y-1">
              {leaderboard.map((row, idx) => (
                <li key={row.i} className="flex items-center justify-between text-sm p-1 rounded-md bg-zinc-700/50">
                  <span className="flex items-center gap-2 text-stone-200">
                    <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full font-bold ${idx === 0 ? "bg-amber-400 text-zinc-900" : "bg-zinc-600"}`}>
                      {idx + 1}
                    </span>
                    <span>{row.name}</span>
                  </span>
                  <span className="font-semibold text-stone-100">{row.score} Poin</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Winner popup */}
      {winner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-[520px] max-w-[92vw] rounded-2xl bg-zinc-900 border border-zinc-700 p-6 shadow-2xl">
            <h2 className="text-2xl font-bold text-amber-300 mb-1">Permainan Selesai 🎉</h2>
            <p className="text-stone-200 mb-4">Pemenang: <strong>{winner.name}</strong></p>

            <div className="rounded-lg bg-zinc-800 p-3 mb-4">
              <h3 className="text-stone-200 font-semibold mb-2">Rekap Poin</h3>
              <ul className="space-y-1 text-stone-300">
                {[0, 1, 2, 3]
                  .map((i) => ({ i, name: relToName(i), score: g.scores?.[i] ?? 0 }))
                  .sort((a, b) => b.score - a.score)
                  .map((r, idx) => (
                    <li key={r.i} className="flex items-center justify-between bg-zinc-700/40 rounded-md px-2 py-1">
                      <span className="flex items-center gap-2">
                        <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-zinc-600 font-bold">{idx + 1}</span>
                        {r.name}
                      </span>
                      <span className="font-semibold">{r.score} pts</span>
                    </li>
                  ))}
              </ul>
            </div>

            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold" onClick={() => goBack(`/`)}>
                Kembali ke Lobby
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modal: Keputusan Pemenang Bidding (Total bet = 13) ===== */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
          <div className="w-[480px] max-w-[92vw] rounded-2xl bg-zinc-900 border border-zinc-700 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-amber-300 mb-2">
              Total Bet = 13
            </h2>
            <p className="text-stone-200 mb-4">
              Kamu pemenang bidding. Pilih penyesuaian target semua pemain:
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:bg-zinc-600"
                disabled={!g.adjustPending}
                onClick={() =>
                  chRef.current?.send({
                    type: "broadcast",
                    event: "adjust_choice",
                    payload: { from: meRef.current?.id, delta: +1 },
                  })
                }
              >
                Naik +1 (ATAS)
              </button>
              <button
                className="flex-1 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:bg-zinc-600"
                disabled={!g.adjustPending}
                onClick={() =>
                  chRef.current?.send({
                    type: "broadcast",
                    event: "adjust_choice",
                    payload: { from: meRef.current?.id, delta: -1 },
                  })
                }
              >
                Turun -1 (BAWAH)
              </button>
            </div>
            <p className="text-xs text-stone-400 mt-3">
              Setelah memilih, tombol “Mulai Main” akan aktif.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================= Host Controller hook ========================= */

function useHostController(isHost, roomId, seats, chRef, timersRef, roomInfo, persistTimerRef) {
  const hostState = useRef(null); // { publicState, hands: {0:[],1:[],2:[],3:[]} }
  const botsRef = useRef({});
  const lastNonceBySeatRef = useRef({});
  const seatsRef = useRef(seats);
  useEffect(() => { seatsRef.current = seats; }, [seats]);

  // ----- Hydration untuk refresh -----
  const buildHandsFromDB = async () => {
    const hands = { 0: [], 1: [], 2: [], 3: [] };
    try {
      const { data: rows } = await supabase
        .from("hands")
        .select("owner, card")
        .eq("room_id", roomId);
      rows?.forEach((r) => {
        const seat = seatsRef.current.find((s) => s.user_id === r.owner)?.seat;
        if (seat != null) hands[seat].push(r.card);
      });
    } catch {}
    return hands;
  };

  const hydrateHostFromDB = async () => {
    try {
      const { data: rs } = await supabase
        .from("room_states")
        .select("state_json")
        .eq("room_id", roomId)
        .maybeSingle();
      const saved = rs?.state_json;
      if (!saved) return false;
      const hands = await buildHandsFromDB();
      saved.handSizes = [0, 1, 2, 3].map((s) => hands[s].length);
      if (typeof saved.requireTrumpBroken === "undefined") {
        saved.requireTrumpBroken = !!(roomInfo?.require_trump_broken);
      }
      hostState.current = { publicState: saved, hands };
      return true;
    } catch {
      return false;
    }
  };

  const isSeatBot = (seat) => {
    const row = seatsRef.current.find((s) => s.seat === seat);
    return (
      !!row &&
      (row.is_bot || isBotUserId(row.user_id) || row.display_name?.startsWith?.("Bot "))
    );
  };
  const botDelay = (min = 250, max = 700) => Math.floor(min + Math.random() * (max - min));
  const schedule = (fn, ms = 400) => {
    const t = setTimeout(fn, ms);
    timersRef.current.add(t);
    return t;
  };

  const ensureBot = (seat) => {
    if (!botsRef.current[seat]) {
      botsRef.current[seat] = createLearningBot({
        seat,
        getState: () => ({ ...(hostState.current?.publicState || {}), SUITS }),
      });
    } else {
      botsRef.current[seat].setSeat(seat);
    }
    return botsRef.current[seat];
  };

  // ====== Handler pilihan penyesuaian (host only) ======
  const applyAdjustChoice = (fromUser, delta) => {
    if (!hostState.current) return;
    const st = hostState.current.publicState;
    if (!st.adjustPending) return;

    const seat = seatOf(fromUser);
    if (seat == null || seat !== st.adjustDecider) return; // hanya pemenang bidding yang boleh

    const bids = st.bids || [];
    const step = delta > 0 ? 1 : -1;
    st.targets = bids.map((x) => Math.max(0, (x?.count || 0) + step));
    st.mode = delta > 0 ? "ATAS" : "BAWAH";
    st.adjustChoice = delta > 0 ? "UP" : "DOWN";
    st.adjustPending = false;

    sendState();
  };

  // ====== satu pintu memproses bid (dipakai bot & event realtime) ======
  const applyBid = (fromUser, bidPayload) => {
    if (!hostState.current) return;
    const seat = seatOf(fromUser);
    if (seat == null) return;

    const b = {
      count: Number(bidPayload.count) || 0,
      suit: bidPayload.suit,
      rank: bidPayload.rank,
    };  
    hostState.current.publicState.bids[seat] = b;

    const bids = hostState.current.publicState.bids;
    if (bids.every(Boolean)) {
      // tentukan pemenang bidding: COUNT > SUIT(C<D<H<S) > RANK
      let bestIdx = 0;
      for (let i = 1; i < 4; i++) {
        const bi = bids[i], bb = bids[bestIdx];
        const biSuit = suitOrder[bi.suit] ?? -1;
        const bbSuit = suitOrder[bb.suit] ?? -1;
        if (
          bi.count > bb.count ||
          (bi.count === bb.count && biSuit > bbSuit) ||
          (bi.count === bb.count && biSuit === bbSuit && bi.rank > bb.rank)
        ) bestIdx = i;
      }
      const st = hostState.current.publicState;
      st.trump = bids[bestIdx].suit;
      st.trickLeader = bestIdx;
      st.currentPlayer = bestIdx;

      // Aturan baru:
      // - Default target = bet masing-masing
      // - Jika total bet = 13 → pemenang memilih +1 / -1
      const sum = bids.reduce((a, x) => a + (x?.count || 0), 0);
      st.mode = null;
      st.targets = bids.map((x) => (x?.count || 0));

      if (sum === 13) {
        st.adjustPending = true;
        st.adjustDecider = bestIdx;
        st.adjustChoice = null;
        [0,1,2,3].forEach((seat) => {
          sendToastToSeat(seat, `Total bet = 13. Pemenang bidding: P${bestIdx + 1}`);
        });
      } else {
        st.adjustPending = false;
        st.adjustDecider = null;
        st.adjustChoice = null;
      }
    }
    sendState();
  };

  // ====== satu pintu memproses play (dipakai bot & event realtime) ======
  const applyPlay = async (fromUser, cardId, nonce) => {
    if (nonce) {
      const seat = seatOf(fromUser);
      if (lastNonceBySeatRef.current[seat] === nonce) return;
      lastNonceBySeatRef.current[seat] = nonce;
    }

    if (!hostState.current) return;

    const seat = seatOf(fromUser);
    if (seat == null || !cardId) return;

    const st = hostState.current.publicState;
    if (st.phase !== "play" || seat !== st.currentPlayer) return;
    if (st.table.length >= 4) return;

    const hand = hostState.current.hands[seat];
    const idx = hand.indexOf(cardId);
    if (idx === -1) return;

    const suit = cardFromId(cardId).suit;

    // Awal trik
    if (st.table.length === 0) {
      if (st.requireTrumpBroken) {
        if (suit === st.trump && !st.trumpBroken) {
          const hasNonTrump = hand.some((id) => cardFromId(id).suit !== st.trump);
          if (hasNonTrump) { sendToastToSeat(seat, "Belum boleh lead truf (harus broken dulu)!"); return; }
          st.trumpBroken = true;
        }
      } else if (suit === st.trump && !st.trumpBroken) {
        st.trumpBroken = true;
      }
      st.leadSuit = suit;
    } else {
      // Follow-suit
      const hasLead = hand.some((id) => cardFromId(id).suit === st.leadSuit);
      if (hasLead && suit !== st.leadSuit) {
        if (st.requireTrumpBroken) { sendToastToSeat(seat, "Harus ikut warna (follow suit)!"); return; }
        if (suit !== st.trump) { sendToastToSeat(seat, "Kalau mau menyimpang, harus ngetruf."); return; }
      }
      if (suit === st.trump && st.leadSuit !== st.trump && !st.trumpBroken) st.trumpBroken = true;
    }

    // mainkan kartu
    hand.splice(idx, 1);
    st.table.push({ player: seat, card: cardId, hidden: suit === st.trump });
    st.handSizes[seat] = Math.max(0, (st.handSizes[seat] || 0) - 1);

    // observasi bot
    try {
      const lead = st.leadSuit || suit;
      [0,1,2,3].forEach((s) => { if (!isSeatBot(s)) return;
        ensureBot(s).observePlay({ player: seat, card: cardFromId(cardId), leadSuit: lead });
      });
    } catch {}

    // sinkron DB untuk hands
    try {
      const uid = userIdOfSeat(seat);
      if (uid) await supabase.from("hands").delete().match({ room_id: roomId, owner: uid, card: cardId });
    } catch {}

    // next turn
    st.currentPlayer = (st.currentPlayer + 1) % 4;

    // selesai trik?
    if (st.table.length === 4) {
      st.table = st.table.map((t) => ({ ...t, hidden: false }));
      sendState();

      const t = setTimeout(() => {
        const win = trickWinner(st.table, st.trump, st.leadSuit);

        try {
          const lead = st.leadSuit;
          const plays = st.table.map((t) => ({ player: t.player, card: cardFromId(t.card) }));
          [0,1,2,3].forEach((s) => { if (!isSeatBot(s)) return;
            ensureBot(s).observeTrick({ plays, winner: win, trump: st.trump, leadSuit: lead });
          });
        } catch {}

        st.tricksWon[win] = (st.tricksWon[win] || 0) + 1;
        st.table = [];
        st.leadSuit = null;
        st.currentPlayer = win;

        const sumHands = st.handSizes.reduce((a,b)=>a+b,0);
        if (sumHands === 0) { sendState(); finishRoundAndMaybeContinue(); return; }

        sendState();
        runBots();
        runBotsTick();
      }, 600);
      timersRef.current.add(t);
      return;
    }

    sendState();           // ← broadcast + persist setiap play
    sendHandToSeat(seat);  // kirim tangan yang sudah berkurang ke pemiliknya
    runBotsTick();         // lanjutkan bot bila perlu
  };

  const runBotsTick = () => {
    if (!hostState.current) return;
    const st = hostState.current.publicState;

    if (st.phase === "bidding") {
      [0, 1, 2, 3].forEach((seat) => {
        if (!isSeatBot(seat)) return;
        if (st.bids?.[seat]) return;
        const bot = ensureBot(seat);
        const hand = (hostState.current.hands?.[seat] || []).map(cardFromId);
        const bid = bot.chooseBid(hand);
        const from = userIdOfSeat(seat);
        schedule(() => applyBid(from, bid), botDelay());
      });
      return;
    }

    if (st.phase === "play") {
      const seat = st.currentPlayer;
      if (!isSeatBot(seat)) return;
      const bot = ensureBot(seat);
      const hand = (hostState.current.hands?.[seat] || []).map(cardFromId);
      const table = (st.table || []).map((t) => ({ player: t.player, card: cardFromId(t.card) }));
      const need = (st.targets?.[seat] ?? 0) - (st.tricksWon?.[seat] ?? 0);
      const ctx = {
        hand,
        leadSuit: st.leadSuit,
        trump: st.trump,
        table,
        seen: [],
        voidMap: {},
        need,
        pos: table.length,
        mode: st.mode,
        seat,
        handCounts: st.handSizes?.reduce((m, cnt, i) => ((m[i] = cnt), m), {}) || {},
        trumpBroken: !!st.trumpBroken,
      };
      const pick = bot.pickCard(ctx);
      if (pick) {
        const from = userIdOfSeat(seat);
        schedule(() => applyPlay(from, pick.id), botDelay(350, 900));
      }
    }
  };

  const seatOf = (userId) => seatsRef.current.find((s) => s.user_id === userId)?.seat ?? null;
  const userIdOfSeat = (seat) => seatsRef.current.find((s) => s.seat === seat)?.user_id ?? null;

  // persist public state — throttled ±4x/detik
  const persistPublicState = async () => {
    if (persistTimerRef?.current) return;
    if (persistTimerRef) persistTimerRef.current = setTimeout(async () => {
      try {
        await supabase.from("room_states").upsert({
          room_id: roomId,
          state_json: hostState.current.publicState,
          updated_at: new Date().toISOString(),
        });
      } catch {}
      try { if (persistTimerRef?.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; } } catch {}
    }, 250);
  };

  const sendState = () => {
    if (!hostState.current) return;
    const payload = hostState.current.publicState;
    chRef.current?.send({ type: "broadcast", event: "state", payload });
    persistPublicState();
  };
  const sendHandToSeat = (seat) => {
    const userId = userIdOfSeat(seat);
    if (!userId) return;
    const cards = hostState.current?.hands?.[seat] || [];
    chRef.current?.send({ type: "broadcast", event: "hand", payload: { to: userId, cards } });
  };
  const sendToastToSeat = (seat, msg) => {
    const userId = userIdOfSeat(seat);
    if (!userId) return;
    chRef.current?.send({ type: "broadcast", event: "toast", payload: { to: userId, msg } });
  };
  const sendAllHands = () => [0, 1, 2, 3].forEach(sendHandToSeat);

  const persistHands = async () => {
    try { await supabase.from("hands").delete().eq("room_id", roomId); } catch {}
    try {
      const rows = [];
      for (const s of [0, 1, 2, 3]) {
        const uid = userIdOfSeat(s);
        if (!uid) continue;
        for (const id of hostState.current.hands[s]) {
          rows.push({ room_id: roomId, owner: uid, card: id });
        }
      }
      if (rows.length) {
        const { error } = await supabase.from("hands").insert(rows);
        if (error) console.error("Insert hands failed:", error);
      }
    } catch (e) {
      console.error("Persist hands error:", e);
    }
  };

  // start ronde baru — tarik aturan dari roomInfo
  const startNewRound = () => {
    const deck = shuffle(makeDeck());
    const hands = { 0: [], 1: [], 2: [], 3: [] };
    for (let i = 0; i < 52; i++) hands[i % 4].push(deck[i]);

    for (const s of [0, 1, 2, 3]) {
      hands[s].sort((a, b) => {
        const A = cardFromId(a), B = cardFromId(b);
        if (A.suit !== B.suit) return suitOrder[A.suit] - suitOrder[B.suit];
        return A.rank - B.rank;
      });
    }

    const prev = hostState.current?.publicState;
    const round = prev ? prev.round + 1 : 1;
    const dealer = prev ? (prev.dealer + 1) % 4 : 0;
    const rule = !!(roomInfo?.require_trump_broken);

    hostState.current = {
      hands,
      publicState: {
        round,
        dealer,
        phase: "bidding",
        currentPlayer: (dealer + 1) % 4,
        leadSuit: null,
        trump: null,
        trumpBroken: false,

        mode: null,
        bids: [null, null, null, null],
        bidsRevealed: false,
        targets: [0, 0, 0, 0],

        table: [],
        tricksWon: [0, 0, 0, 0],
        scores: prev?.scores ? prev.scores.slice() : [0, 0, 0, 0],
        handSizes: [13, 13, 13, 13],

        requireTrumpBroken: rule,

        adjustPending: false,
        adjustDecider: null,
        adjustChoice: null,        
      },
    };

    sendState();
    sendAllHands();
    persistHands();
    schedule(runBotsTick, 400);
  };

  const trickWinner = (table, trump, lead) => {
    const strength = (id) => {
      const c = cardFromId(id);
      return (c.suit === trump ? 3 : c.suit === lead ? 2 : 0) * 100 + c.rank;
    };
    let best = table[0];
    for (let i = 1; i < table.length; i++) {
      if (strength(table[i].card) > strength(best.card)) best = table[i];
    }
    return best.player;
  };

  const runBots = useCallback(() => {
    maybeRunBots({
      hostState,
      seats: seatsRef.current,
      timersRef,
      sendState,
      sendHandToSeat,
      trickWinner,
      roomId,
    });
  }, [roomId]);

  const finishRoundAndMaybeContinue = () => {
    const st = hostState.current.publicState;
    for (let i = 0; i < 4; i++) {
      const got = st.tricksWon[i] || 0;
      const tgt = st.targets[i] || 0;
      let delta = 0;
      if (got === tgt) delta = tgt;
      else if (got < tgt) delta = st.mode === "ATAS" ? -2 * (tgt - got) : -(tgt - got);
      else delta = st.mode === "BAWAH" ? -2 * (got - tgt) : -(got - tgt);
      st.scores[i] = (st.scores[i] || 0) + delta;
    }

    if (st.round >= MAX_ROUNDS) {
      st.phase = "ended";
      sendState();
      return;
    }

    const t = setTimeout(() => { startNewRound(); }, 700);
    timersRef.current.add(t);
  };

  // Fallback: setelah refresh, pastikan host rehydrate & jalan lagi
  useEffect(() => {
    if (!isHost) return;
    (async () => {
      if (!hostState.current) {
        const ok = await hydrateHostFromDB();
        if (!ok) return;
      }
      // Broadcast supaya klien lain sinkron, lalu lanjutkan bot.
      sendState();
      runBots();
      runBotsTick();
    })();
  }, [isHost, roomId]);

  useEffect(() => {
    if (!isHost || !chRef.current) return;
    const ch = chRef.current;

    const onSync = async () => {
      if (!hostState.current) {
        const ok = await hydrateHostFromDB();
        if (!ok) { startNewRound(); return; }
      }
      sendState();
      sendAllHands();
      runBotsTick();
      runBots();
    };

    const onBid = ({ payload }) => applyBid(payload?.from, payload);

    const onStartPlay = () => {
      if (!hostState.current) return;
      const st = hostState.current.publicState;

      // Lock start kalau masih menunggu keputusan
      if (st.adjustPending) {
        [0,1,2,3].forEach((seat) => sendToastToSeat(seat, "Menunggu pemenang bidding pilih Naik +1 / Turun -1"));
        return;
      }

      st.phase = "play";
      st.bidsRevealed = true;
      st.leadSuit = null;
      st.currentPlayer = typeof st.trickLeader === "number" ? st.trickLeader : (st.dealer + 1) % 4;
      sendState();
      sendAllHands();
      runBots();
      runBotsTick();
    };

    const onPlayCard = async ({ payload }) => {
      const from = payload?.from;
      const cardId = typeof payload === "string" ? payload : payload?.card || payload?.id;
      const nonce = payload?.nonce;
      await applyPlay(from, cardId, nonce);
    };

    // listeners
    ch.on("broadcast", { event: "adjust_choice" }, ({ payload }) => {
      applyAdjustChoice(payload?.from, payload?.delta);
    });
    ch.on("broadcast", { event: "sync" }, onSync);
    ch.on("broadcast", { event: "bid" }, onBid);
    ch.on("broadcast", { event: "start_play" }, onStartPlay);
    ch.on("broadcast", { event: "play_card" }, onPlayCard);

    return () => {
      try { for (const t of timersRef.current) clearTimeout(t); timersRef.current.clear(); } catch {}
    };
  }, [isHost, roomId, chRef]);
}
