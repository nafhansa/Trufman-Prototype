// bots/learningBot.js
export function createLearningBot({
  seat = 1,
  getState = () => ({}),
  memoryKey = "trufman_bot_memory_v3",
  mcRollouts = 200,
} = {}) {
  const RANKS = [2,3,4,5,6,7,8,9,10,11,12,13,14];
  const FACE = new Set([11,12,13]);
  const rankLabel = (r) => (r <= 10 ? String(r) : ({11:"J",12:"Q",13:"K",14:"A"}[r]));
  const betFromRank = (rank) => (rank === 14 ? 1 : (FACE.has(rank) ? 0 : rank));
  const asc = (a,b)=>a.rank-b.rank;
  const desc = (a,b)=>b.rank-a.rank;

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
      const nonTrump = hand.filter(c=>c.suit!==trump);
      if (!trumpBroken && nonTrump.length) return nonTrump.slice();
      return hand.slice();
    }
    if (!leadSuit) return hand.slice();
    const follow = hand.filter(c=>c.suit===leadSuit);
    return follow.length ? follow : hand.slice();
  }

  const storage = safeStorage();
  let storeKey = `${memoryKey}:seat:${seat}`;
  let memory = loadMemory(storeKey);
  const internalVoidMap = {};
  let lastAction = null;

  function safeStorage() {
    try { if (typeof window !== "undefined" && window.localStorage) return window.localStorage; } catch(_) {}
    const m = new Map();
    return { getItem:k=>m.get(k)??null, setItem:(k,v)=>m.set(k,v), removeItem:k=>m.delete(k) };
  }
  function defaultMemory() { return { version: 3, weights: {}, games: 0, opp: {} }; }
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

  function wGet(key) { return memory.weights[key] ?? 0; }
  function wBump(key, delta) { memory.weights[key] = (memory.weights[key] ?? 0) + delta; }
  function oppSeat(id) { if (!memory.opp[id]) memory.opp[id] = { bids:{}, aggr:0, overtrump:0, avoid:0 }; return memory.opp[id]; }

  function featureKey({ card, pos, need, mode, trump, end }) {
    const isTrump = card.suit === trump ? 1 : 0;
    const bucket =
      card.rank >= 14 ? "A" :
      card.rank >= 13 ? "K" :
      card.rank >= 12 ? "Q" :
      card.rank >= 11 ? "J" :
      card.rank >= 10 ? "T" : "L";
    const needSign = need > 0 ? "pos" : need < 0 ? "neg" : "zero";
    const endFlag = end ? "E" : "N";
    return `v3|isT:${isTrump}|b:${bucket}|pos:${pos}|need:${needSign}|mode:${mode||"-"}|end:${endFlag}`;
  }

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
  const groupBySuit = (hand) => hand.reduce((m,c)=>((m[c.suit]??=[]).push(c), m), {});
  const cardsEqual = (a,b)=>a&&b&&a.id===b.id;

  function chooseBid(hand) {
    const AGGR = 0.25;
    const OVERBID_PENALTY = 0.25;
    const HARD_CAP8_STRONG_ONLY = true;
    const group = groupBySuit(hand);
    const suitKeys = Object.keys(group);
    if (!suitKeys.length) {
      const c0 = hand[0];
      return { count: betFromRank(c0.rank), suit: c0.suit, rank: c0.rank };
    }
    const perSuit = suitKeys.map(suit=>{
      const cards = group[suit];
      const est = suitStrength(cards, true);
      let target = Math.round(est + AGGR);
      const strong = cards.length >= 6 && (cards.some(c=>c.rank===14 || c.rank===13)) && cards.some(c=>c.rank===10) && cards.some(c=>c.rank===12 || c.rank===11);
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
      let rank;
      if (chosenCount === 0) {
        const pref = [13,12,11];
        rank = (pref.find(r=>cards.some(c=>c.rank===r))) ?? cards.find(c=>betFromRank(c.rank)===0).rank;
      } else if (chosenCount === 1) rank = 14;
      else rank = chosenCount;
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

  function fullDeck() {
    const { SUITS } = getState();
    const cards = [];
    for (const s of SUITS) for (const r of RANKS)
      cards.push({ id:`${s.key}${r}`, suit:s.key, suitIcon:s.icon, rank:r, label:`${rankLabel(r)}${s.icon}` });
    return cards;
  }
  function remainingCards({ myHand, table, seen }) {
    const deck = fullDeck();
    const toRemove = new Set([
      ...(myHand||[]).map(c=>c.id),
      ...(table||[]).map(pl=>pl.card?.id).filter(Boolean),
      ...(seen||[]).map(c=>c.id),
    ]);
    return deck.filter(c=>!toRemove.has(c.id));
  }

  function mergeVoidMaps(a, b) {
    if (!a && !b) return {};
    const out = {};
    for (const p of [0,1,2,3]) {
      const ax = a?.[p] || {};
      const bx = b?.[p] || {};
      const keys = new Set([...Object.keys(ax), ...Object.keys(bx)]);
      for (const k of keys) if (ax[k] || bx[k]) (out[p] ||= {})[k] = true;
    }
    return out;
  }
  function trickSeatOrder({ table, currentSeat }) {
    let lead = (table && table.length) ? table[0].player : currentSeat;
    return [lead, (lead+1)%4, (lead+2)%4, (lead+3)%4];
  }
  function estimateHandCounts({ state, myHand }) {
    const counts = {};
    if (state && state.hands && Array.isArray(state.hands)) {
      for (let i=0;i<4;i++) counts[i] = state.hands[i]?.length ?? 0;
      return counts;
    }
    const myLen = myHand?.length ?? 13;
    for (let i=0;i<4;i++) counts[i] = (i===seat ? myLen : 13);
    return counts;
  }

  function randomWeighted(arr, weights) {
    let s = 0;
    for (let i=0;i<weights.length;i++) s += weights[i];
    if (s <= 0) return arr[(Math.random()*arr.length)|0];
    let r = Math.random()*s;
    for (let i=0;i<weights.length;i++) {
      r -= weights[i];
      if (r <= 0) return arr[i];
    }
    return arr[arr.length-1];
  }

  function bidBiasFromState() {
    const st = getState() || {};
    const bias = {};
    const bids = st.bids || [];
    for (let p=0;p<4;p++) {
      const b = bids[p];
      if (!b) continue;
      bias[p] = { suit: b.suit, count: b.count||0 };
      const o = oppSeat(p);
      o.bids[b.suit] = (o.bids[b.suit]||0) + b.count;
      o.aggr += b.count;
    }
    saveMemory();
    return bias;
  }

  function sampleWorld({ remCards, players, mySeat, handCounts, voidMap }) {
    const need = {};
    for (const p of players) if (p !== mySeat) need[p] = handCounts?.[p] ?? 0;
    const shuffled = remCards.slice();
    for (let i=shuffled.length-1;i>0;i--) { const j=(Math.random()*(i+1))|0; [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]; }
    const hands = {}; for (const p of players) if (p!==mySeat) hands[p]=[];
    const reject = {};
    for (const p of players) {
      if (p===mySeat) continue;
      reject[p] = new Set();
      if (voidMap && voidMap[p]) for (const s of Object.keys(voidMap[p])) if (voidMap[p][s]) reject[p].add(s);
    }
    const bias = bidBiasFromState();
    for (let attempt=0; attempt<200; attempt++) {
      for (const p of players) if (p!==mySeat) hands[p]=[];
      for (const c of shuffled) {
        const cand = players.filter(p=>p!==mySeat && hands[p].length < need[p]);
        if (!cand.length) break;
        const w = [];
        for (const p of cand) {
          if (reject[p].has(c.suit)) { w.push(0.0001); continue; }
          let ww = 1.0;
          const o = oppSeat(p);
          if (c.suit=== (bias[p]?.suit)) ww += 0.7 + 0.1*(bias[p]?.count||0);
          if (c.suit === (getState()?.trump)) ww += 0.15 * (o.overtrump||0);
          ww += 0.02*(o.aggr||0);
          w.push(ww);
        }
        const pick = randomWeighted(cand, w);
        hands[pick].push(c);
      }
      let ok = true;
      for (const p of players) if (p!==mySeat) if (hands[p].length !== need[p]) { ok=false; break; }
      if (ok) return hands;
    }
    const fallback = {}; for (const p of players) if (p!==mySeat) fallback[p]=[];
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
    legals.sort(asc);
    return legals[0];
  }

  function simulateTrickWin({
    candidate, mySeat, seatOrder, handsBySeat, table, leadSuit, trump, trumpBroken
  }) {
    const hh = {};
    for (const p of seatOrder) hh[p] = handsBySeat[p].slice();
    const t = table.map(x=>({player:x.player, card:x.card}));
    hh[mySeat] = hh[mySeat].filter(c=>c.id!==candidate.id);
    const ld = leadSuit ?? candidate.suit;
    t.push({ player: mySeat, card: candidate });
    let curIdx = seatOrder.indexOf(mySeat);
    while (t.length < 4) {
      curIdx = (curIdx + 1) % 4;
      const p = seatOrder[curIdx];
      if (p === mySeat) continue;
      const isLead = t.length===0;
      const card = policyPlayRandomLegal({
        hand: hh[p], leadSuit: ld, trump, isLead, trumpBroken
      }) || hh[p][0];
      if (!card) return 0;
      hh[p] = hh[p].filter(c=>c.id!==card.id);
      t.push({ player:p, card });
    }
    const best = currentBest(t, ld, trump);
    return best.player === mySeat ? 1 : 0;
  }

  function exactEnumerateWorlds({ remCards, players, mySeat, handCounts, voidMap, limit=20000 }) {
    const targets = {};
    for (const p of players) if (p!==mySeat) targets[p] = handCounts?.[p] ?? 0;
    const suitsReject = {};
    for (const p of players) {
      if (p===mySeat) continue;
      const vm = voidMap?.[p] || {};
      suitsReject[p] = new Set(Object.keys(vm).filter(k=>vm[k]));
    }
    const others = players.filter(p=>p!==mySeat);
    const res = [];
    if (remCards.length === 0) { res.push({}); return res; }
    const nmax = remCards.length;
    function backtrack(i, acc, fillCount) {
      if (res.length >= limit) return;
      if (i===nmax) {
        for (const p of others) if ((fillCount[p]||0)!==(targets[p]||0)) return;
        res.push(JSON.parse(JSON.stringify(acc)));
        return;
      }
      const card = remCards[i];
      for (const p of others) {
        if ((fillCount[p]||0) >= (targets[p]||0)) continue;
        if (suitsReject[p].has(card.suit)) continue;
        (acc[p] ||= []).push(card);
        fillCount[p] = (fillCount[p]||0)+1;
        backtrack(i+1, acc, fillCount);
        acc[p].pop();
        fillCount[p]--;
        if (res.length >= limit) return;
      }
    }
    backtrack(0, {}, {});
    return res;
  }

  function heuristicBaseScore({ card, need, pos, isLead, leadSuit, trump, table, end }) {
    let s = 0;
    if (isLead) {
      if (need>0) s += (card.suit===trump?0.15:0.45) + card.rank/18;
      else s += (card.suit===trump?-1.1:-0.1) - card.rank/48;
    } else {
      const best = currentBest(table, leadSuit, trump);
      const willWin = beats(card, best?.card, leadSuit, trump);
      if (need>0) s += willWin ? (1.1 - card.rank/50) : -0.8;
      else s += willWin ? -1.1 : (card.suit===trump ? -0.25 : 0.35);
      if (pos===3 && need<=0) s += -0.12;
    }
    if (end && need<=0) s += (card.suit===trump ? -0.05 : 0.12);
    const key = featureKey({ card, pos, need, mode: null, trump, end });
    s += 0.5 * wGet(key);
    return s;
  }

  function pickCard(ctx) {
    const {
      hand, leadSuit, trump, table,
      seen, voidMap: voidMapExt, need, pos, mode,
      seat: mySeat = seat,
      handCounts,
      trumpBroken = false,
    } = ctx;

    const isLead = !leadSuit;
    const legals = legalPlaysFrom(hand, leadSuit, trump, isLead, trumpBroken);
    if (!legals.length) return hand[0];

    let baseChoice = null;
    if (isLead) {
      if (need > 0) {
        const grouped = groupBySuit(hand);
        let bestSuit=null,bestScore=-1;
        for (const suit of Object.keys(grouped)) {
          const cards = grouped[suit];
          let sc = suitStrength(cards, suit===trump);
          if (suit===trump) sc -= 0.6;
          if (sc>bestScore) {bestScore=sc; bestSuit=suit;}
        }
        baseChoice = largestOfSuit(hand, bestSuit) || highestOverall(hand);
      } else {
        const nonTrump = hand.filter(c=>c.suit!==trump);
        baseChoice = nonTrump.length ? lowestOverall(nonTrump) : lowestOverall(hand);
      }
    } else {
      const alreadyTrumped = table.some(pl=>pl.card.suit===trump && leadSuit!==trump);
      if (need > 0) {
        if (hand.some(c=>c.suit===leadSuit)) {
          const best = currentBest(table, leadSuit, trump);
          const winMin = legals.filter(c=>beats(c, best?.card, leadSuit, trump)).sort(asc)[0];
          baseChoice = winMin || legals.sort(asc)[0];
        } else {
          if (alreadyTrumped) {
            const best = currentBest(table, leadSuit, trump);
            const over = hand.filter(c=>c.suit===trump && beats(c, best?.card, leadSuit, trump)).sort(asc)[0];
            baseChoice = over || lowestOverall(hand);
          } else {
            baseChoice = smallestTrump(hand, trump) || lowestOverall(hand);
          }
        }
      } else {
        if (hand.some(c=>c.suit===leadSuit)) baseChoice = legals.sort(asc)[0];
        else {
          const nonTrump = hand.filter(c=>c.suit!==trump);
          baseChoice = nonTrump.length ? highestOverall(nonTrump) : smallestTrump(hand, trump) || lowestOverall(hand);
        }
      }
    }
    if (!baseChoice) baseChoice = legals[0];

    const players = [0,1,2,3];
    const state = getState() || {};
    const vmMerged = mergeVoidMaps(internalVoidMap, voidMapExt);
    const rem = remainingCards({ myHand: hand, table, seen });
    const seatOrder = trickSeatOrder({ table, currentSeat: mySeat });
    const counts = handCounts || estimateHandCounts({ state, myHand: hand });

    const end = hand.length <= 3;
    const candidates = legals;
    const alpha = 1.0;

    const scored = candidates.map(c=>({ card:c, score: heuristicBaseScore({card:c, need, pos, isLead, leadSuit, trump, table, end}), winProb: 0, evDelta: 0 }));

    const assignable = rem.length;
    const sumOpp = players.filter(p=>p!==mySeat).reduce((s,p)=>s+(counts[p]||0),0);
    const exactFeasible = assignable<=6 && sumOpp<=6;

    if (exactFeasible) {
      const worlds = exactEnumerateWorlds({ remCards: rem, players, mySeat, handCounts: counts, voidMap: vmMerged, limit: 30000 });
      for (let i=0;i<scored.length;i++) {
        let wins=0, trials=0;
        for (const w of worlds) {
          const handsBySeat = {};
          for (const p of players) {
            if (p===mySeat) handsBySeat[p] = hand.slice();
            else handsBySeat[p] = (w[p]||[]).slice();
          }
          for (const pl of table) if (pl?.card) {
            const owner = pl.player;
            handsBySeat[owner] = handsBySeat[owner].filter(x=>x.id!==pl.card.id);
          }
          wins += simulateTrickWin({
            candidate: scored[i].card,
            mySeat, seatOrder, handsBySeat, table, leadSuit, trump, trumpBroken
          });
          trials++;
        }
        const wp = trials? wins/trials : 0;
        scored[i].winProb = wp;
        const urgency = need>0 ? Math.min(1, (need)/(hand.length)) : -Math.min(1, (-need)/(hand.length));
        scored[i].evDelta = urgency * (2*wp - 1);
        scored[i].score += alpha * (need>0 ? wp : -wp*0.6) + 0.6*scored[i].evDelta;
      }
    } else {
      const dynRoll = dynamicRollouts({ base: mcRollouts, need, handLeft: hand.length, pos, isLead });
      for (let i=0;i<scored.length;i++) {
        let wins = 0, trials = 0;
        for (let r=0; r<dynRoll; r++) {
          const world = sampleWorld({ remCards: rem, players, mySeat, handCounts: counts, voidMap: vmMerged });
          const handsBySeat = {};
          for (const p of players) {
            if (p===mySeat) handsBySeat[p] = hand.slice();
            else handsBySeat[p] = world[p] ? world[p].slice() : [];
          }
          for (const pl of table) if (pl?.card) {
            const owner = pl.player;
            handsBySeat[owner] = handsBySeat[owner].filter(x=>x.id!==pl.card.id);
          }
          wins += simulateTrickWin({
            candidate: scored[i].card,
            mySeat, seatOrder, handsBySeat, table, leadSuit, trump, trumpBroken
          });
          trials++;
        }
        const wp = trials? wins/trials : 0;
        scored[i].winProb = wp;
        const urgency = need>0 ? Math.min(1, (need)/(hand.length)) : -Math.min(1, (-need)/(hand.length));
        scored[i].evDelta = urgency * (2*wp - 1);
        scored[i].score += alpha * (need>0 ? wp : -wp*0.6) + 0.6*scored[i].evDelta;
      }
    }

    scored.sort((a,b)=>b.score-a.score);
    const picked = scored[0].card;

    lastAction = {
      key: featureKey({ card:picked, pos, need, mode, trump, end }),
      seat: mySeat,
      context: { pos, need, mode, trump, leadSuit, end }
    };

    return picked;
  }

  function dynamicRollouts({ base, need, handLeft, pos, isLead }) {
    let k = base;
    if (need>0) k += 150 + 30*Math.max(0, 4-pos);
    if (handLeft<=5) k += 100;
    if (handLeft<=3) k += 150;
    if (!isLead && pos===3) k += 80;
    return Math.min(1200, Math.max(60, Math.round(k)));
  }

  function observePlay({ player, card, leadSuit }) {
    if (!leadSuit) return;
    if (card.suit !== leadSuit) {
      internalVoidMap[player] ??= {};
      internalVoidMap[player][leadSuit] = true;
      if (card.suit === (getState()?.trump)) {
        const o = oppSeat(player); o.overtrump += 1; saveMemory();
      }
    }
  }

  function observeTrick({ plays, winner, trump, leadSuit }) {
    for (const pl of plays) if (pl.card.suit !== leadSuit) {
      internalVoidMap[pl.player] ??= {};
      internalVoidMap[pl.player][leadSuit] = true;
      if (pl.card.suit === trump) { const o = oppSeat(pl.player); o.overtrump += 0.2; }
    }
    const myPlay = plays.find(p=>p.player===seat);
    if (!myPlay || !lastAction) return;
    const needSign = Math.sign(lastAction.context?.need ?? 0);
    const didWin = winner === seat;
    const end = lastAction.context?.end ? 1 : 0;
    let delta = 0;
    if (needSign > 0) delta = didWin ? +0.18 : -0.14;
    else if (needSign < 0) delta = didWin ? -0.16 : +0.09;
    else delta = didWin ? -0.06 : +0.05;
    if (end) delta *= 1.25;
    wBump(lastAction.key, delta);
    saveMemory();
    lastAction = null;
  }

  return {
    chooseBid,
    pickCard,
    observePlay,
    observeTrick,
    reset,
    setSeat,
  };
}
