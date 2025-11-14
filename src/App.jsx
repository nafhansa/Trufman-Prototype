// src/App.jsx
import { Link } from "react-router-dom";
import { cloudLoad, cloudSave, debounce } from './lib/cloudMemory.js'
import { createLearningBot } from "./bots/learningBot.js";
import React, { useEffect, useMemo, useRef, useState } from "react";

/* ========================= Audio helpers & URLs ========================= */
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

/* ========================= Game helpers ========================= */
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
function countBySuit(hand) {
  return hand.reduce((m, c) => ((m[c.suit] = (m[c.suit] || 0) + 1), m), {});
}
function botChooseBidFallback(hand) {
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
function botPlayCardFallback(hand, leadSuit, trump) {
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

const SeatName = ["Kamu", "Renjana", "Harriet", "Cleopatra"];

/* ========================= Main App ========================= */
export default function TrufmanApp() {
  // Round & dealer
  const [round, setRound] = useState(1);
  const [dealer, setDealer] = useState(0);
  const [totalScores, setTotalScores] = useState([0, 0, 0, 0]);

  // Deck & hands
  const freshDeck = useMemo(() => shuffle(makeDeck()), [round]);
  const initialHands = useMemo(() => deal(freshDeck), [round]);
  const [hands, setHands] = useState(initialHands);

  // Bidding
  const [bids, setBids] = useState([null, null, null, null]);
  const [bidsRevealed, setBidsRevealed] = useState(false);
  const [trump, setTrump] = useState(null);

  // Mode/targets per aturan baru
  const [mode, setMode] = useState(null);
  const [targets, setTargets] = useState([0, 0, 0, 0]);

  // Penentuan ATAS/BAWAH ketika total=13
  const [adjustPending, setAdjustPending] = useState(false);
  const [adjustDecider, setAdjustDecider] = useState(null); // seat index pemenang bidding
  const [showAdjustModal, setShowAdjustModal] = useState(false);

  // Play
  const [phase, setPhase] = useState("bidding");
  const [trumpBroken, setTrumpBroken] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState((dealer + 1) % 4);
  const [leadSuit, setLeadSuit] = useState(null);
  const [table, setTable] = useState([]);
  const [tricksWon, setTricksWon] = useState([0, 0, 0, 0]);

  // Resolver / timers
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const [resolveDelayMs, setResolveDelayMs] = useState(1200);
  const [botDelayMs, setBotDelayMs] = useState(600);
  const [resolveCountdownMs, setResolveCountdownMs] = useState(0);
  const [botCountdownMs, setBotCountdownMs] = useState(0);

  // LearningBot integration
  const [voidMap, setVoidMap] = useState([{}, {}, {}, {}]);
  const [trumpsPlayed, setTrumpsPlayed] = useState(0);
  const [played, setPlayed] = useState([]);
  const botRefs = useRef([]);
  const MEMKEY = 'trufman_bot_memory_v3';
  const seatsToSync = [1, 2, 3];
  const [cloudReady, setCloudReady] = useState(false);

  // How to
  const [showHowTo, setShowHowTo] = useState(false);

  // Background music & unlock
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const audioRef = useRef(null);
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio(MUSIC_URL);
      audioRef.current.loop = true;
      audioRef.current.volume = 0.3;
    }
  }, []);
  function unlockAudio() {
    try {
      const silent = new Audio();
      silent.muted = true;
      silent.play().catch(() => {});
    } catch (_) {}
    [SFX_CARD_NORMAL, SFX_CARD_TRUMP].forEach(src => {
      try {
        const a = new Audio(src);
        a.volume = 0;
        a.play().then(() => a.pause()).catch(() => {});
      } catch (_) {}
    });
  }
  useEffect(() => {
    window.addEventListener("click", unlockAudio, { once: true });
    return () => window.removeEventListener("click", unlockAudio);
  }, []);
  function toggleMusic() {
    if (!audioRef.current) return;
    if (isMusicPlaying) audioRef.current.pause();
    else audioRef.current.play().catch(() => {});
    setIsMusicPlaying(!isMusicPlaying);
  }

  // Cloud sync for bot memory
  async function syncDownAll() {
    for (const s of seatsToSync) {
      const payload = await cloudLoad(s);
      if (payload) {
        try { localStorage.setItem(`${MEMKEY}:seat:${s}`, JSON.stringify(payload)); } catch (_) {}
      }
    }
  }
  const syncUpAll = debounce(async () => {
    for (const s of seatsToSync) {
      const raw = localStorage.getItem(`${MEMKEY}:seat:${s}`);
      if (raw) {
        try { await cloudSave(s, JSON.parse(raw)); } catch (_) {}
      }
    }
  }, 1000);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (phase !== 'bidding') return;
      setCloudReady(false);
      await syncDownAll();
      if (alive) setCloudReady(true);
    })();
    return () => { alive = false; };
  }, [phase]);

  // Derived
  const allBidsIn = bids.every(Boolean);
  const sumBids = bids.reduce((a, b) => a + (b?.count || 0), 0);
  // pemenang bidding: COUNT > SUIT > RANK
  const highestBidIdx = allBidsIn
    ? bids.reduce((best, b, i) => {
        if (best === -1) return i;
        const bb = bids[best];
        const bs = suitOrder[b.suit], bbs = suitOrder[bb.suit];
        if (b.count > bb.count) return i;
        if (b.count === bb.count && bs > bbs) return i;
        if (b.count === bb.count && bs === bbs && b.rank > bb.rank) return i;
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
    playSound('/sounds/ui-click.mp3', 0.8);
    if (!rank || !suit) return;
    const valid = handBySuit[suit]?.includes(Number(rank));
    if (!valid) return;
    const nb = [...bids];
    nb[0] = { count: betFromRank(Number(rank)), suit, rank: Number(rank) };
    setBids(nb);
  }

  // Instansiasi / reuse bot saat bidding dimulai
  useEffect(() => {
    if (phase !== "bidding" || !cloudReady) return;
    const arr = botRefs.current.slice();
    for (let p = 1; p <= 3; p++) {
      if (!arr[p]) {
        arr[p] = createLearningBot({
          seat: p,
          getState: () => ({
            trump, leadSuit, mode,
            bids, targets, tricksWon,
            voidMap, trumpsPlayed, played,
            table, currentPlayer, round,
            SUITS, suitOrder
          }),
          memoryKey: "trufman_bot_memory_v3"
        });
      } else if (typeof arr[p].setSeat === "function") {
        arr[p].setSeat(p);
      }
    }
    botRefs.current = arr;
  }, [phase, round, cloudReady, trump, leadSuit, mode, bids, targets, tricksWon, voidMap, trumpsPlayed, played, table, currentPlayer]);

  // Bots pilih bid
  useEffect(() => {
    if (phase !== "bidding" || !cloudReady) return;
    const nb = [...bids];
    let changed = false;
    for (let p = 1; p <= 3; p++) {
      if (!nb[p]) {
        const bot = botRefs.current[p];
        const pick = bot?.chooseBid
          ? bot.chooseBid(hands[p], { betFromRank, suitOrder, SUITS, rankLabel })
          : botChooseBidFallback(hands[p]);
        nb[p] = pick;
        changed = true;
      }
    }
    if (changed) setBids(nb);
  }, [phase, hands, bids, cloudReady]);

  // Reveal bids serentak
  useEffect(() => {
    if (phase !== "bidding") return;
    if (allBidsIn && !bidsRevealed) setBidsRevealed(true);
  }, [allBidsIn, phase, bidsRevealed]);

  // Ketika semua bid sudah masuk → set trump, mode/targets & logic 13
  useEffect(() => {
    if (phase !== "bidding") return;
    if (!allBidsIn) return;

    // trump dari pemenang bidding
    const winIdx = highestBidIdx;
    if (winIdx >= 0) setTrump(bids[winIdx].suit);

    const sum = sumBids;
    if (sum === 13) {
      // butuh keputusan pemenang
      setAdjustPending(true);
      setAdjustDecider(winIdx);
      setShowAdjustModal(true);

      // kalau pemenangnya bot → auto pilih (heuristik sederhana)
      if (winIdx !== 0) {
        const botBid = bids[winIdx]?.count || 0;
        const botChoice = botBid >= 3 ? "ATAS" : "BAWAH";
        // terapkan pilihan bot kecil delay biar terasa natural
        setTimeout(() => {
          applyAdjustChoice(botChoice);
        }, 600);
      }
      // targets sementara = bids apa adanya; mode tetap null sampai dipilih
      setTargets(bids.map(b => b.count));
      setMode(null);
    } else {
      // aturan baru: targets = bid; mode otomatis berdasar <13 / >13
      setTargets(bids.map(b => b.count));
      setMode(sum < 13 ? "BAWAH" : "ATAS");
      setAdjustPending(false);
      setAdjustDecider(null);
      setShowAdjustModal(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBidsIn, phase]);

  // Terapkan pilihan ATAS/BAWAH saat total=13
  function applyAdjustChoice(choice /* "ATAS" | "BAWAH" */) {
    if (!adjustPending) return;
    const step = choice === "ATAS" ? +1 : -1;
    setTargets(bids.map(b => Math.max(0, b.count + step)));
    setMode(choice);
    setAdjustPending(false);
    setShowAdjustModal(false);
  }

  // Start Play
  function startPlay() {
    if (!allBidsIn) return;
    if (adjustPending) return; // masih menunggu pilihan pemenang
    playSound('/sounds/new-round.mp3', 0.9);

    setPhase("play");
    setLeadSuit(null);
    setTable([]);
    setTricksWon([0, 0, 0, 0]);
    setTrumpBroken(false);

    // giliran pertama = pemenang bidding
    setCurrentPlayer(highestBidIdx >= 0 ? highestBidIdx : (dealer + 1) % 4);

    // reset pengetahuan ronde
    setVoidMap([{}, {}, {}, {}]);
    setTrumpsPlayed(0);
    setPlayed([]);

    // reset resolver state
    setResolving(false);
    resolvingRef.current = false;
    setResolveCountdownMs(0);
    setBotCountdownMs(0);
  }

  // Rules
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

  function notifyBotsPlay(pid, card, leadSuitNow) {
    for (let p = 1; p <= 3; p++) {
      const bot = botRefs.current[p];
      if (bot?.observePlay) bot.observePlay({ player: pid, card, leadSuit: leadSuitNow });
    }
  }

  function commitPlay(pid, card) {
    if (resolving) return;

    const isTrumpCard = card.suit === trump;
    playCardPlace(isTrumpCard);

    const isTrumpBrokenNow =
      (leadSuit && card.suit === trump && leadSuit !== trump) ||
      (!leadSuit && card.suit === trump);
    if (isTrumpBrokenNow && !trumpBroken) {
      playSound('/sounds/trump-break.mp3', 0.9);
      setTrumpBroken(true);
    } else if (isTrumpBrokenNow) {
      setTrumpBroken(true);
    }

    setHands((H) => H.map((h, i) => (i === pid ? h.filter((c) => c.id !== card.id) : h)));
    setTable((t) => [...t, { player: pid, card, hidden: isTrumpCard }]);

    const leadSuitNow = leadSuit || card.suit;
    if (!leadSuit) setLeadSuit(card.suit);

    if (leadSuit && card.suit !== leadSuit) {
      setVoidMap((vm) => {
        const next = vm.map((m) => ({ ...m }));
        next[pid] = { ...(next[pid] || {}), [leadSuit]: true };
        return next;
      });
    }
    if (isTrumpCard) setTrumpsPlayed((n) => n + 1);
    setPlayed((pl) => [...pl, { player: pid, card }]);

    const willLen = table.length + 1;
    if (willLen < 4) setCurrentPlayer((pid + 1) % 4);
  }

  // Human click
  function onClickCard(card) {
    if (!canPlay(0, card)) return;
    commitPlay(0, card);
  }

  // Bot autoplay
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
      const bot = botRefs.current[pid];
      const hand = hands[pid] || [];
      const need = (targets[pid] ?? 0) - (tricksWon[pid] ?? 0);
      const pos = table.length;
      const seen = [...played, ...table];

      let card = null;
      if (bot?.pickCard) {
        try {
          card = bot.pickCard({
            hand, leadSuit, trump, table, seen, voidMap, need, pos,
            mode, targets, tricksWon,
            seat: pid
          });
        } catch (_) {
          card = botPlayCardFallback(hand, leadSuit, trump);
        }
      } else {
        card = botPlayCardFallback(hand, leadSuit, trump);
      }
      if (card) commitPlay(pid, card);
    }, botDelayMs);

    return () => {
      clearTimeout(timer);
      clearInterval(iv);
    };
  }, [currentPlayer, phase, hands, leadSuit, trump, resolving, table.length, botDelayMs, targets, tricksWon, played, voidMap]);

  // Resolve trick
  useEffect(() => {
    if (phase !== "play") return;
    if (table.length !== 4) return;
    if (resolvingRef.current) return;

    resolvingRef.current = true;
    setResolving(true);

    setTable((prev) => prev.map((p) => (p.hidden ? { ...p, hidden: false } : p)));

    const trickPlays = [...table];
    const trickLead = leadSuit;
    const trickTrump = trump;

    let iv;
    if (resolveDelayMs > 0) {
      setResolveCountdownMs(resolveDelayMs);
      const start = Date.now();
      iv = setInterval(() => {
        const remain = Math.max(0, resolveDelayMs - (Date.now() - start));
        setResolveCountdownMs(remain);
      }, 100);
    }

    const to = setTimeout(() => {
      const winner = evaluateTrick(trickPlays, trickTrump, trickLead);

      if (winner === 0) playSound('/sounds/win-trick.mp3', 0.95);
      else playSound('/sounds/lose-trick.mp3', 0.9);

      for (let p = 1; p <= 3; p++) {
        const bot = botRefs.current[p];
        if (bot?.observeTrick) {
          try {
            bot.observeTrick({ plays: trickPlays, winner, trump: trickTrump, leadSuit: trickLead });
          } catch (_) {}
        }
      }

      setTable([]);
      setLeadSuit(null);
      setCurrentPlayer(winner);
      setTricksWon((tw) => {
        const t2 = [...tw];
        t2[winner] += 1;
        return t2;
      });
      setResolving(false);
      resolvingRef.current = false;
      setResolveCountdownMs(0);
      if (iv) clearInterval(iv);

      // sync learning weights ke Supabase
      syncUpAll();
    }, resolveDelayMs);

    return () => {
      clearTimeout(to);
      if (iv) clearInterval(iv);
    };
  }, [phase, table.length, resolveDelayMs, trump, leadSuit]);

  const roundFinished = phase === "play" && hands.every((h) => h.length === 0);

  // Scoring — sesuai aturan baru
  function roundScores() {
    const s = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const got = tricksWon[i];
      const tgt = targets[i];
      if (got === tgt) s[i] = tgt;
      else if (mode === "ATAS") s[i] = got < tgt ? -2 * (tgt - got) : -(got - tgt);
      else if (mode === "BAWAH") s[i] = got > tgt ? -2 * (got - tgt) : -(tgt - got);
      else s[i] = -(Math.abs(got - tgt)); // fallback (harusnya tidak terjadi)
    }
    return s;
  }

  // Next Round
  function nextRound() {
    playSound('/sounds/new-round.mp3', 0.9);
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

    // reset pengetahuan ronde
    setVoidMap([{}, {}, {}, {}]);
    setTrumpsPlayed(0);
    setPlayed([]);

    for (let p = 1; p <= 3; p++) {
      const bot = botRefs.current[p];
      if (bot?.reset) bot.reset();
    }
  }

  // Reset buttons
  function resetBotMemory() {
    setVoidMap([{}, {}, {}, {}]);
    setTrumpsPlayed(0);
    setPlayed([]);
    for (let p = 1; p <= 3; p++) {
      const bot = botRefs.current[p];
      if (bot?.reset) bot.reset();
    }
  }
  function resetBotLearning() {
    for (let p = 1; p <= 3; p++) {
      const bot = botRefs.current[p];
      if (bot?.reset) bot.reset({ hard: true });
    }
    try { localStorage.removeItem("trufman_bot_memory_v3"); } catch (_) {}
    seatsToSync.forEach(s => cloudSave(s, { version: 3, weights: {}, games: 0, resetAt: new Date().toISOString() }));
  }

  const leaderboard = useMemo(() => {
    return [0, 1, 2, 3]
      .map((i) => ({ i, name: i === 0 ? "Kamu" : SeatName[i], score: totalScores[i] }))
      .sort((a, b) => b.score - a.score);
  }, [totalScores]);

  const targetOrDash = (i) => (phase === "play" && targets[i] !== undefined ? targets[i] : "–");
  const sec = (ms) => (ms / 1000).toFixed(1) + "s";

  /* ========================= UI ========================= */
  return (
    <div className="min-h-screen w-screen bg-zinc-900 text-stone-800">
      <div className="mx-auto w-full max-w-[1200px] px-2 md:px-4 py-2 md:py-4">
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-0 mb-2 md:mb-3">
          <div className="flex items-center gap-2 md:gap-3">
            <Link to="/" className="text-stone-300 text-xs md:text-sm underline">← Lobby</Link>
            <h1 className="text-2xl md:text-3xl font-extrabold text-amber-300 drop-shadow-[0_2px_2px_rgba(0,0,0,0.7)]">
              Trufman
            </h1>
          </div>
          <div className="flex items-center gap-2 md:gap-3 flex-wrap">
            <button
              onClick={toggleMusic}
              className="p-1.5 md:p-1.5 rounded-lg text-base md:text-lg bg-red-900/50 text-stone-200 border border-red-500/30 hover:bg-red-900/80 transition"
              title={isMusicPlaying ? "Matikan musik" : "Nyalakan musik"}
            >
              {isMusicPlaying ? '🔇' : '🔊'}
            </button>
            <div className="text-stone-300 text-xs md:text-sm">Dealer: P{dealer + 1} • Ronde: {round}</div>
            <button
              onClick={() => setShowHowTo(true)}
              className="px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-xs font-semibold bg-red-900/50 text-stone-200 border border-red-500/30 hover:bg-red-900/80 transition"
              title="Lihat panduan bermain"
            >
              How To
            </button>
          </div>
        </header>

        <div className="relative mx-auto w-full max-w-[1200px] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-red-800 to-red-950 rounded-2xl shadow-inner border-4 border-zinc-950 min-h-[560px] md:min-h-[600px] overflow-hidden pb-24 md:pb-0">
          <div className="absolute top-2 left-1/2 -translate-x-1/2 text-stone-200 font-semibold drop-shadow text-xs md:text-base">
            {SeatName[2]} • {tricksWon[2]}/{targetOrDash(2)}
          </div>
          <div className="absolute left-2 top-1/2 -translate-y-1/2 -rotate-90 text-stone-200 font-semibold drop-shadow">
            {SeatName[1]} • {tricksWon[1]}/{targetOrDash(1)}
          </div>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-stone-200 font-semibold drop-shadow">
            {SeatName[3]} • {tricksWon[3]}/{targetOrDash(3)}
          </div>

          <div className="absolute top-10 left-1/2 -translate-x-1/2 flex gap-2">
            {hands[2]?.map((_, i) => <SimpleCardBack key={i} small />)}
          </div>
          <div className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {hands[1]?.map((_, i) => <SimpleCardBack key={i} vertical small />)}
          </div>
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-2">
            {hands[3]?.map((_, i) => <SimpleCardBack key={i} vertical small />)}
          </div>

          {/* Center table cards in seat slots */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-80 h-64">
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-auto">
                <TableSlot play={table.find((t) => t.player === 0)} />
              </div>
              <div className="absolute left-0 top-1/2 -translate-y-1/2 pointer-events-auto">
                <TableSlot play={table.find((t) => t.player === 1)} />
              </div>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-auto">
                <TableSlot play={table.find((t) => t.player === 2)} />
              </div>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-auto">
                <TableSlot play={table.find((t) => t.player === 3)} />
              </div>
            </div>
          </div>

          <CountdownOverlay
            visible={resolving && resolveDelayMs > 0}
            ms={resolveCountdownMs}
            total={resolveDelayMs}
          />

          {/* Bottom player hand - Mobile Optimized */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-900 via-zinc-900 to-transparent pt-2 pb-3 px-2 md:px-4 player-hand-section">
            <div className="mb-2 text-center text-stone-200 font-semibold drop-shadow text-sm md:text-base">
              Kamu • {tricksWon[0]}/{targetOrDash(0)}
            </div>
            {/* Desktop: grid layout */}
            <div className="hidden md:flex flex-wrap gap-2 items-center justify-center card-container">
              {hands[0]?.map((c) => (
                <CardFace key={c.id} card={c} disabled={!canPlay(0, c)} onClick={() => onClickCard(c)} />
              ))}
            </div>
            {/* Mobile: horizontal scroll carousel */}
            <div className="md:hidden card-carousel">
              <div className="flex gap-1.5 items-center justify-start min-w-max px-2">
                {hands[0]?.map((c) => (
                  <CardFace key={c.id} card={c} disabled={!canPlay(0, c)} onClick={() => onClickCard(c)} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Info bar + controls - Mobile optimized */}
        <div className="mt-2 md:mt-3 flex flex-wrap items-center gap-1 md:gap-2 text-xs md:text-sm">
          <Badge>Fase: {phase}</Badge>
          <Badge>Giliran: P{currentPlayer + 1}</Badge>
          <Badge>Lead: {leadSuit ? SUITS.find((s) => s.key === leadSuit)?.icon : "–"}</Badge>
          <Badge>Truf: {trump ? SUITS.find((s) => s.key === trump)?.icon : "–"}</Badge>
          <Badge className="hidden md:inline">Truf Broken: {trumpBroken ? "Ya" : "Belum"}</Badge>
          <Badge>Total: {bidsRevealed ? `${sumBids}/13` : "—/13"} ({mode || "–"})</Badge>

          <div className="ml-auto flex gap-1 md:gap-2">
            <button
              onClick={resetBotMemory}
              className="px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-xs font-medium bg-zinc-600 text-stone-100 border border-zinc-500 hover:bg-zinc-500 transition"
              title="Kosongkan memori taktis bot"
            >
              Memory
            </button>
            <button
              onClick={resetBotLearning}
              className="px-2 md:px-3 py-1 md:py-1.5 rounded-lg text-xs font-medium bg-red-800 text-white border border-red-600 hover:bg-red-700 transition"
              title="Hapus data training bot (permanen!)"
            >
              Learning
            </button>
          </div>
        </div>

        {/* Bidding panel - Mobile optimized */}
        {phase === "bidding" && (
          <div className="mx-auto w-full max-w-[1200px] mt-2 md:mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            {[0, 1, 2, 3].map((p) => {
              const bid = bids[p];
              const isYou = p === 0;
              const suitIcon = bid ? SUITS.find((s) => s.key === bid.suit)?.icon : "";
              const bidCard = bid ? { id: `BID${p}`, suit: bid.suit, rank: bid.rank, label: `${rankLabel(bid.rank)}${suitIcon}` } : null;
              return (
                <div key={p} className="bg-zinc-800 rounded-lg md:rounded-xl shadow p-2 md:p-3 text-stone-100 text-xs md:text-sm">
                  <div className="flex items-center justify-between mb-1 md:mb-2">
                    <div className="font-semibold">P{p + 1} {isYou ? "(K)" : ""}</div>
                    <Badge>Bid: {bid ? (bidsRevealed ? `${bid.count}${suitIcon}` : "...") : "..."}</Badge>
                  </div>

                  {bid ? (
                    <div className="h-8 md:h-10 flex items-center gap-1">
                      {bidsRevealed ? <SimpleCardFace card={bidCard} disabled /> : <SimpleCardBack small />}
                      <span className="text-xs text-stone-400">{bidsRevealed ? "Buka" : "Tunggu"}</span>
                    </div>
                  ) : (
                    isYou ? (
                      <PlayerBidForm handBySuit={handBySuit} setBid={setPlayerBid} disabled={!!bids[0]} />
                    ) : (
                      <div className="text-stone-400 text-xs h-8 md:h-10 flex items-center">Bot...</div>
                    )
                  )}
                </div>
              );
            })}

            {/* Panel start */}
            <div className="md:col-span-4 flex justify-end">
              <button
                className="px-4 py-2 rounded-xl text-white font-bold transition disabled:bg-zinc-600 bg-red-700 hover:bg-red-600"
                onClick={startPlay}
                disabled={!allBidsIn || adjustPending}
              >
                Mulai Main
              </button>
            </div>
          </div>
        )}

        {/* Scores + Leaderboard - Mobile optimized */}
        <div className="mt-2 md:mt-4 grid grid-cols-1 lg:grid-cols-2 gap-2 md:gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-2 gap-2 md:gap-3">
            {[0, 1, 2, 3].map((p) => (
              <div key={p} className="bg-zinc-800 rounded-lg md:rounded-xl shadow p-2 md:p-3 text-xs md:text-sm">
                <div className="flex items-center justify-between text-stone-100 mb-1">
                  <div className="font-semibold">{p === 0 ? "Kamu" : `P${p + 1}`}</div>
                  <Badge>Σ: {totalScores[p]}</Badge>
                </div>
                <div className="text-stone-300 grid grid-cols-2 gap-1 text-xs">
                  <div>Bid</div>
                  <div className="text-right">
                    {bids[p] ? (bidsRevealed ? `${bids[p].count}${SUITS.find((s) => s.key === bids[p].suit)?.icon}` : "...") : "–"}
                  </div>
                  <div>Tgt</div>
                  <div className="text-right">{targets[p] ?? "–"}</div>
                  <div>Trik</div>
                  <div className="text-right">{tricksWon[p] ?? 0}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-zinc-800 rounded-lg md:rounded-xl shadow p-2 md:p-3">
            <h3 className="font-semibold text-stone-100 mb-2 text-sm">Leaderboard</h3>
            <ol className="space-y-0.5">
              {leaderboard.map((row, idx) => (
                <li key={row.i} className="flex items-center justify-between text-xs md:text-sm p-1 rounded-md bg-zinc-700/50">
                  <span className="flex items-center gap-1 md:gap-2 text-stone-200">
                    <span className={`inline-flex w-5 h-5 md:w-6 md:h-6 items-center justify-center rounded-full font-bold text-xs ${idx === 0 ? 'bg-amber-400 text-zinc-900' : 'bg-zinc-600'}`}>{idx + 1}</span>
                    <span className="truncate">{row.name}</span>
                  </span>
                  <span className="font-semibold text-stone-100">{row.score}</span>
                </li>
              ))}
            </ol>
          </div>
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

      {/* Adjust choice modal (total bet = 13) */}
      {showAdjustModal && adjustPending && (
        <AdjustChoiceModal
          decider={adjustDecider}
          isYou={adjustDecider === 0}
          onPick={(choice) => applyAdjustChoice(choice)}
          trump={trump}
          bids={bids}
        />
      )}

      {/* How To */}
      {showHowTo && (
        <HowToPlayModal
          onClose={() => setShowHowTo(false)}
          SUITS={SUITS}
          rankLabel={rankLabel}
          betFromRank={betFromRank}
        />
      )}
    </div>
  );
}

/* ========================= UI Components ========================= */
function Badge({ children }) {
  return <span className="inline-flex items-center rounded-md bg-zinc-700 text-stone-200 px-2 py-0.5 text-xs shadow-sm">{children}</span>;
}
function CardBack({ small }) {
  const cls = small ? "card-back card-small" : "card-back";
  return <div className={`card-base ${small ? 'card-small' : ''} animate-deal`}><div className={cls}></div></div>;
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
function SimpleCardBack({ small, vertical }) {
  const cls = `bg-red-600 rounded-lg border-2 border-red-300 shadow ${small ? (vertical ? "h-6 w-4" : "h-6 w-4") : "h-10 w-7"}`;
  return <div className={cls} />;
}
function SimpleCardFace({ card, onClick, disabled }) {
  const red = card.suit === "H" || card.suit === "D";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-1 rounded-lg border bg-white font-mono text-sm shadow ${disabled ? "opacity-100 cursor-not-allowed" : "hover:ring-2 hover:ring-red-400"}`}
      title={card.label}
    >
      <span className={red ? "text-rose-600" : "text-slate-800"}>{card.label}</span>
    </button>
  );
}
function TableSlot({ play }) {
  return (
    <div className="h-20 w-28 bg-black/40 rounded-lg border-2 border-zinc-700/50 flex items-center justify-center shadow-inner">
      {play ? (play.hidden ? <SimpleCardBack small /> : <SimpleCardFace card={play.card} disabled />) : null}
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
  }, [suit, handBySuit]); // eslint-disable-line

  const canSubmit = !disabled && ranks.length > 0;

  return (
    <div className="flex items-center gap-1 md:gap-2 text-xs md:text-sm w-full">
      <select
        id="bid-suit"
        className="rounded-md md:rounded-lg border border-zinc-600 px-1 md:px-2 py-0.5 md:py-1 bg-zinc-700 text-stone-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 text-xs"
        value={suit}
        onChange={(e) => setSuit(e.target.value)}
        disabled={disabled}
      >
        {SUITS.map((s) => <option key={s.key} value={s.key}>{s.icon}</option>)}
      </select>

      <select
        id="bid-rank"
        className="flex-1 rounded-md md:rounded-lg border border-zinc-600 px-1 md:px-2 py-0.5 md:py-1 bg-zinc-700 text-stone-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 text-xs"
        value={rank}
        onChange={(e) => setRank(Number(e.target.value))}
        disabled={disabled || ranks.length === 0}
      >
        {ranks.length === 0 ? <option>–</option> : ranks.map((r) => (
          <option key={r} value={r}>{rankLabel(r)} ({betFromRank(r)})</option>
        ))}
      </select>

      <button
        type="button"
        className="px-2 md:px-3 py-0.5 md:py-1 rounded-md md:rounded-lg text-white font-semibold transition text-xs bg-red-700 hover:bg-red-600 disabled:bg-zinc-600 disabled:cursor-not-allowed flex-shrink-0"
        disabled={!canSubmit}
        onClick={() => setBid(suit, rank)}
      >
        Bet
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
      else if (mode === "ATAS") s[i] = got < tgt ? -2 * (tgt - got) : -(got - tgt);
      else if (mode === "BAWAH") s[i] = got > tgt ? -2 * (got - tgt) : -(tgt - got);
      else s[i] = -(Math.abs(got - tgt));
    }
    return s;
  }, [mode, targets, tricksWon]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 md:p-4 z-50 overflow-y-auto">
      <div className="bg-zinc-800 rounded-2xl shadow-xl w-full max-w-2xl p-3 md:p-4 border border-zinc-700 my-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 mb-2 md:mb-3">
          <h2 className="text-lg md:text-xl font-bold text-stone-100">Ronde Selesai</h2>
          <div className="text-xs md:text-sm text-stone-300">Mode: {mode || "—"} • Truf: {SUITS.find((s) => s.key === trump)?.icon}</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 text-xs md:text-sm">
          {[0, 1, 2, 3].map((p) => (
            <div key={p} className="rounded-lg md:rounded-xl border border-zinc-700 p-2 md:p-3 bg-zinc-900/50">
              <div className="font-semibold mb-1 text-stone-200">{SeatName[p]}</div>
              <div className="text-stone-300">Bid: {bids[p].count}{SUITS.find((s) => s.key === bids[p].suit)?.icon}</div>
              <div className="text-stone-300">Target: {targets[p]}</div>
              <div className="text-stone-300">Trik: {tricksWon[p]}</div>
              <div className={`font-bold text-base md:text-lg mt-1 ${scores[p] > 0 ? 'text-green-400' : (scores[p] < 0 ? 'text-red-400' : 'text-stone-300')}`}>
                {scores[p] > 0 ? `+${scores[p]}` : scores[p]}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 md:mt-4 flex justify-end">
          <button onClick={onNext} className="px-3 md:px-4 py-1.5 md:py-2 rounded-lg md:rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold text-sm md:text-base">
            Lanjut
          </button>
        </div>
      </div>
    </div>
  );
}

function CountdownOverlay({ visible, ms, total }) {
  if (!visible || total <= 0) return null;
  const pct = total > 0 ? Math.max(0, Math.min(1, ms / total)) : 0;
  const deg = (1 - pct) * 360;
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 bg-black/20">
      <div
        className="relative w-32 h-32 rounded-full"
        style={{ background: `conic-gradient(rgba(220,38,38,0.95) ${deg}deg, rgba(255,255,255,0.1) 0deg)` }}
      >
        <div className="absolute inset-2 rounded-full bg-zinc-900/80 backdrop-blur-sm border border-red-500/40 flex items-center justify-center">
          <span className="text-red-300 text-3xl font-bold tabular-nums drop-shadow">
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
    <div className="fixed bottom-4 right-4 z-50 bg-zinc-800/90 rounded-xl shadow-lg px-4 py-3 border border-zinc-700 backdrop-blur">
      <div className="text-xs text-stone-400">Giliran {SeatName[player]}...</div>
      <div className="text-lg font-semibold tabular-nums text-red-400">{(ms / 1000).toFixed(1)}s</div>
    </div>
  );
}

/* ===== Modal pilihan ATAS/BAWAH saat total bet = 13 ===== */
function AdjustChoiceModal({ decider, isYou, onPick, trump, bids }) {
  const title = isYou
    ? "Total bet = 13. Pemenang — pilih mode:"
    : `Total bet = 13. Menunggu P${decider + 1}…`;

  const winnerBid = bids?.[decider];
  const suitIcon = winnerBid ? SUITS.find(s => s.key === winnerBid.suit)?.icon : "–";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 md:p-0">
      <div className="w-full max-w-sm md:max-w-md rounded-2xl bg-zinc-900 border border-zinc-700 p-4 md:p-6 shadow-2xl">
        <h2 className="text-base md:text-lg font-bold text-stone-100 mb-1">{title}</h2>
        <div className="text-xs md:text-sm text-stone-300 mb-4">
          Pemenang: P{decider + 1} • Truf: {suitIcon}
        </div>
        {isYou ? (
          <div className="flex flex-col gap-2 md:gap-3 justify-center">
            <button
              className="px-3 md:px-4 py-2 md:py-2.5 rounded-lg md:rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm md:text-base"
              onClick={() => onPick("ATAS")}
            >
              ATAS (+1)
            </button>
            <button
              className="px-3 md:px-4 py-2 md:py-2.5 rounded-lg md:rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-sm md:text-base"
              onClick={() => onPick("BAWAH")}
            >
              BAWAH (−1)
            </button>
          </div>
        ) : (
          <div className="text-stone-400 text-xs md:text-sm text-center">Bot sedang menentukan…</div>
        )}
      </div>
    </div>
  );
}

/* ===== How To Modal (Mobile optimized) ===== */
function HowToPlayModal({ onClose, SUITS, rankLabel, betFromRank }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ranks = [2,3,4,5,6,7,8,9,10,11,12,13,14];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 md:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl bg-zinc-800 rounded-2xl shadow-xl border border-zinc-700 overflow-hidden my-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 md:px-5 py-3 md:py-4 bg-red-900 text-white flex items-center justify-between">
          <h3 className="text-base md:text-lg font-bold">How To Play</h3>
          <button
            onClick={onClose}
            className="px-2 md:px-3 py-1 md:py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-base"
            title="Tutup"
          >
            ✕
          </button>
        </div>

        <div className="p-3 md:p-5 space-y-3 md:space-y-4 text-xs md:text-sm text-stone-300 max-h-[70vh] overflow-y-auto">
          <section>
            <h4 className="font-semibold text-stone-100 text-xs md:text-sm">Tujuan</h4>
            <p className="text-xs md:text-sm">Setiap pemain menentukan bid lalu mencoba mencapai <em>target</em> triknya.</p>
          </section>

          <section>
            <h4 className="font-semibold text-stone-100 text-xs md:text-sm">Bidding</h4>
            <ul className="list-disc ml-4 md:ml-5 space-y-0.5 md:space-y-1 text-xs md:text-sm">
              <li>Pilih 1 kartu sebagai bid: 2–10 = nilai; J/Q/K = 0; A = 1.</li>
              <li>Truf = bid tertinggi (seri: nilai &gt; suit &gt; rank).</li>
              <li>Bid tertutup, dibuka serentak.</li>
            </ul>
            <div className="mt-1 md:mt-2 rounded-lg border border-zinc-700 p-2 bg-zinc-900/40">
              <div className="font-medium mb-1 text-stone-200 text-xs">Nilai Bid</div>
              <div className="grid grid-cols-7 gap-0.5 text-xs">
                {ranks.map((r) => (
                  <div key={r} className="rounded bg-zinc-800 border border-zinc-700 px-1 py-0.5 text-center">
                    {rankLabel(r)}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h4 className="font-semibold text-stone-100 text-xs md:text-sm">Mode & Target</h4>
            <ul className="list-disc ml-4 md:ml-5 space-y-0.5 md:space-y-1 text-xs md:text-sm">
              <li>Σ bid &gt; 13 → ATAS | &lt; 13 → BAWAH | = 13 → Pemenang pilih</li>
              <li>Target = bid asli (±1 jika total = 13)</li>
            </ul>
          </section>

          <section>
            <h4 className="font-semibold text-stone-100 text-xs md:text-sm">Main Trick</h4>
            <ul className="list-disc ml-4 md:ml-5 space-y-0.5 md:space-y-1 text-xs md:text-sm">
              <li>Ikuti suit lead. Jika tidak bisa, bebas buang.</li>
              <li>Tidak boleh lead truf sebelum Truf Broken.</li>
              <li>Truf tertutup di meja, terbuka saat 4 kartu lengkap.</li>
            </ul>
          </section>

          <section>
            <h4 className="font-semibold text-stone-100 text-xs md:text-sm">Skoring</h4>
            <ul className="list-disc ml-4 md:ml-5 space-y-0.5 md:space-y-1 text-xs md:text-sm">
              <li>Tepat: +target</li>
              <li>Kurang: ATAS = −2×Δ | BAWAH = −Δ</li>
              <li>Lebih: BAWAH = −2×Δ | ATAS = −Δ</li>
            </ul>
          </section>

          <div className="pt-2 md:pt-3 flex justify-end">
            <button
              onClick={onClose}
              className="px-3 md:px-4 py-1.5 md:py-2 rounded-lg md:rounded-xl bg-red-700 hover:bg-red-600 text-white font-bold text-sm md:text-base"
            >
              Oke
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
