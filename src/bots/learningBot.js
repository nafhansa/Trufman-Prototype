// bots/learningBot.js
/**
 * Learning Bot (offline, no-API)
 * -------------------------------------------------------------
 * Fitur:
 * 1) Bidding rasional (konservatif moderat, bisa di-tune):
 *    - Estimasi kekuatan suit (HCP-ish + panjang) sebagai calon trump.
 *    - Target bid = round(estimate + AGGR), hormati aturan "bid dari kartu yang dimiliki".
 *    - Rem untuk angka sangat besar (≥8) kecuali suit benar-benar kuat.
 *
 * 2) Play cerdas:
 *    - Heuristik posisi (lead vs late), need-aware (sesuai target),
 *      trump control, overtrump minimal, buang aman saat tidak perlu menang.
 *    - Void tracking per lawan: siapa pun yang gagal follow suit → voidMap[p][suit]=true.
 *    - Inference sisa kartu: generate deck sisa, Monte-Carlo ringan untuk
 *      memprediksi win probability trick ini untuk tiap kandidat kartu.
 *
 * 3) Pembelajaran ringan:
 *    - Bobot preferensi per fitur (isTrump, rank bucket, posisi, needSign, mode).
 *    - Update saat selesai trick (reward sederhana) → disimpan di localStorage.
 *
 * API untuk App.jsx:
 *   const bot = createLearningBot({ seat, getState });
 *   bot.chooseBid(hand)
 *   bot.pickCard(ctx)  // ctx: {hand, leadSuit, trump, table, seen, voidMap, need, pos, mode, seat, handCounts}
 *   bot.observePlay({ player, card, leadSuit })
 *   bot.observeTrick({ plays, winner, trump, leadSuit })
 *   bot.reset({ hard })
 *   bot.setSeat(seat)
 */

