import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Trufman (4 Pemain)
 * - Bid dipilih dari kartu yang dimiliki (rank→count: 2–10=nilai, J/Q/K=0, A=1)
 * - Truf = bid tertinggi (seri: C < D < H < S)
 * - Mode: total bet > 13 → ATAS; <13 → BAWAH (target = bid−1; =13 dianggap ATAS)
 * - Main: wajib ikut suit; tak boleh lead truf sebelum broken (kecuali kartu di tangan tinggal truf)
 * - Trump Broken: saat void lalu buang truf, atau lead truf (sah)
 * - Play: kartu truf disembunyikan; dibuka saat 4 kartu lengkap → jeda → resolve
 * - Skor: tepat +target; kurang −selisih; lebih ATAS −selisih, BAWAH −2×selisih
 */

const SUITS = [
  { key: "C", label: "Clover", icon: "♣" },
  { key: "D", label: "Diamond", icon: "♦" },
  { key: "H", label: "Heart", icon: "♥" },
  { key: "S", label: "Spade", icon: "♠" },
];
const suitOrder = { C: 0, D: 1, H: 2, S: 3 };
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const rankLabel = (r) => (r <= 10 ? String(r) : ({ 11: "J", 12: "Q", 13: "K", 14: "A" }[r]));
const betFromRank = (rank) => (rank === 14 ? 1 : (rank >= 11 && rank <= 13 ? 0 : rank));

