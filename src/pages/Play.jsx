// src/pages/Play.jsx
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
import { createLearningBot } from "../bots/learningBot";
import { isBotUserId } from "../bots/learningBot";

/* ========================= Helpers & constants ========================= */

const SUITS = [
  { key: "C", label: "Clover", icon: "♣" },
  { key: "D", label: "Diamond", icon: "♦" },
  { key: "H", label: "Heart", icon: "♥" },
  { key: "S", label: "Spade", icon: "♠" },
];
const suitOrder = { C: 0, D: 1, H: 2, S: 3 };
const SeatName = ["P1", "P2", "P3", "P4"];
const MAX_ROUNDS = 4; // ubah ke 1 kalau mau tes cepat

const rankLabel = (r) =>
  r <= 10 ? String(r) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" }[r]);
const betFromRank = (rank) =>
  rank === 14 ? 1 : rank >= 11 && rank <= 13 ? 0 : rank;
const suitIcon = (s) => SUITS.find((x) => x.key === s)?.icon || "?";

function cardFromId(id) {
  const s = id.slice(-1).toUpperCase();
  const rRaw = id.slice(0, -1).toUpperCase();
  const rank =
    rRaw === "A"
      ? 14
      : rRaw === "K"
      ? 13
      : rRaw === "Q"
      ? 12
      : rRaw === "J"
      ? 11
      : rRaw === "T"
      ? 10
      : Number(rRaw);
  const suitIco = suitIcon(s);
  return {
    id,
    suit: s,
    rank,
    label: `${rankLabel(rank)}${suitIco}`,
    suitIcon: suitIco,
  };
}