export function createLearningBot({
  seat = 1,
  getState = () => ({}),
  memoryKey = "trufman_bot_memory_v2",
  mcRollouts = 200,            // jumlah simulasi Monte-Carlo per aksi
} = {}) {
  // ===== Constants & helpers =====
  const RANKS = [2,3,4,5,6,7,8,9,10,11,12,13,14]; // J=11,Q=12,K=13,A=14
  const FACE = new Set([11,12,13]);
  const rankLabel = (r) => (r <= 10 ? String(r) : ({11:"J",12:"Q",13:"K",14:"A"}[r]));
  const betFromRank = (rank) => (rank === 14 ? 1 : (FACE.has(rank) ? 0 : rank));

  function beats(a, b, leadSuit, trump) {
    if (!b) return true;
    const at = a.suit === trump, bt = b.suit === trump;
    if (at && !bt) return true;
    if (bt && !at) return false;
    const al = a.suit === leadSuit, bl = b.suit === leadSuit;
    if (al && !bl) return true;
    if (bl && !al) return false;
    if ((at && bt) || (al && bl) || (a.suit === b.suit)) return a.rank > b.rank;
    return false;
  }
  function currentBest(plays, leadSuit, trump) {
    let best = null;
    for (const pl of plays) if (!best || beats(pl.card, best.card, leadSuit, trump)) best = pl;
    return best;
  }
  function legalPlaysFrom(hand, leadSuit, trump, isLead, trumpBroken) {
    if (isLead) {
      // Aturan "tak boleh lead trump sebelum broken, kecuali hanya punya trump"
      const nonTrump = hand.filter(c=>c.suit!==trump);
      if (!trumpBroken && nonTrump.length) return nonTrump.slice();
      return hand.slice();
    }
    if (!leadSuit) return hand.slice();
    const follow = hand.filter(c=>c.suit===leadSuit);
    return follow.length ? follow : hand.slice();
  }
  const asc = (a,b)=>a.rank-b.rank;
  const desc = (a,b)=>b.rank-a.rank;

  // ===== Persistence (localStorage) =====
  const storage = safeStorage();
  let storeKey = `${memoryKey}:seat:${seat}`;
  let memory = loadMemory(storeKey);

  function safeStorage() {
    try { if (typeof window !== "undefined" && window.localStorage) return window.localStorage; } catch(_) {}
    const m = new Map();
    return { getItem:k=>m.get(k)??null, setItem:(k,v)=>m.set(k,v), removeItem:k=>m.delete(k) };
  }
  function defaultMemory() { return { version: 2, weights: {}, games: 0 }; }
  function loadMemory(key) {
    try { const raw = storage.getItem(key); return raw? JSON.parse(raw) : defaultMemory(); }
    catch(_) { return defaultMemory(); }
  }
  function saveMemory() { try { storage.setItem(storeKey, JSON.stringify(memory)); } catch(_){} }

  function reset({ hard=false } = {}) {
    lastAction = null;
    if (hard) { memory = defaultMemory(); saveMemory(); }
  }
  function setSeat(newSeat) {
    if (newSeat === seat) return;
    saveMemory();
    seat = newSeat;
    storeKey = `${memoryKey}:seat:${seat}`;
    memory = loadMemory(storeKey);
  }

  // ===== Learning weights & features =====
  function featureKey({ card, pos, need, mode, trump }) {
    const isTrump = card.suit === trump ? 1 : 0;
    const bucket =
      card.rank >= 14 ? "A" :
      card.rank >= 13 ? "K" :
      card.rank >= 12 ? "Q" :
      card.rank >= 11 ? "J" :
      card.rank >= 10 ? "T" : "L";
    const needSign = need > 0 ? "pos" : need < 0 ? "neg" : "zero";
    return `v2|isT:${isTrump}|b:${bucket}|pos:${pos}|need:${needSign}|mode:${mode||"-"}`;
  }
  function wGet(key) { return memory.weights[key] ?? 0; }
  function wBump(key, delta) { memory.weights[key] = (memory.weights[key] ?? 0) + delta; }

  let lastAction = null; // { key, seat, trickId?, context }

  // ===== Suit strength & small toolkit =====
  function suitStrength(cards, asTrump=false) {
    if (!cards || !cards.length) return 0;
    const len = cards.length;
    const ranks = cards.map(c=>c.rank).sort(desc);
    let est = 0;
    for (const r of ranks) {
      if (r === 14) est += 0.9;
      else if (r === 13) est += 0.6;
      else if (r === 12) est += 0.35;
      else if (r === 11) est += 0.2;
      else if (r >= 10) est += 0.12;
    }
    if (len >= 5) est += 0.4 + 0.1*(len-5); else if (len===4) est += 0.2;
    if (asTrump) {
      est += Math.max(0, (len-3)*0.25);
      if (cards.some(c=>c.rank===14 || c.rank===13)) est += 0.3;
    }
    return Math.min(est, 7.8);
  }
  const smallestOfSuit = (hand, suit) => hand.filter(c=>c.suit===suit).sort(asc)[0] || null;
  const largestOfSuit  = (hand, suit) => hand.filter(c=>c.suit===suit).sort(desc)[0] || null;
  const smallestTrump  = (hand, trump) => hand.filter(c=>c.suit===trump).sort(asc)[0] || null;
  const lowestOverall  = (hand) => hand.slice().sort(asc)[0];
  const highestOverall = (hand) => hand.slice().sort(desc)[0];

  // ====== Bidding ======
  function chooseBid(hand) {
    // Tuning agresivitas
    const AGGR = 0.25;           // 0.0 konservatif, 0.25 moderat, 0.5 agresif
    const OVERBID_PENALTY = 0.25;
    const HARD_CAP8_STRONG_ONLY = true;

    const group = hand.reduce((m,c)=>( (m[c.suit]??=[]).push(c), m), {});
    const suitKeys = Object.keys(group);
    if (!suitKeys.length) {
      const c0 = hand[0];
      return { count: betFromRank(c0.rank), suit: c0.suit, rank: c0.rank };
    }

    const perSuit = suitKeys.map(suit=>{
      const cards = group[suit];
      const est = suitStrength(cards, true);
      let target = Math.round(est + AGGR);

      const strong =
        cards.length >= 6 &&
        (cards.some(c=>c.rank===14 || c.rank===13)) &&
        cards.some(c=>c.rank===10) &&
        cards.some(c=>c.rank===12 || c.rank===11);

      if (HARD_CAP8_STRONG_ONLY && target >= 8 && !strong) target = 7;
      target = Math.max(0, Math.min(target, cards.length + 2));

      const availCounts = Array.from(new Set(cards.map(c=>betFromRank(c.rank)))).sort((a,b)=>a-b);

      let chosenCount = null, bestScore = Infinity;
      for (const c of availCounts) {
        const diff = Math.abs(c-target);
        const over = c>target ? 1 : 0;
        const score = diff + over*OVERBID_PENALTY;
        if (score < bestScore) { bestScore=score; chosenCount=c; }
      }

      // map count → rank representatif
      let rank;
      if (chosenCount === 0) {
        const pref = [13,12,11];
        rank = (pref.find(r=>cards.some(c=>c.rank===r))) ?? cards.find(c=>betFromRank(c.rank)===0).rank;
      } else if (chosenCount === 1) {
        rank = 14;
      } else {
        rank = chosenCount; // 2..10
      }
      return { suit, est, target, chosenCount, rank, len: cards.length };
    });

    perSuit.sort((a,b)=>{
      const e = b.est - a.est; if (Math.abs(e)>0.05) return e;
      const g = Math.abs(a.chosenCount-a.target) - Math.abs(b.chosenCount-b.target); if (g) return g;
      const l = b.len - a.len; if (l) return l;
      const aSafe = Math.abs(a.chosenCount-4), bSafe=Math.abs(b.chosenCount-4);
      return aSafe-bSafe;
    });

    const pick = perSuit[0];
    return { count: pick.chosenCount, suit: pick.suit, rank: pick.rank };
  }

  // ===== Monte-Carlo inference for current trick =====
  /**
   * Build full 52-card deck from getState().SUITS + RANKS
   */
  function fullDeck() {
    const { SUITS } = getState();
    const cards = [];
    for (const s of SUITS) for (const r of RANKS)
      cards.push({ id:`${s.key}${r}`, suit:s.key, suitIcon:s.icon, rank:r, label:`${rankLabel(r)}${s.icon}` });
    return cards;
  }

  function remainingCards({ myHand, table, seen }) {
    // Start from full deck → remove myHand, cards on table, and seen (played) cards
    const deck = fullDeck();
    const toRemove = new Set([
      ...(myHand||[]).map(c=>c.id),
      ...(table||[]).map(pl=>pl.card?.id).filter(Boolean),
      ...(seen||[]).map(c=>c.id),
    ]);
    return deck.filter(c=>!toRemove.has(c.id));
  }

  /**
   * Sample a consistent world assigning remaining cards to opponents,
   * respecting voidMap (can't contain that suit) and required handCounts.
   */
  function sampleWorld({ remCards, players, mySeat, handCounts, voidMap }) {
    // Build targets (how many cards each opponent needs)
    const need = {};
    for (const p of players) {
      if (p === mySeat) continue;
      need[p] = handCounts?.[p] ?? 0;
    }
    // Shuffle remaining cards
    const shuffled = remCards.slice();
    for (let i=shuffled.length-1;i>0;i--) { const j=(Math.random()*(i+1))|0; [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }

    // Constraint-friendly assignment: first pass try to satisfy voidMap
    const hands = {};
    for (const p of players) if (p!==mySeat) hands[p]=[];

    // Quick suit rejection sets
    const reject = {};
    for (const p of players) {
      if (p===mySeat) continue;
      reject[p] = new Set();
      if (voidMap && voidMap[p]) {
        for (const suit of Object.keys(voidMap[p])) if (voidMap[p][suit]) reject[p].add(suit);
      }
    }

    // Repeated attempts
    for (let attempt=0; attempt<200; attempt++) {
      // reset
      for (const p of players) if (p!==mySeat) hands[p]=[];
      let ok = true;

      // greedy seat order: distribute each card to a random allowed player that still needs cards
      for (const c of shuffled) {
        // candidates: players who still need, and (prefer) who don't reject suit
        const cand = players.filter(p=>p!==mySeat && hands[p].length < need[p]);
        if (!cand.length) break; // all filled
        const good = cand.filter(p=>!reject[p].has(c.suit));
        const pool = (good.length ? good : cand);
        const pick = pool[(Math.random()*pool.length)|0];
        hands[pick].push(c);
      }

      // check feasibility
      for (const p of players) if (p!==mySeat) {
        if (hands[p].length !== need[p]) { ok=false; break; }
      }
      if (ok) return hands; // success
      // else reshuffle again
    }

    // Fallback: ignore constraints, just split equally by count
    const fallback = {};
    for (const p of players) if (p!==mySeat) fallback[p]=[];
    const order = players.filter(p=>p!==mySeat);
    let idx=0;
    for (const c of shuffled) {
      const p = order[idx % order.length];
      if (fallback[p].length < need[p]) { fallback[p].push(c); idx++; }
    }
    return fallback;
  }

  function policyPlayRandomLegal({ hand, leadSuit, trump, isLead, trumpBroken }) {
    const legals = legalPlaysFrom(hand, leadSuit, trump, isLead, trumpBroken);
    if (!legals.length) return null;
    // simple random-low policy
    legals.sort(asc);
    return legals[0];
  }

  /**
   * Simulate completion of current trick given our candidate card.
   * Returns 1 if we win the trick, 0 otherwise (single-plout Monte Carlo core).
   */
  function simulateTrickWin({
    candidate, mySeat, seatOrder, handsBySeat, table, leadSuit, trump, trumpBroken
  }) {
    // local hands (mutable copies)
    const hh = {};
    for (const p of seatOrder) hh[p] = handsBySeat[p].slice();

    // Clone table
    const t = table.map(x=>({player:x.player, card:x.card}));

    // Play our candidate
    hh[mySeat] = hh[mySeat].filter(c=>c.id!==candidate.id);
    const ld = leadSuit ?? candidate.suit;
    t.push({ player: mySeat, card: candidate });

    // Continue with the remaining players in order after mySeat until 4 cards
    let curIdx = seatOrder.indexOf(mySeat);
    while (t.length < 4) {
      curIdx = (curIdx + 1) % 4;
      const p = seatOrder[curIdx];
      if (p === mySeat) continue;
      const isLead = t.length===0;
      const card = policyPlayRandomLegal({
        hand: hh[p], leadSuit: ld, trump, isLead, trumpBroken
      }) || hh[p][0];
      if (!card) return 0; // safety
      hh[p] = hh[p].filter(c=>c.id!==card.id);
      t.push({ player:p, card });
    }

    // Evaluate winner of trick
    const best = currentBest(t, ld, trump);
    return best.player === mySeat ? 1 : 0;
  }

  // ===== pickCard =====
  function pickCard(ctx) {
    const {
      hand, leadSuit, trump, table,
      seen, voidMap: voidMapExt, need, pos, mode,
      seat: mySeat = seat,
      handCounts,            // {0:len,...} sisa kartu di tangan masing2
      trumpBroken = false,
    } = ctx;

    // Legality is enforced by host app; we still compute legal set for safety.
    const isLead = !leadSuit;
    const legals = legalPlaysFrom(hand, leadSuit, trump, isLead, trumpBroken);
    if (!legals.length) return hand[0];

    // ===== Baseline heuristic choice =====
    let baseChoice = null;
    if (isLead) {
      if (need > 0) {
        // butuh menang → lead suit terkuat non-trump, atau trump kecil jika semua trump
        const grouped = groupBySuit(hand);
        let bestSuit=null,bestScore=-1;
        for (const suit of Object.keys(grouped)) {
          const cards = grouped[suit];
          let sc = suitStrength(cards, suit===trump?true:false);
          if (suit===trump) sc -= 0.7;
          if (sc>bestScore) {bestScore=sc; bestSuit=suit;}
        }
        baseChoice = largestOfSuit(hand, bestSuit) || highestOverall(hand);
      } else {
        // tidak butuh menang → lead low non-trump
        const nonTrump = hand.filter(c=>c.suit!==trump);
        baseChoice = nonTrump.length ? lowestOverall(nonTrump) : lowestOverall(hand);
      }
    } else {
      const alreadyTrumped = table.some(pl=>pl.card.suit===trump && leadSuit!==trump);
      if (need > 0) {
        if (hand.some(c=>c.suit===leadSuit)) {
          // minimal winning over current best
          const best = currentBest(table, leadSuit, trump);
          const winMin = legals.filter(c=>beats(c, best?.card, leadSuit, trump)).sort(asc)[0];
          baseChoice = winMin || legals.sort(asc)[0];
        } else {
          // void: overtrump minimal, else potong minimal, else buang
          if (alreadyTrumped) {
            const best = currentBest(table, leadSuit, trump);
            const over = hand.filter(c=>c.suit===trump && beats(c, best?.card, leadSuit, trump)).sort(asc)[0];
            baseChoice = over || lowestOverall(hand);
          } else {
            baseChoice = smallestTrump(hand, trump) || lowestOverall(hand);
          }
        }
      } else {
        // tidak perlu menang
        if (hand.some(c=>c.suit===leadSuit)) {
          baseChoice = legals.sort(asc)[0];
        } else {
          // buang tertinggi non-trump bila mungkin
          const nonTrump = hand.filter(c=>c.suit!==trump);
          baseChoice = nonTrump.length ? highestOverall(nonTrump) : smallestTrump(hand, trump) || lowestOverall(hand);
        }
      }
    }
    if (!baseChoice) baseChoice = legals[0];

    // ===== Monte-Carlo expected win for current trick =====
    // Build opponents & world
    const players = [0,1,2,3];
    const state = getState() || {};
    const vmMerged = mergeVoidMaps(internalVoidMap, voidMapExt);
    const rem = remainingCards({ myHand: hand, table, seen });
    const seatOrder = trickSeatOrder({ table, leadSuit, currentSeat: mySeat });

    // Hand counts: how many cards left each seat holds right now
    // If not provided, approximate: total cards 52; we know my hand size; others ???.
    const counts = handCounts || estimateHandCounts({ state, myHand: hand, table });

    // Build opponents hands for each rollout consistent with constraints
    const candidates = legals;

    // Pre-prepare our handsBySeat base
    const baseHandsBySeat = {};
    for (const p of players) baseHandsBySeat[p] = [];

    // We'll compute score = heuristicScore + alpha * winProb
    const alpha = 1.0; // weight win prob impact

    const scored = candidates.map(c=>({ card:c, score: heuristicBaseScore({card:c, need, pos, isLead, leadSuit, trump, table}), winProb: 0 }));

    for (let i=0;i<scored.length;i++) {
      let wins = 0, trials = 0;
      for (let r=0; r<mcRollouts; r++) {
        const world = sampleWorld({
          remCards: rem,
          players,
          mySeat,
          handCounts: counts,
          voidMap: vmMerged
        });

        // Compose handsBySeat with our hand
        const handsBySeat = {};
        for (const p of players) {
          if (p===mySeat) handsBySeat[p] = hand.slice();
          else handsBySeat[p] = world[p] ? world[p].slice() : [];
        }
        // Remove cards on current table from simulated hands (they are already out)
        for (const pl of table) {
          if (pl?.card) {
            const owner = pl.player;
            handsBySeat[owner] = handsBySeat[owner].filter(x=>x.id!==pl.card.id);
          }
        }

        wins += simulateTrickWin({
          candidate: scored[i].card,
          mySeat, seatOrder,
          handsBySeat,
          table,
          leadSuit,
          trump,
          trumpBroken
        });
        trials++;
      }
      scored[i].winProb = trials? wins/trials : 0;
      scored[i].score += alpha * (need>0 ? scored[i].winProb : -scored[i].winProb*0.6);
    }

    scored.sort((a,b)=>b.score-a.score);
    const picked = scored[0].card;

    // Remember for learning reward
    lastAction = {
      key: featureKey({ card:picked, pos, need, mode, trump }),
      seat: mySeat,
      context: { pos, need, mode, trump, leadSuit }
    };

    return picked;
  }

  function heuristicBaseScore({ card, need, pos, isLead, leadSuit, trump, table }) {
    let s = 0;
    if (isLead) {
      if (need>0) s += (card.suit===trump?0.1:0.4) + card.rank/20;
      else s += (card.suit===trump?-1.0:-0.1) - card.rank/40;
    } else {
      const best = currentBest(table, leadSuit, trump);
      const willWin = beats(card, best?.card, leadSuit, trump);
      if (need>0) s += willWin ? (1.0 - card.rank/60) : -0.7;
      else s += willWin ? -1.0 : (card.suit===trump ? -0.2 : 0.3);
      if (pos===3 && !need>0) s += -0.1; // last to act, avoid accidental win
    }
    // Learned weight
    const key = featureKey({ card, pos, need, mode: null, trump });
    s += 0.5 * wGet(key);
    return s;
  }

  // ===== Observers: update learning & void tracking =====
  // internal void map (persist within match instance)
  const internalVoidMap = {}; // { [seat]: { [suit]: true } }

  function observePlay({ player, card, leadSuit }) {
    if (!leadSuit) return;
    // Jika player bukan lead dan tidak match suit → void
    if (card.suit !== leadSuit) {
      internalVoidMap[player] ??= {};
      internalVoidMap[player][leadSuit] = true;
    }
  }

  function observeTrick({ plays, winner, trump, leadSuit }) {
    // Update voidMap dari trick
    for (const pl of plays) {
      if (pl.card.suit !== leadSuit) {
        internalVoidMap[pl.player] ??= {};
        internalVoidMap[pl.player][leadSuit] = true;
      }
    }

    // Learning reward untuk action terakhir
    const myPlay = plays.find(p=>p.player===seat);
    if (!myPlay || !lastAction) return;

    const needSign = Math.sign(lastAction.context?.need ?? 0);
    const didWin = winner === seat;
    let delta = 0;
    if (needSign > 0) delta = didWin ? +0.15 : -0.12;
    else if (needSign < 0) delta = didWin ? -0.15 : +0.08;
    else delta = didWin ? -0.05 : +0.05;

    wBump(lastAction.key, delta);
    saveMemory();
    lastAction = null;
  }

  // ===== Misc helpers =====
  function groupBySuit(hand) {
    return hand.reduce((m,c)=>((m[c.suit]??=[]).push(c), m), {});
  }

  function trickSeatOrder({ table, leadSuit, currentSeat }) {
    // Determine the order of seating for the current trick:
    // If trick has already started, the lead is table[0].player; play proceeds from there.
    // We need order such that after currentSeat comes the next players until 4 cards placed.
    let lead = (table && table.length) ? table[0].player : currentSeat;
    const order = [lead, (lead+1)%4, (lead+2)%4, (lead+3)%4];
    return order;
  }

  function estimateHandCounts({ state, myHand, table }) {
    // If host app doesn't pass handCounts, approximate with:
    // total remaining in trick + after trick. We know: myHand length; on table length; assume others equalish.
    // Better: require host to pass counts. But here fallback:
    const counts = {};
    const myLen = myHand?.length ?? 13;
    const tabLen = table?.length ?? 0;

    // If getState provides hands lengths, use it
    if (state && state.hands && Array.isArray(state.hands)) {
      for (let i=0;i<4;i++) counts[i] = state.hands[i]?.length ?? 0;
      return counts;
    }

    // Fallback: assume everyone started with 13, minus cards already played by them
    const playedBy = {};
    for (let i=0;i<4;i++) playedBy[i]=0;
    for (const pl of (state?.historyPlays || [])) {
      if (pl?.player!=null) playedBy[pl.player]++;
    }
    for (let i=0;i<4;i++) {
      if (i===seat) counts[i] = myLen;
      else counts[i] = Math.max(0, 13 - playedBy[i]);
    }
    return counts;
  }

  function mergeVoidMaps(a, b) {
    if (!a && !b) return {};
    const out = {};
    for (const p of [0,1,2,3]) {
      const ax = a?.[p] || {};
      const bx = b?.[p] || {};
      const keys = new Set([...Object.keys(ax), ...Object.keys(bx)]);
      for (const k of keys) {
        if (ax[k] || bx[k]) {
          (out[p] ||= {})[k] = true;
        }
      }
    }
    return out;
  }

  // ===== Public API =====
  return {
    chooseBid,
    pickCard,
    observePlay,
    observeTrick,
    reset,
    setSeat,
  };
}