function makeDeck() {
  const cards = [];
  for (const s of SUITS)
    for (const r of RANKS)
      cards.push({ id: `${s.key}${r}`, suit: s.key, suitIcon: s.icon, rank: r, label: `${rankLabel(r)}${s.icon}` });
  return cards;
}
function shuffle(a0) {
  const a = [...a0];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function deal(deck) {
  const hands = [[], [], [], []];
  for (let i = 0; i < 52; i++) hands[i % 4].push(deck[i]);
  for (let p = 0; p < 4; p++)
    hands[p].sort((a, b) => (a.suit === b.suit ? b.rank - a.rank : suitOrder[a.suit] - suitOrder[b.suit]));
  return hands;
}
function evaluateTrick(plays, trumpSuit, leadSuit) {
  const isTrump = (c) => c.suit === trumpSuit;
  const isLead = (c) => c.suit === leadSuit;
  let winner = plays[0];
  for (const pl of plays.slice(1)) {
    const c = pl.card, w = winner.card;
    if (isTrump(c) && !isTrump(w)) winner = pl;
    else if (isTrump(c) && isTrump(w) && c.rank > w.rank) winner = pl;
    else if (!isTrump(c) && !isTrump(w)) {
      if (isLead(c) && !isLead(w)) winner = pl;
      else if (isLead(c) && isLead(w) && c.rank > w.rank) winner = pl;
    }
  }
  return winner.player;
}

// ===== Bot helpers =====
function countBySuit(hand) {
  return hand.reduce((m, c) => ((m[c.suit] = (m[c.suit] || 0) + 1), m), {});
}
function botChooseBid(hand) {
  const counts = countBySuit(hand);
  const bestSuit =
    Object.keys(counts).sort((a, b) => counts[b] - counts[a] || suitOrder[b] - suitOrder[a])[0] || hand[0].suit;
  const options = hand
    .filter((c) => c.suit === bestSuit)
    .map((c) => ({ rank: c.rank, count: betFromRank(c.rank) }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  const pick = options[0] || { rank: hand[0].rank, count: betFromRank(hand[0].rank) };
  return { count: pick.count, suit: bestSuit, rank: pick.rank };
}
function botPlayCard(hand, leadSuit, trump) {
  const asc = (a, b) => a.rank - b.rank;
  const hasLead = leadSuit && hand.some((c) => c.suit === leadSuit);
  if (!leadSuit) {
    const nonTrump = hand.filter((c) => c.suit !== trump).sort(asc);
    if (nonTrump.length) return nonTrump[0];
    return hand.slice().sort(asc)[0];
  }
  if (hasLead) return hand.filter((c) => c.suit === leadSuit).sort(asc)[0];
  const trumps = hand.filter((c) => c.suit === trump).sort(asc);
  if (trumps.length) return trumps[0];
  return hand.slice().sort(asc)[0];
}

const SeatName = ["Kamu", "Albert", "Harriet", "Cleopatra"];

export default function TrufmanApp() {
  // round & dealer
  const [round, setRound] = useState(1);
  const [dealer, setDealer] = useState(0);
  const [totalScores, setTotalScores] = useState([0, 0, 0, 0]);

  // deck & hands
  const freshDeck = useMemo(() => shuffle(makeDeck()), [round]);
  const initialHands = useMemo(() => deal(freshDeck), [round]);
  const [hands, setHands] = useState(initialHands);

  // bidding
  const [bids, setBids] = useState([null, null, null, null]); // {count, suit, rank}
  const [bidsRevealed, setBidsRevealed] = useState(false);
  const [trump, setTrump] = useState(null);
  const [mode, setMode] = useState(null);
  const [targets, setTargets] = useState([0, 0, 0, 0]);
  const [phase, setPhase] = useState("bidding");
  const [trumpBroken, setTrumpBroken] = useState(false);

  // play
  const [currentPlayer, setCurrentPlayer] = useState((dealer + 1) % 4);
  const [leadSuit, setLeadSuit] = useState(null);
  const [table, setTable] = useState([]); // {player, card, hidden}
  const [tricksWon, setTricksWon] = useState([0, 0, 0, 0]);
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);

  // delays (slider)
  const [resolveDelayMs, setResolveDelayMs] = useState(1200);
  const [botDelayMs, setBotDelayMs] = useState(600);

  // timers (UI)
  const [resolveCountdownMs, setResolveCountdownMs] = useState(0);
  const [botCountdownMs, setBotCountdownMs] = useState(0);

  // derived
  const allBidsIn = bids.every(Boolean);
  const sumBids = bids.reduce((a, b) => a + (b?.count || 0), 0);
  const highestBidIdx = allBidsIn
    ? bids.reduce((best, b, i) => {
        if (best === -1) return i;
        const cur = bids[best];
        if (b.count > cur.count) return i;
        if (b.count === cur.count && suitOrder[b.suit] > suitOrder[cur.suit]) return i;
        return best;
      }, -1)
    : -1;

  // Player bid options
  const handBySuit = useMemo(() => {
    const map = { C: [], D: [], H: [], S: [] };
    for (const c of hands[0] || []) map[c.suit].push(c.rank);
    for (const k of Object.keys(map)) map[k] = Array.from(new Set(map[k])).sort((a, b) => a - b);
    return map;
  }, [hands]);

  function setPlayerBid(suit, rank) {
    if (!rank || !suit) return;
    const valid = handBySuit[suit]?.includes(Number(rank));
    if (!valid) return;
    const nb = [...bids];
    nb[0] = { count: betFromRank(Number(rank)), suit, rank: Number(rank) };
    setBids(nb);
  }

  // bots bidding
  useEffect(() => {
    if (phase !== "bidding") return;
    const nb = [...bids];
    for (let p = 1; p <= 3; p++) if (!nb[p]) nb[p] = botChooseBid(hands[p]);
    setBids(nb);
  }, [phase, hands]);

  // reveal bids serentak
  useEffect(() => {
    if (phase !== "bidding") return;
    if (allBidsIn && !bidsRevealed) setBidsRevealed(true);
  }, [allBidsIn, phase, bidsRevealed]);

  function startPlay() {
    if (!allBidsIn) return;
    const trumpKey = bids[highestBidIdx].suit;
    setTrump(trumpKey);
    const below = sumBids < 13;
    setMode(below ? "BAWAH" : "ATAS");
    const tgt = bids.map((b) => (below ? Math.max(0, b.count - 1) : b.count + 1));
    setTargets(tgt);

    setPhase("play");
    setCurrentPlayer((dealer + 1) % 4);
    setLeadSuit(null);
    setTable([]);
    setTricksWon([0, 0, 0, 0]);
    setTrumpBroken(false);

    // reset resolver state
    setResolving(false);
    resolvingRef.current = false;
    setResolveCountdownMs(0);
    setBotCountdownMs(0);
  }

  // rules
  function canPlay(pid, card) {
    if (phase !== "play") return false;
    if (resolving) return false;
    if (pid !== currentPlayer) return false;

    if (!leadSuit) {
      if (card.suit === trump && !trumpBroken) {
        const hasNonTrump = hands[pid].some((c) => c.suit !== trump);
        if (hasNonTrump) return false;
      }
      return true;
    }

    const hasLead = hands[pid].some((c) => c.suit === leadSuit);
    if (hasLead) return card.suit === leadSuit;
    return true;
  }

  function commitPlay(pid, card) {
    if (resolving) return;
    setHands((H) => H.map((h, i) => (i === pid ? h.filter((c) => c.id !== card.id) : h)));

    const isTrumpCard = card.suit === trump;
    setTable((t) => [...t, { player: pid, card, hidden: isTrumpCard }]);

    if (!leadSuit) setLeadSuit(card.suit);

    // break trump
    if ((leadSuit && card.suit === trump && leadSuit !== trump) || (!leadSuit && card.suit === trump)) {
      setTrumpBroken(true);
    }

    const willLen = table.length + 1;
    if (willLen < 4) setCurrentPlayer((pid + 1) % 4); // jangan oper saat kartu ke-4
  }

  function onClickCard(card) {
    if (!canPlay(0, card)) return;
    commitPlay(0, card);
  }

  // bot autoplay + countdown
  useEffect(() => {
    if (phase !== "play" || resolving || table.length === 4 || currentPlayer === 0) {
      setBotCountdownMs(0);
      return;
    }
    const pid = currentPlayer;

    setBotCountdownMs(botDelayMs);
    const start = Date.now();
    const iv = setInterval(() => {
      const remain = Math.max(0, botDelayMs - (Date.now() - start));
      setBotCountdownMs(remain);
    }, 100);

    const timer = setTimeout(() => {
      const card = botPlayCard(hands[pid], leadSuit, trump);
      if (card) commitPlay(pid, card);
    }, botDelayMs);

    return () => {
      clearTimeout(timer);
      clearInterval(iv);
    };
  }, [currentPlayer, phase, hands, leadSuit, trump, resolving, table.length, botDelayMs]);

  // resolve trick (freeze → buka → delay → tentukan pemenang)
  useEffect(() => {
    if (phase !== "play") return;
    if (table.length !== 4) return;        // persis 4 kartu
    if (resolvingRef.current) return;      // sudah mulai? skip

    resolvingRef.current = true;           // lock
    setResolving(true);

    // buka kartu yang hidden (sekali saja, tidak mengubah length)
    setTable((prev) => {
      let changed = false;
      const next = prev.map((p) => (p.hidden ? ((changed = true), { ...p, hidden: false }) : p));
      return changed ? next : prev;
    });

    // snapshot 4 kartu sekarang
    const snapshot = [...table];

    // countdown UI
    if (resolveDelayMs > 0) {
      setResolveCountdownMs(resolveDelayMs);
      const start = Date.now();
      var iv = setInterval(() => {
        const remain = Math.max(0, resolveDelayMs - (Date.now() - start));
        setResolveCountdownMs(remain);
      }, 100);
    }

    const to = setTimeout(() => {
      const winner = evaluateTrick(snapshot, trump, leadSuit);
      setTable([]);
      setLeadSuit(null);
      setCurrentPlayer(winner);
      setTricksWon((tw) => {
        const t2 = [...tw];
        t2[winner] += 1;
        return t2;
      });
      setResolving(false);
      resolvingRef.current = false;        // unlock untuk trick berikut
      setResolveCountdownMs(0);
      if (iv) clearInterval(iv);
    }, resolveDelayMs);

    return () => {
      clearTimeout(to);
      if (iv) clearInterval(iv);
    };
    // ⬇ depend ke length supaya tidak re-run saat buka kartu (hidden→false)
  }, [phase, table.length, resolveDelayMs, trump, leadSuit]);

  const roundFinished = phase === "play" && hands.every((h) => h.length === 0);

  function roundScores() {
    const s = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const got = tricksWon[i];
      const tgt = targets[i];
      if (got === tgt) s[i] = tgt;
      else if (got < tgt) s[i] = mode === "ATAS" ? -2 * (tgt - got) : -(tgt - got); // ⬅ dobel kalau ATAS
      else s[i] = mode === "BAWAH" ? -2 * (got - tgt) : -(got - tgt);
    }
    return s;
  }

  function nextRound() {
    const rs = roundScores();
    setTotalScores((ts) => ts.map((v, i) => v + rs[i]));
    setDealer((d) => (d + 1) % 4);
    setRound((r) => r + 1);

    // reset semua
    const deck2 = shuffle(makeDeck());
    const h2 = deal(deck2);
    setHands(h2);
    setBids([null, null, null, null]);
    setBidsRevealed(false);
    setTrump(null);
    setMode(null);
    setTargets([0, 0, 0, 0]);
    setPhase("bidding");
    setCurrentPlayer((dealer + 2) % 4);
    setLeadSuit(null);
    setTable([]);
    setTricksWon([0, 0, 0, 0]);
    setTrumpBroken(false);
    setResolving(false);
    resolvingRef.current = false;
    setResolveCountdownMs(0);
    setBotCountdownMs(0);
  }

  const leaderboard = useMemo(() => {
    return [0, 1, 2, 3]
      .map((i) => ({ i, name: i === 0 ? "Kamu" : SeatName[i], score: totalScores[i] }))
      .sort((a, b) => b.score - a.score);
  }, [totalScores]);

  const targetOrDash = (i) => (phase === "play" && targets[i] !== undefined ? targets[i] : "–");
  const sec = (ms) => (ms / 1000).toFixed(1) + "s";

  return (
    <div className="min-h-screen w-screen bg-green-900 text-slate-800">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-4">
        <header className="flex items-center justify-between mb-3">
          <h1 className="text-3xl font-extrabold text-emerald-200 drop-shadow">Trufman — Prototype</h1>
          <div className="text-emerald-100 text-sm">Dealer: P{dealer + 1} • Ronde: {round}</div>
        </header>

        {/* TABLE */}
        <div className="relative mx-auto w-full max-w-[1200px] bg-green-700 rounded-2xl shadow-inner border-4 border-green-800 min-h-[560px] overflow-hidden">

          {/* Top name + packs */}
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-emerald-100 font-semibold">
            {SeatName[2]} • {tricksWon[2]}/{targetOrDash(2)}
          </div>
          {/* Left name + packs */}
          <div className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-emerald-100 font-semibold">
            {SeatName[1]} • {tricksWon[1]}/{targetOrDash(1)}
          </div>
          {/* Right name + packs */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-emerald-100 font-semibold">
            {SeatName[3]} • {tricksWon[3]}/{targetOrDash(3)}
          </div>

          {/* Bot hands (backs) */}
          <div className="absolute top-10 left-1/2 -translate-x-1/2 flex gap-2">
            {hands[2]?.map((_, i) => <CardBack key={i} small />)}
          </div>
          <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {hands[1]?.map((_, i) => <CardBack key={i} vertical small />)}
          </div>
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {hands[3]?.map((_, i) => <CardBack key={i} vertical small />)}
          </div>

          {/* Center table cards */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="grid grid-cols-2 gap-6">
              <TableSlot label="P2" play={table.find((t) => t.player === 1)} />
              <TableSlot label="P3" play={table.find((t) => t.player === 2)} />
              <TableSlot label="P1" play={table.find((t) => t.player === 0)} />
              <TableSlot label="P4" play={table.find((t) => t.player === 3)} />
            </div>
          </div>

          {/* Resolve Countdown Overlay */}
          <CountdownOverlay
            visible={resolving && resolveDelayMs > 0}
            ms={resolveCountdownMs}
            total={resolveDelayMs}
          />

          {/* Bottom player hand */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-[95%]">
            <div className="mb-1 text-center text-emerald-100 font-semibold">
              Kamu • {tricksWon[0]}/{targetOrDash(0)}
            </div>
            <div className="flex flex-wrap gap-2 items-center justify-center">
              {hands[0]?.map((c) => (
                <CardFace
                  key={c.id}
                  card={c}
                  disabled={!canPlay(0, c)}
                  onClick={() => onClickCard(c)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Info bar + sliders + timers */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Badge>Phase: {phase}</Badge>
          <Badge>Giliran: P{currentPlayer + 1}</Badge>
          <Badge>Lead: {leadSuit ? SUITS.find((s) => s.key === leadSuit)?.icon : "–"}</Badge>
          <Badge>Truf: {trump ? SUITS.find((s) => s.key === trump)?.icon : "–"}</Badge>
          <Badge>Trump Broken: {trumpBroken ? "Ya" : "Belum"}</Badge>
          <Badge>Mode: {mode || "–"}</Badge>
          <Badge>Total Bet: {sumBids}/13</Badge>
          <Badge>Packs: {[0,1,2,3].map((p)=>`${tricksWon[p]}/${targetOrDash(p)}`).join(" · ")}</Badge>

          <Badge>Resolve Timer: {resolving ? sec(resolveCountdownMs) : "—"}</Badge>
          <Badge>Bot Timer: {(phase==="play" && currentPlayer!==0 && !resolving && table.length<4) ? sec(botCountdownMs) : "—"}</Badge>

          <div className="w-full mt-2 grid md:grid-cols-2 gap-3">
            <div className="bg-white rounded-xl shadow p-3 flex items-center gap-3">
              <label htmlFor="revealDelay" className="text-slate-700 font-medium whitespace-nowrap">Reveal Delay</label>
              <input
                id="revealDelay" type="range" min={400} max={2000} step={100}
                value={resolveDelayMs} onChange={(e) => setResolveDelayMs(Number(e.target.value))}
                className="flex-1 accent-emerald-600"
              />
              <span className="text-slate-600 w-14 text-right">{sec(resolveDelayMs)}</span>
            </div>
            <div className="bg-white rounded-xl shadow p-3 flex items-center gap-3">
              <label htmlFor="botDelay" className="text-slate-700 font-medium whitespace-nowrap">Bot Delay</label>
              <input
                id="botDelay" type="range" min={200} max={1200} step={100}
                value={botDelayMs} onChange={(e) => setBotDelayMs(Number(e.target.value))}
                className="flex-1 accent-emerald-600"
              />
              <span className="text-slate-600 w-14 text-right">{sec(botDelayMs)}</span>
            </div>
          </div>
        </div>

        {/* Bidding panel (tertutup → reveal serentak) */}
        {phase === "bidding" && (
          <div className="mx-auto w/full max-w-[1200px] mt-3 grid md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((p) => {
              const bid = bids[p];
              const isYou = p === 0;
              const suitIcon = bid ? SUITS.find((s) => s.key === bid.suit)?.icon : "";
              const bidCard = bid ? { id: `BID${p}`, suit: bid.suit, rank: bid.rank, label: `${rankLabel(bid.rank)}${suitIcon}` } : null;
              return (
                <div key={p} className="bg-white rounded-xl shadow p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold">P{p + 1} {isYou ? "(Kamu)" : "(Bot)"}</div>
                    <Badge>Bid: {bid ? (bidsRevealed ? `${bid.count}${suitIcon}` : "—") : "—"}</Badge>
                  </div>

                  {bid ? (
                    <div className="h-10 flex items-center">
                      {bidsRevealed ? <CardFace card={bidCard} disabled /> : <CardBack small />}
                      <span className="ml-2 text-xs text-slate-500">{bidsRevealed ? "Terbuka" : "Tertutup"}</span>
                    </div>
                  ) : (
                    isYou ? (
                      <PlayerBidForm handBySuit={handBySuit} setBid={setPlayerBid} disabled={!!bids[0]} />
                    ) : (
                      <div className="text-slate-500 text-sm">Bot sedang memilih…</div>
                    )
                  )}
                </div>
              );
            })}
            <div className="md:col-span-4 flex justify-end">
              <button
                className={`px-4 py-2 rounded-xl text-white ${allBidsIn ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-400"}`}
                onClick={startPlay}
                disabled={!allBidsIn}
              >
                Mulai Main
              </button>
            </div>
          </div>
        )}

        {/* Scores */}
        <div className="mt-3 grid md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((p) => (
            <div key={p} className="bg-white rounded-xl shadow p-3">
              <div className="flex items-center justify-between">
                <div className="font-semibold">P{p + 1}</div>
                <Badge>Total: {totalScores[p]}</Badge>
              </div>
              <div className="mt-1 text-sm text-slate-600 grid grid-cols-2 gap-1">
                <div>Bid</div>
                <div className="text-right">
                  {bids[p] ? (bidsRevealed ? `${bids[p].count}${SUITS.find((s) => s.key === bids[p].suit)?.icon}` : "—") : "—"}
                </div>
                <div>Target</div>
                <div className="text-right">{targets[p] ?? 0}</div>
                <div>Trik</div>
                <div className="text-right">{tricksWon[p] ?? 0}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Leaderboard */}
        <div className="mt-3 bg-white rounded-xl shadow p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold">Leaderboard</div>
            <div className="text-xs text-slate-500">Urut skor total tertinggi</div>
          </div>
          <ol className="space-y-1">
            {leaderboard.map((row, idx) => (
              <li key={row.i} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="inline-flex w-6 justify-center rounded-full bg-emerald-100 text-emerald-800">{idx+1}</span>
                  <span>{row.name} {row.i===0 && <em className="text-slate-400">(Kamu)</em>}</span>
                </span>
                <span className="font-semibold">{row.score}</span>
              </li>
            ))}
          </ol>
        </div>

        {roundFinished && (
          <RoundSummary
            mode={mode}
            trump={trump}
            bids={bids}
            targets={targets}
            tricksWon={tricksWon}
            onNext={nextRound}
          />
        )}
      </div>

      {/* Bot timer floating card */}
      <FloatingBotTimer
        visible={phase==="play" && currentPlayer!==0 && !resolving && table.length<4 && botDelayMs > 0}
        ms={botCountdownMs}
        player={currentPlayer}
      />
    </div>
  );
}

function Badge({ children }) {
  return <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-xs shadow-sm">{children}</span>;
}

function CardBack({ small, vertical }) {
  const cls = `bg-red-600 rounded-lg border-2 border-red-300 shadow ${small ? (vertical ? "h-6 w-4" : "h-6 w-4") : "h-10 w-7"}`;
  return <div className={cls} />;
}
function CardFace({ card, onClick, disabled }) {
  const red = card.suit === "H" || card.suit === "D";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1 rounded-lg border bg-white font-mono text-sm shadow ${disabled ? "opacity-100 cursor-not-allowed" : "hover:ring-2 hover:ring-emerald-400"}`}
      title={card.label}
    >
      <span className={red ? "text-rose-600" : "text-slate-800"}>{card.label}</span>
    </button>
  );
}
function TableSlot({ label, play }) {
  return (
    <div className="h-20 w-28 bg-green-800/40 rounded-xl border border-green-900 flex items-center justify-center">
      {play ? (play.hidden ? <CardBack small /> : <CardFace card={play.card} disabled />)
            : <span className="text-emerald-200 text-xs">{label}</span>}
    </div>
  );
}

function PlayerBidForm({ handBySuit, setBid, disabled }) {
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
      <label className="sr-only" htmlFor="bid-suit">Pilih suit</label>
      <select
        id="bid-suit"
        className={`rounded-xl border px-3 py-2 bg-white text-slate-900 shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-emerald-500
                    disabled:bg-slate-100 disabled:text-slate-400`}
        value={suit}
        onChange={(e) => setSuit(e.target.value)}
        disabled={disabled}
      >
        {SUITS.map((s) => (
          <option key={s.key} value={s.key}>{s.label} {s.icon}</option>
        ))}
      </select>

      <label className="sr-only" htmlFor="bid-rank">Pilih rank</label>
      <select
        id="bid-rank"
        className={`rounded-xl border px-3 py-2 bg-white text-slate-900 shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-emerald-500
                    disabled:bg-slate-100 disabled:text-slate-400`}
        value={rank}
        onChange={(e) => setRank(Number(e.target.value))}
        disabled={disabled || ranks.length === 0}
      >
        {ranks.length === 0 ? (
          <option>(tak ada)</option>
        ) : (
          ranks.map((r) => (
            <option key={r} value={r}>{rankLabel(r)} ({betFromRank(r)})</option>
          ))
        )}
      </select>

      <button
        type="button"
        className={`px-3 py-2 rounded-xl text-white transition
                    ${canSubmit ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-300 cursor-not-allowed"}`}
        disabled={!canSubmit}
        onClick={() => setBid(suit, rank)}
        title={canSubmit ? "Set bid kamu" : "Pilih suit & rank yang valid"}
      >
        Set
      </button>
    </div>
  );
}

function RoundSummary({ mode, trump, bids, targets, tricksWon, onNext }) {
  const scores = useMemo(() => {
    const s = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const got = tricksWon[i];
      const tgt = targets[i];
      if (got === tgt) s[i] = tgt;
      else if (got < tgt) s[i] = mode === "ATAS" ? -2 * (tgt - got) : -(tgt - got); // ⬅ dobel kalau ATAS
      else s[i] = mode === "BAWAH" ? -2 * (got - tgt) : -(got - tgt);
    }
    return s;
  }, [mode, targets, tricksWon]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold text-slate-800">Ronde Selesai</h2>
          <div className="text-sm text-slate-600">Mode: {mode} • Truf: {SUITS.find((s) => s.key === trump)?.icon}</div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-sm">
          {[0,1,2,3].map((p) => (
            <div key={p} className="rounded-xl border p-3 bg-slate-50">
              <div className="font-semibold mb-1">P{p+1}</div>
              <div>Bid: {bids[p].count}{SUITS.find((s)=>s.key===bids[p].suit)?.icon}</div>
              <div>Target: {targets[p]}</div>
              <div>Trik: {tricksWon[p]}</div>
              <div className={`font-semibold ${scores[p] >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Skor Ronde: {scores[p]}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onNext} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white">
            Lanjut Ronde Berikutnya
          </button>
        </div>
      </div>
    </div>
  );
}

/** === UI Bits: Countdown Overlays === */
function CountdownOverlay({ visible, ms, total }) {
  if (!visible || total <= 0) return null;
  const pct = total > 0 ? Math.max(0, Math.min(1, ms / total)) : 0; // 1→0
  const deg = (1 - pct) * 360;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
      <div
        className="relative w-32 h-32 rounded-full"
        style={{ background: `conic-gradient(rgba(16,185,129,0.95) ${deg}deg, rgba(255,255,255,0.15) 0deg)` }}
      >
        <div className="absolute inset-2 rounded-full bg-black/40 backdrop-blur-sm border border-emerald-300/40 flex items-center justify-center">
          <span className="text-emerald-100 text-3xl font-bold tabular-nums drop-shadow">
            {(ms / 1000).toFixed(1)}s
          </span>
        </div>
      </div>
    </div>
  );
}

function FloatingBotTimer({ visible, ms, player }) {
  if (!visible) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 bg-white/90 rounded-xl shadow px-4 py-3 border border-slate-200 backdrop-blur">
      <div className="text-xs text-slate-600">Bot P{player + 1} turn in</div>
      <div className="text-lg font-semibold tabular-nums">{(ms / 1000).toFixed(1)}s</div>
    </div>
  );
}