function makeDeck() {
  const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const suits = ["C", "D", "H", "S"];
  const asId = (r, s) =>
    (r === 14
      ? "A"
      : r === 13
      ? "K"
      : r === 12
      ? "Q"
      : r === 11
      ? "J"
      : r === 10
      ? "T"
      : String(r)) + s;
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push(asId(r, s));
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

/* ========================= UI atoms ========================= */

function Badge({ children }) {
  return (
    <span className="inline-flex items-center rounded-md bg-zinc-700 text-stone-200 px-2 py-0.5 text-xs shadow-sm">
      {children}
    </span>
  );
}

function SimpleCardBack({ small, vertical }) {
  const cls = `bg-red-600 rounded-lg border-2 border-red-300 shadow ${
    small ? "h-6 w-4" : "h-10 w-7"
  } ${vertical ? "" : ""}`;
  return <div className={cls} />;
}

function SimpleCardFace({ card }) {
  const red = card.suit === "H" || card.suit === "D";
  return (
    <div className="px-2 py-1 rounded-lg border bg-white font-mono text-sm shadow">
      <span className={red ? "text-rose-600" : "text-slate-800"}>
        {card.label}
      </span>
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
      className={`card-base animate-deal ${
        disabled ? "opacity-100 cursor-not-allowed" : "hover:-translate-y-2"
      }`}
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
      {play ? (
        play.hidden ? (
          <SimpleCardBack small />
        ) : (
          <SimpleCardFace card={cardFromId(play.card)} />
        )
      ) : null}
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
  }, [suit, handBySuit]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <option key={s.key} value={s.key}>
            {s.icon}
          </option>
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
            <option key={r} value={r}>
              {rankLabel(r)} ({betFromRank(r)})
            </option>
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

  // presence
  const [online, setOnline] = useState([]);
  // occupants untuk label kursi
  const [seats, setSeats] = useState([]); // [{seat, display_name, user_id}]
  // info room (host id)
  const [roomInfo, setRoomInfo] = useState(null);

  // current user
  const meRef = useRef(null);
  const [meId, setMeId] = useState(null);

  // small toast (untuk pesan invalid play dsb)
  const [toast, setToast] = useState("");

  // game state client
  const [g, setG] = useState({
    round: 1,
    dealer: 0,
    phase: "bidding", // "bidding" | "play" | "ended"
    currentPlayer: 0,
    leadSuit: null,
    trump: null,
    trumpBroken: false,
    mode: null, // ATAS/BAWAH
    bids: [null, null, null, null],
    bidsRevealed: false,
    targets: [0, 0, 0, 0],
    table: [], // [{player, card, hidden?}]
    tricksWon: [0, 0, 0, 0],
    scores: [0, 0, 0, 0], // total skor akumulatif
    handSizes: [13, 13, 13, 13], // ukuran tangan tiap kursi (non-privat)
    myHand: [], // kartu saya (privat via event "hand" + DB)
  });

  // channel refs
  const chRef = useRef(null);
  const pgHandsRef = useRef(null);

  // timers (reveal, next-round) supaya bisa dibersihkan saat unmount
  const timersRef = useRef(new Set());

  const [ready, setReady] = useState(false);

  // --- helper: cleanup agresif sebelum balik ke lobby/room
  const goBack = useCallback(
    (to) => {
      try {
        if (chRef.current) supabase.removeChannel(chRef.current);
      } catch {}
      try {
        if (pgHandsRef.current) supabase.removeChannel(pgHandsRef.current);
      } catch {}
      try {
        supabase.getChannels().forEach((c) => supabase.removeChannel(c));
      } catch {}
      // clear timeouts
      try {
        for (const t of timersRef.current) clearTimeout(t);
        timersRef.current.clear();
      } catch {}
      navigate(to, { replace: true });
    },
    [navigate]
  );

  // ---------- initial data ----------
  useEffect(() => {
    (async () => {
      const u = await getUser();
      meRef.current = u;
      setMeId(u?.id ?? null);

      // seats + room info
      const [seatsRows, st] = await Promise.all([
        fetchSeats(roomId),
        fetchState(roomId),
      ]);
      setSeats(seatsRows);
      setRoomInfo(st);
      setReady(true);

      // (HYBRID) initial fetch my hand from DB (kalau ada)
      if (u?.id) {
        const { data: myRows, error } = await supabase
          .from("hands")
          .select("card")
          .eq("room_id", roomId)
          .eq("owner", u.id);
        if (!error && Array.isArray(myRows)) {
          setG((o) => ({
            ...o,
            myHand: (myRows || []).map((r) => cardFromId(r.card)),
          }));
        }
      }

      // (HYBRID) initial fetch persisted room state jika ada
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
            myHand: old.myHand,
            table: (s.table || []).map((t) => ({ ...t })),
          }));
        }
      } catch {}
    })();

    // full cleanup saat unmount (kalau user ganti halaman tanpa tombol kita)
    return () => {
      try {
        if (chRef.current) supabase.removeChannel(chRef.current);
      } catch {}
      try {
        if (pgHandsRef.current) supabase.removeChannel(pgHandsRef.current);
      } catch {}
      try {
        supabase.getChannels().forEach((c) => supabase.removeChannel(c));
      } catch {}
      try {
        for (const t of timersRef.current) clearTimeout(t);
        timersRef.current.clear();
      } catch {}
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

  // seat saya (0..3) atau null kalau belum duduk
  const mySeat = useMemo(
    () => seats.find((s) => s.user_id === meId)?.seat ?? null,
    [seats, meId]
  );

  // mapping kursi absolut <-> relatif ke mySeat
  const absToRel = useCallback(
    (abs) => (mySeat == null ? abs : (abs - mySeat + 4) % 4),
    [mySeat]
  );
  const relToAbs = useCallback(
    (rel) => (mySeat == null ? rel : (mySeat + rel) % 4),
    [mySeat]
  );

  // ---------- realtime channel (broadcast) ----------
  useEffect(() => {
    if (!ready) return;
    const ch = supabase.channel(`game:${roomId}`, {
      config: { broadcast: { self: true, ack: true } },
    });
    chRef.current = ch;

    // GLOBAL STATE (publik)
    ch.on("broadcast", { event: "state" }, ({ payload }) => {
      const s = payload || {};
      setG((old) => ({
        ...old,
        ...s,
        myHand: old.myHand, // jangan overwrite hand di event state publik
        table: (s.table || []).map((t) => ({ ...t })),
      }));
    });

    // PRIVATE HAND (khusus user) — jalur cepat via broadcast
    ch.on("broadcast", { event: "hand" }, ({ payload }) => {
      const userId = payload?.to;
      const cards = Array.isArray(payload?.cards) ? payload.cards : payload;
      if (userId && userId !== meRef.current?.id) return;
      if (!Array.isArray(cards)) return;
      setG((o) => ({ ...o, myHand: cards.map(cardFromId) }));
    });

    // toast personal
    ch.on("broadcast", { event: "toast" }, ({ payload }) => {
      if (!payload) return;
      if (payload.to && payload.to !== meRef.current?.id) return;
      setToast(String(payload.msg || payload));
      const t = setTimeout(() => setToast(""), 1500);
      timersRef.current.add(t);
    });

    // subscribe → minta sync
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.send({
          type: "broadcast",
          event: "sync",
          payload: { hello: "sync" },
        });
      }
    });

    return () => {
      try {
        supabase.removeChannel(ch);
      } catch {}
    };
  }, [roomId, ready]);

  // ---------- Postgres Changes: my hand (persist path) ----------
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
            setG((o) => ({
              ...o,
              myHand: (o.myHand || []).filter((h) => h.id !== id),
            }));
          }
        }
      )
      .subscribe();

    pgHandsRef.current = chan;
    return () => {
      try {
        if (pgHandsRef.current) supabase.removeChannel(pgHandsRef.current);
      } catch {}
    };
  }, [roomId, meId]);

  // ---------- Host Controller ----------
  useHostController(isHost, roomId, seats, chRef, timersRef
    
  );

  // ---------- Derived ----------
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

  // hitung jumlah kartu lawan relatif (pakai handSizes publik)
  const oppCounts = useMemo(() => {
    if (mySeat == null) return [13, 13, 13];
    return [
      g.handSizes?.[(mySeat + 1) % 4] ?? 13,
      g.handSizes?.[(mySeat + 2) % 4] ?? 13,
      g.handSizes?.[(mySeat + 3) % 4] ?? 13,
    ];
  }, [g.handSizes, mySeat]);

  // ---------- Actions (client → host) ----------
  function submitBid(suit, rank) {
    if (mySeat == null) return;
    const bid = { count: betFromRank(rank), suit, rank, from: meRef.current?.id };
    chRef.current?.send({ type: "broadcast", event: "bid", payload: bid });
  }

  // client-side guard: follow-suit, lead trump rule & giliran
  const canPlayCard = useCallback(
    (c) => {
      if (g.phase !== "play" || mySeat == null) return false;
      if (g.currentPlayer !== mySeat) return false;

      // awal trik
      if (!g.leadSuit) {
        // tidak boleh lead truf sebelum broken, kecuali semua kartu di tangan = truf
        if (c.suit === g.trump && !g.trumpBroken) {
          const hasNonTrump = (g.myHand || []).some((h) => h.suit !== g.trump);
          if (hasNonTrump) return false;
        }
        return true;
      }

      // follow suit wajib jika bisa
      const hasLead = (g.myHand || []).some((h) => h.suit === g.leadSuit);
      if (hasLead && c.suit !== g.leadSuit) return false;
      return true;
    },
    [
      g.phase,
      g.currentPlayer,
      g.leadSuit,
      g.myHand,
      mySeat,
      g.trump,
      g.trumpBroken,
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

  // ---------- UI ----------
  const targetOrDash = (absSeat) =>
    g.phase === "play" && g.targets[absSeat] !== undefined
      ? g.targets[absSeat]
      : "–";

  const relToName = (abs) =>
    seats.find((s) => s.seat === abs)?.display_name || SeatName[abs];

  const relName = (relIdx) => relToName(relToAbs(relIdx));
  const relTricks = (relIdx) => g.tricksWon[relToAbs(relIdx)] ?? 0;
  const relTarget = (relIdx) => targetOrDash(relToAbs(relIdx));

  const winner =
    g.phase === "ended" && leaderboard.length ? leaderboard[0] : null;

  return (
    <div className="min-h-screen w-screen bg-zinc-900 text-stone-800">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-4">
        <header className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button
              className="text-stone-300 text-sm underline"
              onClick={() => goBack(`/lobby`)}
            >
              ← Lobby
            </button>
            <h1 className="text-3xl font-extrabold text-amber-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.7)]">
              Trufman
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-stone-300 text-sm">
              Room:{" "}
              <span className="tabular-nums">{roomId.slice(0, 8)}</span> •
              Ronde: {g.round}/{MAX_ROUNDS} • Dealer: P{g.dealer + 1}
            </div>
            <div className="text-xs text-stone-300">
              Online: {online.length} —{" "}
              {online.map((o) => o.display_name || "Player").join(", ")}
            </div>
          </div>
        </header>

        {/* BOARD */}
        <div className="relative mx-auto w-full max-w-[1200px] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-800 to-red-950 rounded-2xl shadow-inner border-4 border-zinc-950 min-h-[560px] overflow-hidden">
          {/* label skor sisi (relatif) */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-stone-200 font-semibold drop-shadow">
            {relName(2)} • {relTricks(2)}/{relTarget(2)}
          </div>
          <div className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-stone-200 font-semibold drop-shadow">
            {relName(1)} • {relTricks(1)}/{relTarget(1)}
          </div>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-stone-200 font-semibold drop-shadow">
            {relName(3)} • {relTricks(3)}/{relTarget(3)}
          </div>

          {/* Kartu belakang lawan (left/top/right relatif) */}
          <div className="absolute top-10 left-1/2 -translate-x-1/2 flex gap-2">
            {Array.from({ length: oppCounts[1] }).map((_, i) => (
              <SimpleCardBack key={`t-${i}`} small />
            ))}
          </div>
          <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {Array.from({ length: oppCounts[0] }).map((_, i) => (
              <SimpleCardBack key={`l-${i}`} vertical small />
            ))}
          </div>
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {Array.from({ length: oppCounts[2] }).map((_, i) => (
              <SimpleCardBack key={`r-${i}`} vertical small />
            ))}
          </div>

          {/* Meja tengah — map kartu absolut ke posisi relatif */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-80 h-64">
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-auto">
                <TableSlot
                  play={g.table.find((t) => absToRel(t.player) === 0)}
                />
              </div>
              <div className="absolute left-0 top-1/2 -translate-y-1/2 pointer-events-auto">
                <TableSlot
                  play={g.table.find((t) => absToRel(t.player) === 1)}
                />
              </div>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-auto">
                <TableSlot
                  play={g.table.find((t) => absToRel(t.player) === 2)}
                />
              </div>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-auto">
                <TableSlot
                  play={g.table.find((t) => absToRel(t.player) === 3)}
                />
              </div>
            </div>
          </div>

          {/* kartu kita (selalu di bawah) */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[95%]">
            <div className="mb-2 text-center text-stone-200 font-semibold drop-shadow">
              {(mySeat != null
                ? seats.find((s) => s.seat === mySeat)?.display_name
                : "Kamu") || "Kamu"}{" "}
              •{" "}
              {mySeat != null ? g.tricksWon[mySeat] ?? 0 : 0}/
              {mySeat != null ? targetOrDash(mySeat) : "–"}
            </div>
            <div className="flex flex-wrap gap-2 items-center justify-center">
              {(g.myHand || []).map((c) => (
                <CardFace
                  key={c.id}
                  card={c}
                  disabled={!canPlayCard(c)}
                  onClick={() => playCard(c)}
                />
              ))}
            </div>
          </div>

          {/* toast kecil */}
          {toast && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 text-stone-100 px-3 py-1 rounded">
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
          <Badge>
            Total Bet: {g.bidsRevealed ? `${sumBids}/13` : "—/13"}
          </Badge>
        </div>

        {/* Bidding */}
        {g.phase === "bidding" && (
          <div className="mx-auto w/full max-w-[1200px] mt-3 grid md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((p) => {
              const bid = g.bids[p];
              const isYou = p === mySeat;
              const bidCard = bid
                ? {
                    id: `BID${p}`,
                    suit: bid.suit,
                    rank: bid.rank,
                    label: `${rankLabel(bid.rank)}${suitIcon(bid.suit)}`,
                    suitIcon: suitIcon(bid.suit),
                  }
                : null;
              return (
                <div
                  key={p}
                  className="bg-zinc-800 rounded-xl shadow p-3 text-stone-100"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">
                      {relToName(p)} {isYou ? "(Kamu)" : ""}
                    </div>
                    <Badge>
                      Bid:{" "}
                      {bid
                        ? g.bidsRevealed
                          ? `${bid.count}${suitIcon(bid.suit)}`
                          : "..."
                        : "..."}
                    </Badge>
                  </div>

                  {bid ? (
                    <div className="h-10 flex items-center">
                      {g.bidsRevealed ? (
                        <SimpleCardFace card={bidCard} />
                      ) : (
                        <SimpleCardBack small />
                      )}
                      <span className="ml-2 text-xs text-stone-400">
                        {g.bidsRevealed ? "Terbuka" : "Menunggu..."}
                      </span>
                    </div>
                  ) : isYou ? (
                    <PlayerBidForm
                      handBySuit={handBySuit}
                      onSubmit={submitBid}
                      disabled={!!g.bids[mySeat ?? -1]}
                    />
                  ) : (
                    <div className="text-stone-400 text-sm h-10 flex items-center">
                      Menunggu...
                    </div>
                  )}
                </div>
              );
            })}
            <div className="md:col-span-4 flex justify-end">
              <button
                className="px-4 py-2 rounded-xl text-white font-bold transition disabled:bg-zinc-600 bg-red-700 hover:bg-red-600"
                onClick={() =>
                  chRef.current?.send({
                    type: "broadcast",
                    event: "start_play",
                  })
                }
                disabled={!allBidsIn}
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
                    <div className="font-semibold">
                      {isYou ? "Skor Kamu" : `Skor ${name}`}
                    </div>
                    <Badge>Total: {g.scores?.[p] ?? 0}</Badge>
                  </div>
                  <div className="mt-1 text-sm text-stone-300 grid grid-cols-2 gap-1">
                    <div>Bid</div>
                    <div className="text-right">
                      {g.bids[p]
                        ? g.bidsRevealed
                          ? `${g.bids[p].count}${suitIcon(g.bids[p].suit)}`
                          : "..."
                        : "–"}
                    </div>
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
                <li
                  key={row.i}
                  className="flex items-center justify-between text-sm p-1 rounded-md bg-zinc-700/50"
                >
                  <span className="flex items-center gap-2 text-stone-200">
                    <span
                      className={`inline-flex w-6 h-6 items-center justify-center rounded-full font-bold ${
                        idx === 0
                          ? "bg-amber-400 text-zinc-900"
                          : "bg-zinc-600"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span>{row.name}</span>
                  </span>
                  <span className="font-semibold text-stone-100">
                    {row.score} Poin
                  </span>
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
            <h2 className="text-2xl font-bold text-amber-300 mb-1">
              Permainan Selesai 🎉
            </h2>
            <p className="text-stone-200 mb-4">
              Pemenang: <strong>{winner.name}</strong>
            </p>

            <div className="rounded-lg bg-zinc-800 p-3 mb-4">
              <h3 className="text-stone-200 font-semibold mb-2">Rekap Poin</h3>
              <ul className="space-y-1 text-stone-300">
                {[0, 1, 2, 3]
                  .map((i) => ({
                    i,
                    name: relToName(i),
                    score: g.scores?.[i] ?? 0,
                  }))
                  .sort((a, b) => b.score - a.score)
                  .map((r, idx) => (
                    <li
                      key={r.i}
                      className="flex items-center justify-between bg-zinc-700/40 rounded-md px-2 py-1"
                    >
                      <span className="flex items-center gap-2">
                        <span className="inline-flex w-6 h-6 items-center justify-center rounded-full bg-zinc-600 font-bold">
                          {idx + 1}
                        </span>
                        {r.name}
                      </span>
                      <span className="font-semibold">{r.score} pts</span>
                    </li>
                  ))}
              </ul>
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold"
                onClick={() => goBack(`/lobby`)} // ganti ke "/lobby" jika perlu
              >
                Kembali ke Lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================= Host Controller hook (HYBRID: broadcast + DB) ========================= */

function useHostController(isHost, roomId, seats, chRef, timersRef) {
  const hostState = useRef(null); // { publicState, hands: {0:[],1:[],2:[],3:[]} }
  const botsRef = useRef({});     // seat -> instance bot

const isSeatBot = (seat) => {
  const row = seats.find((s) => s.seat === seat);
  return !!row && (
    row.is_bot ||
    isBotUserId(row.user_id) ||
    row.display_name?.startsWith?.("Bot ")
    );
  };
  const botDelay = (min=250,max=700) => Math.floor(min + Math.random()*(max-min));
  const schedule = (fn, ms=400) => {
  const t = setTimeout(fn, ms);
  timersRef.current.add(t);
    return t;
  };

 // pastikan instance bot per seat ada dan sinkron seat-nya
  const ensureBot = (seat) => {
    if (!botsRef.current[seat]) {
      botsRef.current[seat] = createLearningBot({
          seat,
          getState: () => ({
          ...(hostState.current?.publicState || {}),
          SUITS, // pakai konstanta dari file ini
        }),
      });
    } else {
      botsRef.current[seat].setSeat(seat);
    }
    return botsRef.current[seat];
    };
  
// Jalankan aksi bot sesuai fase
  const runBotsTick = () => {
    if (!hostState.current) return;
    const st = hostState.current.publicState;

    // ====== BIDDING: seat bot yang belum bid -> bid sekarang ======
    if (st.phase === "bidding") {
      [0,1,2,3].forEach((seat) => {
        if (!isSeatBot(seat)) return;
        if (st.bids?.[seat]) return; // sudah bid
        const bot = ensureBot(seat);
        const hand = (hostState.current.hands?.[seat] || []).map(cardFromId);
        const bid = bot.chooseBid(hand); // {count,suit,rank}
        const from = userIdOfSeat(seat);
        schedule(() => {
          chRef.current?.send({
            type: "broadcast",
            event: "bid",
            payload: { ...bid, from },
          });
        }, botDelay());
      });
      return; // fokus ke bidding dulu
    }

    // ====== PLAY: kalau giliran bot -> mainkan kartu ======
    if (st.phase === "play") {
      const seat = st.currentPlayer;
      if (!isSeatBot(seat)) return;
      const bot = ensureBot(seat);
      const hand = (hostState.current.hands?.[seat] || []).map(cardFromId);
      const table = (st.table || []).map(t => ({ player: t.player, card: cardFromId(t.card) }));
      const need = (st.targets?.[seat] ?? 0) - (st.tricksWon?.[seat] ?? 0);
      const ctx = {
        hand,
        leadSuit: st.leadSuit,
        trump: st.trump,
        table,
        seen: [],                 // bisa kamu isi kalau mau
        voidMap: {},              // diisi lewat observe* (lihat bawah)
        need,
        pos: table.length,
        mode: st.mode,
        seat,
        handCounts: st.handSizes?.reduce((m, cnt, i)=> (m[i]=cnt, m), {}) || {},
        trumpBroken: !!st.trumpBroken,
      };
      const pick = bot.pickCard(ctx);
      if (pick) {
        const from = userIdOfSeat(seat);
        schedule(() => {
          chRef.current?.send({
            type: "broadcast",
            event: "play_card",
            payload: { from, card: pick.id },
          });
        }, botDelay(350, 900));
      }
    }
  };


  const seatOf = (userId) =>
    seats.find((s) => s.user_id === userId)?.seat ?? null;
  const userIdOfSeat = (seat) =>
    seats.find((s) => s.seat === seat)?.user_id ?? null;

  // ---- send helpers ----
  const persistPublicState = async () => {
    try {
      await supabase.from("room_states").upsert({
        room_id: roomId,
        state_json: hostState.current.publicState,
        updated_at: new Date().toISOString(),
      });
    } catch {}
  };
  const sendState = () => {
    if (!hostState.current) return;
    const payload = hostState.current.publicState;
    chRef.current?.send({ type: "broadcast", event: "state", payload });
    persistPublicState(); // best-effort
  };
  const sendHandToSeat = (seat) => {
    const userId = userIdOfSeat(seat);
    if (!userId) return;
    const cards = hostState.current?.hands?.[seat] || [];
    chRef.current?.send({
      type: "broadcast",
      event: "hand",
      payload: { to: userId, cards },
    });
  };
  const sendToastToSeat = (seat, msg) => {
    const userId = userIdOfSeat(seat);
    if (!userId) return;
    chRef.current?.send({
      type: "broadcast",
      event: "toast",
      payload: { to: userId, msg },
    });
  };
  const sendAllHands = () => [0, 1, 2, 3].forEach(sendHandToSeat);

  // (HYBRID) persist hands to DB
  const persistHands = async () => {
    try {
      await supabase.from("hands").delete().eq("room_id", roomId);
    } catch {}
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

  // start ronde baru (deal + reset publik)
  const startNewRound = () => {
    const deck = shuffle(makeDeck());
    const hands = { 0: [], 1: [], 2: [], 3: [] };
    for (let i = 0; i < 52; i++) hands[i % 4].push(deck[i]);

    // sort biar enak dilihat
    for (const s of [0, 1, 2, 3]) {
      hands[s].sort((a, b) => {
        const A = cardFromId(a),
          B = cardFromId(b);
        if (A.suit !== B.suit) return suitOrder[A.suit] - suitOrder[B.suit];
        return A.rank - B.rank;
      });
    }

    const prev = hostState.current?.publicState;
    const round = prev ? prev.round + 1 : 1;
    const dealer = prev ? (prev.dealer + 1) % 4 : 0;

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
      },
    };

    sendState();
    sendAllHands(); // broadcast hands (jalur cepat)
    persistHands(); // simpan ke DB (persist)
    schedule(runBotsTick, 400); // biar bot segera bid
  };

  // penentu pemenang trik sederhana
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
      seats,
      timersRef,
      sendState,
      sendHandToSeat,
      trickWinner,
      roomId,
    });
  }, [seats, roomId]); // hostState/timersRef pakai ref -> aman

  // akhiri ronde → hitung skor → next ronde / end game
  const finishRoundAndMaybeContinue = () => {
    const st = hostState.current.publicState;

    // Skoring
    for (let i = 0; i < 4; i++) {
      const got = st.tricksWon[i] || 0;
      const tgt = st.targets[i] || 0;
      let delta = 0;
      if (got === tgt) delta = tgt;
      else if (got < tgt)
        delta = st.mode === "ATAS" ? -2 * (tgt - got) : -(tgt - got);
      else delta = st.mode === "BAWAH" ? -2 * (got - tgt) : -(got - tgt);
      st.scores[i] = (st.scores[i] || 0) + delta;
    }

    if (st.round >= MAX_ROUNDS) {
      st.phase = "ended";
      sendState();
      return;
    }

    const t = setTimeout(() => {
      startNewRound();
    }, 700);
    timersRef.current.add(t);
  };

  useEffect(() => {
    if (!isHost || !chRef.current) return;
    const ch = chRef.current;

    // ---- handlers (host only) ----
    const onSync = () => {
      if (!hostState.current) startNewRound();
      else {
        sendState();
        sendAllHands();
        runBotsTick();
        runBots();
      }
    };

    const onBid = ({ payload }) => {
      if (!hostState.current) return;
      const fromUser = payload?.from;
      const seat = seatOf(fromUser);
      if (seat == null) return;

      const b = {
        count: Number(payload.count) || 0,
        suit: payload.suit,
        rank: payload.rank,
      };
      hostState.current.publicState.bids[seat] = b;

      // kalau 4 bid sudah masuk → tentukan trump, MODE, dan TARGETS
      const bids = hostState.current.publicState.bids;
      if (bids.every(Boolean)) {
        // trump = suit dari bid dengan rank tertinggi (seri: suitOrder)
        let bestIdx = 0;
        for (let i = 1; i < 4; i++) {
          const bi = bids[i],
            bb = bids[bestIdx];
          if (bi.rank > bb.rank || (bi.rank === bb.rank && suitOrder[bi.suit] > suitOrder[bb.suit]))
            bestIdx = i;
        }
        const trump = bids[bestIdx].suit;
        hostState.current.publicState.trump = trump;

        // Mode & target
        const sum = bids.reduce((a, x) => a + (x?.count || 0), 0);
        const mode = sum >= 13 ? "ATAS" : "BAWAH";
        const targets = bids.map((x) =>
          mode === "ATAS" ? x.count + 1 : Math.max(0, x.count - 1)
        );
        hostState.current.publicState.mode = mode;
        hostState.current.publicState.targets = targets;
      }
      sendState();
      runBots();
      runBotsTick();
    };

    const onStartPlay = () => {
      if (!hostState.current) return;
      const st = hostState.current.publicState;
      st.phase = "play";
      st.bidsRevealed = true;
      sendState();
      sendAllHands();
      runBots();
      runBotsTick();
    };

    const onPlayCard = async ({ payload }) => {
      if (!hostState.current) return;

      const fromUser = payload?.from;
      const cardId =
        typeof payload === "string" ? payload : payload?.card || payload?.id;
      const seat = seatOf(fromUser);
      if (seat == null || !cardId) return;

      const st = hostState.current.publicState;
      if (st.phase !== "play" || seat !== st.currentPlayer) return;
      if (st.table.length >= 4) return;

      const hand = hostState.current.hands[seat];
      const idx = hand.indexOf(cardId);
      if (idx === -1) return;

      const suit = cardFromId(cardId).suit;

      // awal trik (set lead + larangan lead truf sebelum broken)
      if (st.table.length === 0) {
        if (suit === st.trump && !st.trumpBroken) {
          const hasNonTrump = hand.some(
            (id) => cardFromId(id).suit !== st.trump
          );
          if (hasNonTrump) {
            sendToastToSeat(seat, "Belum boleh lead truf (Truf Broken belum terjadi)!");
            return;
          }
          // legal lead (karena tinggal truf semua) → break
          st.trumpBroken = true;
        }
        st.leadSuit = suit;
      } else {
        // VALIDASI FOLLOW-SUIT
        const hasLead = hand.some((id) => cardFromId(id).suit === st.leadSuit);
        if (hasLead && suit !== st.leadSuit) {
          sendToastToSeat(seat, "Harus ikut warna (follow suit)!");
          return;
        }
        // buang truf saat tidak bisa ikut lead ⇒ break
        if (suit === st.trump && st.leadSuit !== st.trump && !st.trumpBroken) {
          st.trumpBroken = true;
        }
      }

      // mainkan kartu (truf → hidden di meja)
      hand.splice(idx, 1);
      st.table.push({ player: seat, card: cardId, hidden: suit === st.trump });
      st.handSizes[seat] = Math.max(0, (st.handSizes[seat] || 0) - 1);

    // kabari semua bot ada kartu yang dimainkan (untuk update void map & agresi)
    try {
      const lead = st.leadSuit || suit;
      [0,1,2,3].forEach(s => {
        if (!isSeatBot(s)) return;
        ensureBot(s).observePlay({ player: seat, card: cardFromId(cardId), leadSuit: lead });
      });
    } catch {}

      // persist removal ke DB hands (best-effort)
      try {
        const uid = userIdOfSeat(seat);
        if (uid)
          await supabase
            .from("hands")
            .delete()
            .match({ room_id: roomId, owner: uid, card: cardId });
      } catch {}

      // next turn
      st.currentPlayer = (st.currentPlayer + 1) % 4;

      // selesai satu trik?
      if (st.table.length === 4) {
        // buka semua kartu dulu
        st.table = st.table.map((t) => ({ ...t, hidden: false }));
        sendState();

        const t = setTimeout(() => {
          const win = trickWinner(st.table, st.trump, st.leadSuit);
        // informasikan hasil trik ke bot
        try {
          const lead = st.leadSuit;
          const plays = st.table.map(t => ({ player: t.player, card: cardFromId(t.card) }));
          [0,1,2,3].forEach(s => {
            if (!isSeatBot(s)) return;
            ensureBot(s).observeTrick({ plays, winner: win, trump: st.trump, leadSuit: lead });
          });
        } catch {}
          st.tricksWon[win] += 1;
          st.table = [];
          st.leadSuit = null;
          st.currentPlayer = win;
          sendState();
          runBots(); // lanjutkan turn jika bot yang menang/berikutnya bot

          // kalau semua tangan habis → ronde selesai
          const sumHands = st.handSizes.reduce((a, b) => a + b, 0);
          if (sumHands === 0) {
            sendState();
            finishRoundAndMaybeContinue();
            return;
          }
          sendState();
          sendState();
          runBotsTick();
        }, 600);
        timersRef.current.add(t);
        return;
      }

      sendState();
      sendHandToSeat(seat); // kirim tangan terbaru via broadcast
      runBotsTick(); // kalau next player bot, dia langsung jalan
    };

    // pasang listeners
    ch.on("broadcast", { event: "sync" }, onSync);
    ch.on("broadcast", { event: "bid" }, onBid);
    ch.on("broadcast", { event: "start_play" }, onStartPlay);
    ch.on("broadcast", { event: "play_card" }, onPlayCard);

    // cleanup listeners & timers saat host unmount
    return () => {
      try {
        for (const t of timersRef.current) clearTimeout(t);
        timersRef.current.clear();
      } catch {}
    };
  }, [isHost, seats, chRef]);
}

