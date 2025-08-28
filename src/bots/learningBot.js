// bots/learningBot.js

/**
 * Learning Bot (offline, no-API)
 * - Heuristik taktis:
 *   • Position-aware (pos 0..3), target-aware (need), trump control, void tracking.
 *   • Menang seminimal mungkin saat butuh; buang aman saat tidak butuh.
 * - Pembelajaran ringan:
 *   • Bobot preferensi per fitur (isTrump, rank bucket, posisi, needSign, mode).
 *   • Update saat selesai trick berdasarkan apakah aksi tadi "bagus" sesuai target.
 *   • Persist ke localStorage (key = memoryKey + `:seat:${seat}`).
 *
 * API yang diharapkan App.jsx:
 *   createLearningBot({ seat, getState, memoryKey })
 *   -> { chooseBid(hand, ctx), pickCard(ctx), observePlay(ev), observeTrick(ev), reset({hard}), setSeat(seat) }
 */

export function createLearningBot({ seat = 1, getState, memoryKey = "trufman_bot_memory_v1" } = {}) {
  // ===== Utilities: deck & rules =====
  const RANKS = [2,3,4,5,6,7,8,9,10,11,12,13,14]; // J=11,Q=12,K=13,A=14
  const rankLabel = (r) => (r <= 10 ? String(r) : ({11:"J",12:"Q",13:"K",14:"A"}[r]));
  const betFromRank = (rank) => (rank === 14 ? 1 : (rank >= 11 && rank <= 13 ? 0 : rank));

  function makeDeck(SUITS) {
    const cards = [];
    for (const s of SUITS) for (const r of RANKS)
      cards.push({ id: `${s.key}${r}`, suit: s.key, suitIcon: s.icon, rank: r, label: `${rankLabel(r)}${s.icon}` });
    return cards;
  }

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
    for (const pl of plays) {
      if (!best || beats(pl.card, best.card, leadSuit, trump)) best = pl;
    }
    return best;
  }

  function legalPlays(hand, leadSuit, trump) {
    if (!leadSuit) {
      // Tidak boleh LEAD truf sebelum broken → aturan ini ditangani App (canPlay),
      // jadi di sini cukup return semua; App akan menolak yang ilegal.
      return hand.slice();
    }
    const follow = hand.filter(c => c.suit === leadSuit);
    return follow.length ? follow : hand.slice();
  }

  // ===== Persistence (localStorage) =====
  const storage = safeStorage();
  const storeKey = `${memoryKey}:seat:${seat}`;
  let memory = loadMemory();

  function safeStorage() {
    try {
      if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    } catch (_) {}
    // Fallback in-memory
    const shim = new Map();
    return {
      getItem: (k) => shim.get(k) ?? null,
      setItem: (k, v) => shim.set(k, v),
      removeItem: (k) => shim.delete(k),
    };
  }

  function loadMemory() {
    try {
      const raw = storage.getItem(storeKey);
      if (!raw) return defaultMemory();
      const obj = JSON.parse(raw);
      // guard defaults
      obj.version ??= 1;
      obj.weights ??= {};
      obj.games ??= 0;
      return obj;
    } catch (_) {
      return defaultMemory();
    }
  }

  function saveMemory() {
    try { storage.setItem(storeKey, JSON.stringify(memory)); } catch (_) {}
  }

  function defaultMemory() {
    return {
      version: 1,
      weights: {},  // key → weight (float)
      games: 0,
    };
  }

  function reset({ hard = false } = {}) {
    // Soft: tidak hapus learned weights (hanya digunakan oleh App untuk reset ronde).
    if (hard) {
      memory = defaultMemory();
      saveMemory();
    }
    // Reset jejak aksi terakhir
    lastAction = null;
  }

  function setSeat(newSeat) {
    if (newSeat === seat) return;
    // Simpan seat lama
    saveMemory();
    // Ganti seat → muat memori seat baru
    seat = newSeat;
    // update key & memory
    const newKey = `${memoryKey}:seat:${seat}`;
    const oldKey = storeKey;
    // rebind global key var by closure trick:
    // (we can't reassign const; emulate with local var)
    storeKeyRef.key = newKey;
    memory = loadMemory();
  }
  // hacky mutable ref untuk key
  const storeKeyRef = { key: storeKey };
  Object.defineProperty(globalThis, "__TRUFMAN_STOREKEY_HACK__", {
    get() { return storeKeyRef.key; },
    set(v) { storeKeyRef.key = v; },
    configurable: true
  });

  // ===== Heuristic helpers =====
  function suitStrength(hand, suit) {
    // Nilai kasar suit (untuk bidding & lead): high cards & length
    const ranks = hand.filter(c => c.suit === suit).map(c => c.rank).sort((a,b)=>b-a);
    if (ranks.length === 0) return 0;
    let score = ranks.length * 0.8;
    for (const r of ranks) {
      if (r >= 14) score += 2.2;  // A
      else if (r >= 13) score += 1.6; // K
      else if (r >= 12) score += 1.2; // Q
      else if (r >= 11) score += 0.8; // J
      else if (r >= 10) score += 0.5;
    }
    return score;
  }

  function minimalWinningCard(hand, table, leadSuit, trump) {
    const best = currentBest(table, leadSuit, trump);
    // Cari kartu terkecil yang mengalahkan best
    const candidates = legalPlays(hand, leadSuit, trump)
      .filter(c => beats(c, best?.card, leadSuit, trump))
      .sort((a,b)=>a.rank-b.rank);
    return candidates[0] || null;
  }

  function lowestFollowing(hand, leadSuit, trump) {
    const candidates = legalPlays(hand, leadSuit, trump).slice().sort((a,b)=>a.rank-b.rank);
    return candidates[0] || null;
  }

  function highestOfSuit(hand, suit) {
    return hand.filter(c => c.suit === suit).sort((a,b)=>b.rank-a.rank)[0] || null;
  }
  function lowestOfSuit(hand, suit) {
    return hand.filter(c => c.suit === suit).sort((a,b)=>a.rank-b.rank)[0] || null;
  }
  function smallestTrump(hand, trump) {
    return hand.filter(c => c.suit === trump).sort((a,b)=>a.rank-b.rank)[0] || null;
  }
  function lowestOverall(hand) {
    return hand.slice().sort((a,b)=>a.rank-b.rank)[0] || null;
  }
  function highestOverall(hand) {
    return hand.slice().sort((a,b)=>b.rank-a.rank)[0] || null;
  }

  function someoneTrumped(table, leadSuit, trump) {
    return table.some(pl => pl.card.suit === trump && leadSuit !== trump);
    // (Kalau lead truf, ini akan true untuk semua; tapi konteks “sudah ada yang motong” biasanya leadSuit !== trump)
  }

  // ===== Learning features & weights =====
  function featureKey({ card, pos, need, mode, trump }) {
    const isTrump = card.suit === trump ? 1 : 0;
    const bucket =
      card.rank >= 14 ? "A" :
      card.rank >= 13 ? "K" :
      card.rank >= 12 ? "Q" :
      card.rank >= 11 ? "J" :
      card.rank >= 9  ? "T" : "L"; // low
    const needSign = need > 0 ? "pos" : need < 0 ? "neg" : "zero";
    return `v1|isT:${isTrump}|b:${bucket}|pos:${pos}|need:${needSign}|mode:${mode||"-"}`;
  }

  function weightOf(key) {
    return memory.weights[key] ?? 0;
  }
  function bumpWeight(key, delta) {
    memory.weights[key] = (memory.weights[key] ?? 0) + delta;
  }

  // Akan diisi saat pickCard agar bisa di-update pada observeTrick
  let lastAction = null; // { key, seat, trickId, when, context }

  // ===== Bid selection =====
  function chooseBid(hand /*, ctx*/) {
    const st = getState();
    const { SUITS, suitOrder } = st;

    // Pilih suit terkuat non-trump (trump belum ditentukan di fase bidding),
    // mapping bet dari kartu rank asli yang dipilih.
    // Cari kartu di suit terbaik dengan betFromRank tertinggi.
    let bestSuit = null, bestScore = -1;
    for (const s of SUITS) {
      const sc = suitStrength(hand, s.key);
      if (sc > bestScore || (sc === bestScore && suitOrder[s.key] > suitOrder[bestSuit])) {
        bestSuit = s.key; bestScore = sc;
      }
    }
    // Pilih kartu yang memberi "count" tertinggi dalam suit tsb
    const options = hand
      .filter(c => c.suit === bestSuit)
      .map(c => ({ rank: c.rank, count: betFromRank(c.rank) }))
      .sort((a,b)=> b.count - a.count || b.rank - a.rank);
    const pick = options[0] || { rank: hand[0].rank, count: betFromRank(hand[0].rank) };
    return { count: pick.count, suit: bestSuit, rank: pick.rank };
  }

  // ===== Card selection (heuristik + bobot belajar) =====
  function pickCard({
    hand, leadSuit, trump, table, seen, voidMap, need, pos, mode, targets, tricksWon, seat: mySeat
  }) {
    const st = getState();
    const { SUITS } = st;

    // Kandidat legal sesuai aturan (App memastikan legality akhir)
    const candidates = legalPlays(hand, leadSuit, trump);
    if (candidates.length === 0) return hand[0];

    // ===== Heuristik dasar =====
    let choice = null;

    // Jika posisi lead (pos=0)
    if (!leadSuit) {
      const needSign = Math.sign(need);
      if (needSign > 0) {
        // Butuh menang → lead suit terkuat non-trump jika bisa; kalau tidak, lead trump terkecil (break jika perlu)
        // Pilih suit dengan high-card stopper (A/K) & panjang
        let best = null, bestScore = -1;
        for (const s of SUITS) {
          const hs = highestOfSuit(hand, s.key);
          if (!hs) continue;
          let sc = suitStrength(hand, s.key);
          if (s.key === trump) sc -= 0.7; // sedikit penalti memecah trump dari lead
          if (sc > bestScore) { bestScore = sc; best = s.key; }
        }
        choice = best ? highestOfSuit(hand, best) : highestOverall(hand);
      } else {
        // Tidak butuh menang → lead suit di mana kita cenderung tidak akan menang (low lead, hindari trump)
        // Cari suit terpanjang yang low.
        let best = null, bestScore = 1e9;
        for (const s of SUITS) {
          if (s.key === trump) continue;
          const lo = lowestOfSuit(hand, s.key);
          if (!lo) continue;
          // Penalti kalau kartu kita tinggi → ingin skor kecil
          const sc = lo.rank + (countSuit(hand, s.key) <= 2 ? 5 : 0);
          if (sc < bestScore) { bestScore = sc; best = lo; }
        }
        choice = best || lowestOverall(hand);
      }
    } else {
      // Posisi bukan lead
      const alreadyTrumped = someoneTrumped(table, leadSuit, trump);

      if (need > 0) {
        // Perlu menang trick
        if (hand.some(c => c.suit === leadSuit)) {
          // Bisa follow: mainkan minimal yang cukup untuk menang
          const winMin = minimalWinningCard(hand, table, leadSuit, trump);
          choice = winMin || lowestFollowing(hand, leadSuit, trump);
        } else {
          // Tidak bisa follow
          if (alreadyTrumped) {
            // Ada yang motong → coba overtrump serendah mungkin
            const best = currentBest(table, leadSuit, trump);
            const myTrumps = hand.filter(c => c.suit === trump && beats(c, best.card, leadSuit, trump))
                                 .sort((a,b)=>a.rank-b.rank);
            choice = myTrumps[0] || lowestOverall(hand); // kalau tak bisa overtrump, buang
          } else {
            // Belum ada yang motong → potong dengan truf terkecil
            choice = smallestTrump(hand, trump) || lowestOverall(hand);
          }
        }
      } else {
        // Tidak perlu menang (atau bahkan perlu menghindari)
        if (hand.some(c => c.suit === leadSuit)) {
          // Follow dengan kartu terendah
          choice = lowestFollowing(hand, leadSuit, trump);
          // Jika kita di posisi terakhir dan semua sudah kecil, pertimbangkan naik sedikit untuk buang high "aman"
          if (pos === 3) {
            // kalau semua di meja rendah, tetap rendah; kalau leader rendah tapi belum ada trump, tetap rendah.
          }
        } else {
          // Tak bisa follow → buang kartu tinggi di suit yang "aman" (bukan trump)
          const nonTrump = hand.filter(c => c.suit !== trump);
          if (nonTrump.length) {
            // buang yang tertinggi agar tidak menang trick lain di masa depan
            choice = highestOverall(nonTrump);
          } else {
            // semua trump → mainkan yang paling kecil supaya kecil peluang menang
            choice = smallestTrump(hand, trump) || lowestOverall(hand);
          }
        }
      }
    }

    if (!choice) choice = lowestOverall(hand);

    // ===== Penyesuaian berdasarkan voidMap & posisi lawan =====
    // Jika lawan kanan (pos berikutnya) void di leadSuit dan kita akan follow kecil → hati-hati ketimpa trump.
    if (leadSuit) {
      const right = (seat + 1) % 4; // pemain setelah kita
      if (voidMap && voidMap[right] && voidMap[right][leadSuit]) {
        // tingkatkan kecenderungan untuk main lebih tinggi saat butuh menang
        if (need > 0 && hand.some(c => c.suit === leadSuit)) {
          const winMin = minimalWinningCard(hand, table, leadSuit, trump);
          if (winMin) choice = winMin; // naikkan agar mengamankan trick
        }
      }
    }

    // ===== Scoring berbasis bobot belajar (rerank kandidat yang setara) =====
    // Hitung skor dasar: gunakan heuristik “seberapa sesuai” dengan tujuan.
    function baseScore(card) {
      // preferensi dasar:
      // - jika need>0 → suka kartu yang MENANG tapi serendah mungkin
      // - jika need<=0 → suka kartu yang KALAH (atau aman) dan non-trump
      let s = 0;
      if (!leadSuit) {
        // lead: prefer non-trump, high jika need>0; low jika need<=0
        if (need > 0) s += (card.suit === trump ? 0.2 : 0.5) + card.rank / 20;
        else s += (card.suit === trump ? -1.2 : -0.2) - card.rank / 40;
      } else {
        const best = currentBest(table, leadSuit, trump);
        const willWin = beats(card, best?.card, leadSuit, trump);
        if (need > 0) s += willWin ? 1.0 - card.rank/60 : -0.8;
        else s += willWin ? -1.0 : 0.3 - (card.suit===trump?0.2:0);
      }
      return s;
    }

    // Tambahkan bobot belajar
    const scored = candidates.map(c => {
      const key = featureKey({ card: c, pos, need, mode, trump });
      return { card: c, score: baseScore(c) + weightOf(key) * 0.5, key };
    });
    scored.sort((a,b)=>b.score - a.score);

    const picked = scored[0].card;

    // Simpan aksi terakhir (untuk update saat observeTrick)
    lastAction = {
      key: scored[0].key,
      seat: mySeat,
      when: Date.now(),
      context: { pos, need, mode, trump, leadSuit }
    };

    return picked;
  }

  // ===== Observers =====
  function observePlay({ player, card, leadSuit }) {
    // Bisa dipakai untuk memperkaya statistik (mis. frekuensi overtrump lawan),
    // untuk versi sederhana kita tidak simpan apa-apa di sini.
    void player; void card; void leadSuit;
  }

  function observeTrick({ plays, winner, trump, leadSuit }) {
    // Cari apakah kita main di trick ini
    const myPlay = plays.find(p => p.player === seat);
    if (!myPlay || !lastAction) return;

    // Reward sederhana:
    //   - Jika need>0 saat memilih & kita MENANG → +Δ (bagus)
    //   - Jika need>0 tapi KALAH → −Δ
    //   - Jika need<=0 & MENANG → −Δ (overtrick/menang tak perlu)
    //   - Jika need<=0 & KALAH → +Δ (bagus, menghindari menang)
    // Δ bisa disesuaikan skala (agnostik pada skor ronde aktual).
    const needSign = needSignFromContext(lastAction.context);
    const didWin = winner === seat;
    let delta = 0;
    if (needSign > 0) delta = didWin ? +0.15 : -0.12;
    else if (needSign < 0) delta = didWin ? -0.15 : +0.08;
    else delta = didWin ? -0.05 : +0.05;

    bumpWeight(lastAction.key, delta);
    saveMemory();

    // Clear lastAction agar tidak double count
    lastAction = null;

    // (Opsional) bisa tambahkan reward kecil jika “menang dengan kartu minimal”
    void trump; void leadSuit;
  }

  function needSignFromContext(ctx) {
    if (!ctx) return 0;
    const n = ctx.need ?? 0;
    return n > 0 ? 1 : n < 0 ? -1 : 0;
  }

  // ===== Helpers =====
  function countSuit(hand, suit) {
    let n = 0; for (const c of hand) if (c.suit === suit) n++;
    return n;
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
