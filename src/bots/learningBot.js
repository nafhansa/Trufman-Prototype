// src/bots/learningBot.js

/** ==== Learning Heuristic Bot (v1) ====================================== */
/** Prinsip:
 * - State dibinning → jadi key string.
 * - Setiap kelas aksi simpan reward rata2 (r_sum / n).
 * - Pemilihan aksi: epsilon-greedy (kadang eksplor, sering eksploit).
 * - Persist di localStorage biar “ingat” antar sesi.
 */

export function createLearningBot(storageKey = "trufbot_v1") {
  const mem = load() || { version: 1, epsilon: 0.12, counts: {} };

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(mem)); } catch {}
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; }
  }
  function reset() { mem.counts = {}; save(); }

  // --- Feature binning konteks
  function needBin(need) { return need <= -1 ? "-1" : need >= 1 ? "+1" : "0"; }
  function posBin(pos) { return String(pos); } // 0..3
  function ctxKey(ctx) {
    // ctx: { mode, pos, leadSuit, trumpBroken, need }
    return [
      ctx.mode, `pos:${posBin(ctx.pos)}`,
      `need:${needBin(ctx.need)}`,
      `lead:${ctx.leadSuit || "-"}`,
      `tb:${ctx.trumpBroken ? 1 : 0}`
    ].join("|");
  }

  // --- Kelas aksi: T/N (trump/nontrump) - F/O (follow/off) - L/M/H (low/mid/high)
  function rankBucketInSuit(card, legal) {
    const same = legal.filter(c => c.suit === card.suit).map(c => c.rank).sort((a,b)=>a-b);
    if (!same.length) return "x";
    const i = same.indexOf(card.rank);
    const t = same.length;
    if (i <= Math.floor((t-1)/3)) return "L";
    if (i >= Math.ceil(2*(t-1)/3)) return "H";
    return "M";
  }
  function actionKey(card, { leadSuit, trump, legal }) {
    const follow = leadSuit && card.suit === leadSuit;
    const isTrump = card.suit === trump;
    const bucket = rankBucketInSuit(card, legal);
    return `${isTrump ? "T" : "N"}-${follow ? "F" : "O"}-${bucket}`;
  }

  // --- Heuristik dasar (jadi prior kecil juga)
  function basicHeuristic(card, { leadSuit, trump, legal, need, mode }) {
    let s = 0;
    const follow = leadSuit && card.suit === leadSuit;
    const isTrump = card.suit === trump;

    if (follow) s += card.rank / 2;
    if (!follow && isTrump) s += card.rank;        // void → truf bagus
    if (!follow && !isTrump) s -= card.rank / 4;   // buang nontruf besar dihindari

    if (need > 0) { // perlu menang
      if (isTrump) s += 4;
      s += card.rank / 3;
    } else if (need < 0) { // sebaiknya kalah
      if (!isTrump) s += 1;
      s -= card.rank / 2;
    }

    if (mode === "BAWAH" && (isTrump || (follow && card.rank >= 12))) s -= 1.2;
    s -= card.rank / 40; // hemat tinggi
    return s;
  }

  function pickWithEpsGreedy(cands, eps) {
    if (Math.random() < eps) {
      // eksplor (berbobot heuristic)
      const total = cands.reduce((a,c)=>a+Math.max(0.0001, c.hScore), 0);
      let r = Math.random() * total;
      for (const c of cands) { r -= Math.max(0.0001, c.hScore); if (r <= 0) return c; }
      return cands[cands.length-1];
    }
    // eksploit → avgReward + prior kecil heuristic
    return cands.sort((a,b) => (b.value - a.value) || (b.hScore - a.hScore))[0];
  }

  function chooseCard({ hand, legal, leadSuit, trump, mode, pos, need, trumpBroken }) {
    const ctx = { mode, pos, leadSuit, need, trumpBroken };
    const key = ctxKey(ctx);

    const cands = legal.map(card => {
      const ak = actionKey(card, { leadSuit, trump, legal });
      const node = (mem.counts[key]?.[ak]) || { n: 0, r: 0 };
      const avg = node.n ? (node.r / node.n) : 0;
      const hScore = basicHeuristic(card, { leadSuit, trump, legal, need, mode });
      const value = avg + hScore * 0.05; // prior kecil
      return { card, ak, key, value, hScore };
    });

    const pick = pickWithEpsGreedy(cands, mem.epsilon);
    return { card: pick.card, decision: { key, ak: pick.ak, ctx } };
  }

  // reward shaping: + menang saat butuh; - menang saat tidak butuh (mode-aware)
  function rewardOf({ won, mode, need }) {
    if (mode === "ATAS") {
      if (need > 0) return won ? +1.0 : -0.8;
      if (need < 0) return won ? -1.0 : +0.5;
      return won ? +0.3 : -0.3;
    } else {
      if (need > 0) return won ? +0.7 : -0.6;
      if (need < 0) return won ? -1.2 : +0.8;
      return won ? -0.2 : +0.2;
    }
  }

  function feedback(decision, won) {
    const { key, ak, ctx } = decision;
    mem.counts[key] ||= {};
    mem.counts[key][ak] ||= { n: 0, r: 0 };
    const rw = rewardOf({ won, mode: ctx.mode, need: ctx.need });
    mem.counts[key][ak].n += 1;
    mem.counts[key][ak].r += rw;
    save();
  }
  function feedbackBatch(decisions, winnerPid) {
    for (const d of decisions) {
      if (!d) continue;
      const won = d.player === winnerPid;
      feedback(d, won);
    }
  }

  return { chooseCard, feedback, feedbackBatch, reset, mem };
}
/** ==== END Learning Heuristic Bot ====================================== */

export default createLearningBot;
