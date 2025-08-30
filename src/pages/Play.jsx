import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase, getUser } from "../lib/supabaseClient";
import { fetchSeats, fetchState } from "../lib/rooms";
import { joinRoomPresence } from "../lib/presence";

/* ========================= Helpers & constants ========================= */

const SUITS = [
  { key: "C", label: "Clover", icon: "♣" },
  { key: "D", label: "Diamond", icon: "♦" },
  { key: "H", label: "Heart", icon: "♥" },
  { key: "S", label: "Spade", icon: "♠" },
];
const suitOrder = { C: 0, D: 1, H: 2, S: 3 };
const SeatName = ["P1", "P2", "P3", "P4"];

const rankLabel = (r) => (r <= 10 ? String(r) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" }[r]));
const betFromRank = (rank) => (rank === 14 ? 1 : (rank >= 11 && rank <= 13 ? 0 : rank));

function suitIcon(s) { return SUITS.find(x => x.key === s)?.icon || "?" }

function cardFromId(id) {
  const s = id.slice(-1).toUpperCase();
  const rRaw = id.slice(0, -1).toUpperCase();
  const rank =
    rRaw === "A" ? 14 :
    rRaw === "K" ? 13 :
    rRaw === "Q" ? 12 :
    rRaw === "J" ? 11 :
    rRaw === "T" ? 10 : Number(rRaw);
  const suitIco = suitIcon(s);
  return { id, suit: s, rank, label: `${rankLabel(rank)}${suitIco}`, suitIcon: suitIco };
}

function makeDeck() {
  const ranks = [2,3,4,5,6,7,8,9,10,11,12,13,14];
  const suits = ["C","D","H","S"];
  const asId = (r,s) => (r===14?"A":r===13?"K":r===12?"Q":r===11?"J":r===10?"T":String(r)) + s;
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push(asId(r,s));
  return deck;
}
function shuffle(a) {
  const arr = a.slice();
  for (let i=arr.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ========================= UI atoms (sesuai App.jsx) ========================= */

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
      {play
        ? play.hidden
          ? <SimpleCardBack small />
          : <SimpleCardFace card={cardFromId(play.card)} />
        : null}
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

  // presence
  const [online, setOnline] = useState([]);
  // occupants untuk label kursi
  const [seats, setSeats] = useState([]); // [{seat, display_name, user_id}]
  // info room (host id)
  const [roomInfo, setRoomInfo] = useState(null);

  // current user
  const meRef = useRef(null);

  // game state client
  const [g, setG] = useState({
    round: 1,
    dealer: 0,
    phase: "bidding", // "bidding" | "play"
    currentPlayer: 0,
    leadSuit: null,
    trump: null,
    bids: [null, null, null, null], // {count,suit,rank} | null
    bidsRevealed: false,
    targets: [0,0,0,0],
    table: [], // [{player, card:"AS"}]
    tricksWon: [0,0,0,0],
    myHand: [],
    oppCounts: [13,13,13], // jumlah kartu lawan (dummy UI)
  });

  // channel ref
  const chRef = useRef(null);

  // ---------- initial data ----------
  useEffect(() => {
    (async () => {
      const u = await getUser();
      meRef.current = u;
      const [seatsRows, st] = await Promise.all([fetchSeats(roomId), fetchState(roomId)]);
      setSeats(seatsRows);
      setRoomInfo(st);
    })();
  }, [roomId]);

  // presence
  useEffect(() => {
    let ctrl;
    (async () => {
      ctrl = await joinRoomPresence(roomId, { at: Date.now() }, setOnline);
    })();
    return () => ctrl?.leave?.();
  }, [roomId]);

  const isHost = !!roomInfo?.created_by && meRef.current?.id === roomInfo.created_by;

  // ---------- realtime channel ----------
  useEffect(() => {
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
        table: (s.table || []).map(t => ({ ...t })),
      }));
    });

    // PRIVATE HAND (khusus user)
    ch.on("broadcast", { event: "hand" }, ({ payload }) => {
      // mendukung payload: {to, cards:[...]} atau langsung array
      const userId = payload?.to;
      const cards = Array.isArray(payload?.cards) ? payload.cards : payload;
      if (userId && userId !== meRef.current?.id) return;
      if (!Array.isArray(cards)) return;
      setG((o) => ({ ...o, myHand: cards.map(cardFromId) }));
    });

    // subscribe → minta sync
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.send({ type: "broadcast", event: "sync", payload: { hello: "sync" } });
      }
    });

    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

  // ---------- Host Controller ----------
  useHostController(isHost, roomId, seats, chRef);

  // ---------- Derived ----------
  const handBySuit = useMemo(() => {
    const map = { C: [], D: [], H: [], S: [] };
    for (const c of g.myHand || []) map[c.suit].push(c.rank);
    for (const k of Object.keys(map)) map[k] = Array.from(new Set(map[k])).sort((a, b) => a - b);
    return map;
  }, [g.myHand]);

  const allBidsIn = g.bids.every(Boolean);
  const sumBids = g.bids.reduce((a, b) => a + (b?.count || 0), 0);

  const leaderboard = useMemo(() => {
    return [0,1,2,3]
      .map((i) => ({
        i,
        name: seats.find(s=>s.seat===i)?.display_name || SeatName[i],
        score: 0
      }))
      .sort((a,b)=>b.score-a.score);
  }, [seats]);

  // ---------- Actions (client → host) ----------
  function submitBid(suit, rank) {
    const bid = { count: betFromRank(rank), suit, rank };
    chRef.current?.send({ type: "broadcast", event: "bid", payload: bid });
  }

  function playCard(card) {
    if (g.phase !== "play") return;
    chRef.current?.send({ type: "broadcast", event: "play_card", payload: card.id });
  }

  // ---------- UI ----------
  const targetOrDash = (i) => (g.phase === "play" && g.targets[i] !== undefined ? g.targets[i] : "–");

  return (
    <div className="min-h-screen w-screen bg-zinc-900 text-stone-800">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-4">
        <header className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Link to={`/room/${roomId}`} className="text-stone-300 text-sm underline">← Lobby</Link>
            <h1 className="text-3xl font-extrabold text-amber-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.7)]">
              Trufman
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-stone-300 text-sm">
              Room: <span className="tabular-nums">{roomId.slice(0,8)}</span> • Ronde: {g.round} • Dealer: P{g.dealer+1}
            </div>
            <div className="text-xs text-stone-300">
              Online: {online.length} — {online.map(o => o.display_name || "Player").join(", ")}
            </div>
          </div>
        </header>

        {/* BOARD */}
        <div className="relative mx-auto w-full max-w-[1200px] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-800 to-red-950 rounded-2xl shadow-inner border-4 border-zinc-950 min-h-[560px] overflow-hidden">

          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-stone-200 font-semibold drop-shadow">
            {(seats.find(s=>s.seat===2)?.display_name || SeatName[2])} • {g.tricksWon[2]}/{targetOrDash(2)}
          </div>
          <div className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-stone-200 font-semibold drop-shadow">
            {(seats.find(s=>s.seat===1)?.display_name || SeatName[1])} • {g.tricksWon[1]}/{targetOrDash(1)}
          </div>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-stone-200 font-semibold drop-shadow">
            {(seats.find(s=>s.seat===3)?.display_name || SeatName[3])} • {g.tricksWon[3]}/{targetOrDash(3)}
          </div>

          {/* Kartu belakang lawan */}
          <div className="absolute top-10 left-1/2 -translate-x-1/2 flex gap-2">
            {Array.from({ length: g.oppCounts[1] ?? 13 }).map((_, i) => <SimpleCardBack key={`t-${i}`} small />)}
          </div>
          <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {Array.from({ length: g.oppCounts[0] ?? 13 }).map((_, i) => <SimpleCardBack key={`l-${i}`} vertical small />)}
          </div>
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {Array.from({ length: g.oppCounts[2] ?? 13 }).map((_, i) => <SimpleCardBack key={`r-${i}`} vertical small />)}
          </div>

          {/* Meja tengah */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-80 h-64">
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-auto">
                <TableSlot play={g.table.find(t => t.player === 0)} />
              </div>
              <div className="absolute left-0 top-1/2 -translate-y-1/2 pointer-events-auto">
                <TableSlot play={g.table.find(t => t.player === 1)} />
              </div>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-auto">
                <TableSlot play={g.table.find(t => t.player === 2)} />
              </div>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-auto">
                <TableSlot play={g.table.find(t => t.player === 3)} />
              </div>
            </div>
          </div>

          {/* kartu kita */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[95%]">
            <div className="mb-2 text-center text-stone-200 font-semibold drop-shadow">
              {(seats.find(s=>s.seat===0)?.display_name || "Kamu")} • {g.tricksWon[0]}/{targetOrDash(0)}
            </div>
            <div className="flex flex-wrap gap-2 items-center justify-center">
              {(g.myHand || []).map((c) => (
                <CardFace
                  key={c.id}
                  card={c}
                  disabled={g.phase !== "play"}
                  onClick={() => playCard(c)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Info bar */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge>Fase: {g.phase}</Badge>
          <Badge>Giliran: P{(g.currentPlayer ?? 0)+1}</Badge>
          <Badge>Lead: {g.leadSuit ? suitIcon(g.leadSuit) : "–"}</Badge>
          <Badge>Truf: {g.trump ? suitIcon(g.trump) : "–"}</Badge>
          <Badge>Total Bet: {g.bidsRevealed ? `${sumBids}/13` : "—/13"}</Badge>
        </div>

        {/* Bidding */}
        {g.phase === "bidding" && (
          <div className="mx-auto w/full max-w-[1200px] mt-3 grid md:grid-cols-4 gap-3">
            {[0,1,2,3].map((p) => {
              const bid = g.bids[p];
              const isYou = p===0;
              const bidCard = bid
                ? { id:`BID${p}`, suit:bid.suit, rank:bid.rank, label:`${rankLabel(bid.rank)}${suitIcon(bid.suit)}`, suitIcon:suitIcon(bid.suit) }
                : null;
              return (
                <div key={p} className="bg-zinc-800 rounded-xl shadow p-3 text-stone-100">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">
                      {seats.find(s=>s.seat===p)?.display_name || `P${p+1}`} {isYou ? "(Kamu)" : ""}
                    </div>
                    <Badge>Bid: {bid ? (g.bidsRevealed ? `${bid.count}${suitIcon(bid.suit)}` : "...") : "..."}</Badge>
                  </div>

                  {bid ? (
                    <div className="h-10 flex items-center">
                      {g.bidsRevealed ? <SimpleCardFace card={bidCard} /> : <SimpleCardBack small />}
                      <span className="ml-2 text-xs text-stone-400">
                        {g.bidsRevealed ? "Terbuka" : "Menunggu..."}
                      </span>
                    </div>
                  ) : (
                    isYou ? (
                      <PlayerBidForm handBySuit={handBySuit} onSubmit={submitBid} disabled={!!g.bids[0]} />
                    ) : (
                      <div className="text-stone-400 text-sm h-10 flex items-center">Menunggu...</div>
                    )
                  )}
                </div>
              );
            })}
            <div className="md:col-span-4 flex justify-end">
              <button
                className="px-4 py-2 rounded-xl text-white font-bold transition disabled:bg-zinc-600 bg-red-700 hover:bg-red-600"
                onClick={() => chRef.current?.send({ type:"broadcast", event:"start_play" })}
                disabled={!allBidsIn}
              >
                Mulai Main
              </button>
            </div>
          </div>
        )}

        {/* Leaderboard dummy */}
        <div className="mt-4 grid md:grid-cols-2 gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[0,1,2,3].map((p) => (
              <div key={p} className="bg-zinc-800 rounded-xl shadow p-3">
                <div className="flex items-center justify-between text-stone-100">
                  <div className="font-semibold">
                    {p===0 ? "Skor Kamu" : `Skor ${(seats.find(s=>s.seat===p)?.display_name || SeatName[p])}`}
                  </div>
                  <Badge>Total: 0</Badge>
                </div>
                <div className="mt-1 text-sm text-stone-300 grid grid-cols-2 gap-1">
                  <div>Bid</div>
                  <div className="text-right">
                    {g.bids[p] ? (g.bidsRevealed ? `${g.bids[p].count}${suitIcon(g.bids[p].suit)}` : "...") : "–"}
                  </div>
                  <div>Target</div>
                  <div className="text-right">{g.targets[p] ?? "–"}</div>
                  <div>Trik</div>
                  <div className="text-right">{g.tricksWon[p] ?? 0}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-zinc-800 rounded-xl shadow p-3">
            <h3 className="font-semibold text-stone-100 mb-2">Leaderboard</h3>
            <ol className="space-y-1">
              {leaderboard.map((row, idx) => (
                <li key={row.i} className="flex items-center justify-between text-sm p-1 rounded-md bg-zinc-700/50">
                  <span className="flex items-center gap-2 text-stone-200">
                    <span className={`inline-flex w-6 h-6 items-center justify-center rounded-full font-bold ${idx===0?'bg-amber-400 text-zinc-900':'bg-zinc-600'}`}>{idx+1}</span>
                    <span>{row.name}</span>
                  </span>
                  <span className="font-semibold text-stone-100">0 Poin</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================= Host Controller hook ========================= */

function useHostController(isHost, roomId, seats, chRef) {
  const hostState = useRef(null); // {publicState, hands: {0:[],1:[],2:[],3:[]}}
  const seatOf = (userId) => seats.find(s=>s.user_id===userId)?.seat ?? null;

  // send helpers
  const sendState = () => {
    if (!hostState.current) return;
    chRef.current?.send({
      type: "broadcast",
      event: "state",
      payload: hostState.current.publicState,
    });
  };
  const sendHandToSeat = async (seat) => {
    const userId = seats.find(s=>s.seat===seat)?.user_id;
    if (!userId) return;
    const cards = hostState.current?.hands?.[seat] || [];
    chRef.current?.send({
      type: "broadcast",
      event: "hand",
      payload: { to: userId, cards },
    });
  };
  const sendAllHands = () => [0,1,2,3].forEach(sendHandToSeat);

  const startNewRound = () => {
    // deal
    const deck = shuffle(makeDeck());
    const hands = { 0:[],1:[],2:[],3:[] };
    for (let i=0;i<52;i++) hands[i%4].push(deck[i]);
    // sort hands a bit for nicer UI
    for (let s of [0,1,2,3]) {
      hands[s].sort((a,b)=>{
        const A=cardFromId(a), B=cardFromId(b);
        if (A.suit!==B.suit) return suitOrder[A.suit]-suitOrder[B.suit];
        return A.rank-B.rank;
      });
    }
    const prev = hostState.current?.publicState;
    const round = prev ? prev.round+1 : 1;
    const dealer = prev ? (prev.dealer+1)%4 : 0;

    hostState.current = {
      hands,
      publicState: {
        round,
        dealer,
        phase: "bidding",
        currentPlayer: (dealer+1)%4,
        leadSuit: null,
        trump: null,
        bids: [null,null,null,null],
        bidsRevealed: false,
        targets: [0,0,0,0],
        table: [],
        tricksWon: [0,0,0,0],
        oppCounts: [13,13,13],
      }
    };
  };

  // winner of a trick
  const trickWinner = (table, trump, lead) => {
    const strength = (id) => {
      const c = cardFromId(id);
      return (c.suit===trump?3:c.suit===lead?2:0)*100 + c.rank;
    };
    let best = table[0];
    for (let i=1;i<table.length;i++) {
      if (strength(table[i].card) > strength(best.card)) best = table[i];
    }
    return best.player;
  };

  useEffect(() => {
    if (!isHost || !chRef.current) return;

    // event handlers only host cares
    const onSync = () => {
      if (!hostState.current) startNewRound();
      sendState();
      sendAllHands();
    };

    const onBid = async ({ payload, sender }) => {
      if (!hostState.current) return;
      const seat = seatOf(sender?.user_id);
      if (seat==null) return;
      const b = { count: Number(payload.count)||0, suit: payload.suit, rank: payload.rank };
      hostState.current.publicState.bids[seat] = b;

      // jika semua bid masuk → tentukan trump sederhana (rank tertinggi, tie by suitOrder)
      const bids = hostState.current.publicState.bids;
      if (bids.every(Boolean)) {
        let bestIdx = 0;
        for (let i=1;i<4;i++){
          const bi=bids[i], bb=bids[bestIdx];
          if (bi.rank>bb.rank || (bi.rank===bb.rank && suitOrder[bi.suit]>suitOrder[bb.suit])) bestIdx=i;
        }
        hostState.current.publicState.trump = bids[bestIdx].suit;
        hostState.current.publicState.targets = bids.map(x=>x.count);
      }
      sendState();
    };

    const onStartPlay = () => {
      if (!hostState.current) return;
      hostState.current.publicState.phase = "play";
      hostState.current.publicState.bidsRevealed = true;
      sendState();
      sendAllHands();
    };

    const onPlayCard = ({ payload, sender }) => {
      if (!hostState.current) return;
      const seat = seatOf(sender?.user_id);
      if (seat==null) return;

      const st = hostState.current.publicState;
      if (st.phase !== "play") return;
      if (seat !== st.currentPlayer) return; // bukan giliranmu

      // cek kartu ada di tangan
      const hand = hostState.current.hands[seat];
      const idx = hand.indexOf(payload);
      if (idx === -1) return;

      // lead suit set saat kartu pertama di meja
      if (st.table.length===0) st.leadSuit = cardFromId(payload).suit;

      // (opsional) validasi follow suit bisa ditambah di sini

      hand.splice(idx,1); // remove from hand
      st.table.push({ player: seat, card: payload });

      // update turn
      st.currentPlayer = (st.currentPlayer+1)%4;

      // selesai satu trik?
      if (st.table.length===4) {
        const win = trickWinner(st.table, st.trump, st.leadSuit);
        st.tricksWon[win] += 1;
        st.table = [];
        st.leadSuit = null;
        st.currentPlayer = win;
      }

      sendState();
      // kirim hand baru ke seat terkait
      sendHandToSeat(seat);
    };

    const ch = chRef.current;

    // host listens with sender metadata
    ch.on("broadcast", { event: "sync" }, onSync);
    ch.on("broadcast", { event: "bid" }, onBid);
    ch.on("broadcast", { event: "start_play" }, onStartPlay);
    ch.on("broadcast", { event: "play_card" }, onPlayCard);

    return () => {
      ch.off("broadcast", { event: "sync" });
      ch.off("broadcast", { event: "bid" });
      ch.off("broadcast", { event: "start_play" });
      ch.off("broadcast", { event: "play_card" });
    };
  }, [isHost, seats, chRef]);
}
