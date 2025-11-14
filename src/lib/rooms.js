import { supabase, getUser } from "./supabaseClient";

/* ===================== Utils ===================== */
const isUuid = (v) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v || "");

const displayNameFromUser = (u) =>
  u?.user_metadata?.full_name ||
  u?.user_metadata?.name ||
  u?.email?.split("@")[0] ||
  "Player";

const assertSeat = (s) => {
  const n = Number(s);
  if (![0, 1, 2, 3].includes(n)) throw new Error("Seat harus 0..3");
  return n;
};

/* ===================== BOT HELPERS ===================== */
export function isBotUserId(userId) {
  return typeof userId === "string" && userId.startsWith("bot:");
}
export const isBotRow = (row) => !!row?.is_bot || isBotUserId(row?.user_id);

/* ===================== READ ===================== */
export async function fetchSeats(roomId) {
  const { data, error } = await supabase
    .from("room_seats")
    .select("seat,user_id,display_name,is_bot")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchState(roomId) {
  const { data, error } = await supabase
    .from("room_state")
    .select("id, created_by, status, require_trump_broken")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/* ===================== UPDATE ROOM OPTIONS ===================== */
export async function updateRoomOptions(roomId, { requireTrumpBroken }) {
  const user = await getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("room_state")
    .update({ require_trump_broken: !!requireTrumpBroken })
    .eq("id", roomId)
    .eq("created_by", user.id);
  if (error) throw error;
  return true;
}

/* ===================== CREATE ROOM ===================== */
export async function createRoom() {
  const user = await getUser();
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("room_state")
    .insert({ created_by: user.id })
    .select("id")
    .single();
  if (error) throw error;

  const roomId = data.id;
  try { await claimSeat(roomId, 0); } catch {}
  return roomId;
}

/* ===================== JOIN BY CODE/UUID ===================== */
export async function joinByCode(input) {
  const key = (input || "").trim();
  if (!key) throw new Error("Masukkan kode/ID room");

  let q = supabase.from("room_state").select("id").limit(1);

  if (isUuid(key)) {
    q = q.eq("id", key);
  } else {
    if (key.length >= 6 && key.length <= 12) {
      q = q.ilike("code", `${key}%`);
    } else {
      throw new Error("Kode room tidak valid");
    }
  }

  const { data, error } = await q;
  if (error) throw error;
  if (!data?.length) throw new Error("Room tidak ditemukan");
  return data[0].id;
}

/* ===================== CLAIM / RELEASE ===================== */
export async function claimSeat(roomId, seat) {
  const user = await getUser();
  if (!user) throw new Error("Not signed in");
  const s = assertSeat(seat);

  const { error } = await supabase.from("room_seats").insert({
    room_id: roomId,
    seat: s,
    user_id: user.id,
    display_name: displayNameFromUser(user),
    is_bot: false,
  });
  if (error) {
    if (error.code === "23505") throw new Error("Seat sudah diambil");
    throw error;
  }
  return true;
}

export async function releaseSeat(roomId, seat) {
  const user = await getUser();
  if (!user) throw new Error("Not signed in");
  const s = assertSeat(seat);

  const { error } = await supabase
    .from("room_seats")
    .delete()
    .eq("room_id", roomId)
    .eq("seat", s)
    .eq("user_id", user.id);
  if (error) throw error;
  return true;
}

export async function releaseAllMySeats(roomId) {
  const user = await getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("room_seats")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", user.id);
  if (error) throw error;
  return true;
}

/* ===================== BOTS ===================== */
export async function addBotToSeat(roomId, seat) {
  const s = assertSeat(seat);

  const botId = `bot:${roomId}:${s}`;
  let { data: map } = await supabase
    .from("bot_user_map")
    .select("bot_uid")
    .eq("bot_id", botId)
    .maybeSingle();

  if (!map) {
    const bot_uid = crypto.randomUUID();
    const { error: insErr } = await supabase
      .from("bot_user_map")
      .insert({ bot_id: botId, bot_uid });
    if (insErr) {
      // Jika conflict, coba ambil lagi
      const { data: retry } = await supabase
        .from("bot_user_map")
        .select("bot_uid")
        .eq("bot_id", botId)
        .maybeSingle();
      map = retry || { bot_uid: crypto.randomUUID() };
    } else {
      map = { bot_uid };
    }
  }

  const { error } = await supabase.from("room_seats").insert({
    room_id: roomId,
    seat: s,
    user_id: map.bot_uid,
    is_bot: true,
    display_name: `Bot P${s + 1}`,
  });
  if (error) {
    if (error.code === "23505") throw new Error("Seat sudah diambil");
    throw error;
  }
}

export async function removeBotByUserId(roomId, userId) {
  const { error } = await supabase
    .from("room_seats")
    .delete()
    .match({ room_id: roomId, user_id: userId, is_bot: true });
  if (error) throw error;
}

/* ===================== REALTIME ===================== */
export function subscribeRoom(roomId, { onSeats, onState } = {}) {
  if (onSeats) fetchSeats(roomId).then(onSeats).catch(() => {});
  if (onState) fetchState(roomId).then(onState).catch(() => {});

  const chSeats = supabase
    .channel(`room:${roomId}:seats`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "room_seats", filter: `room_id=eq.${roomId}` },
      () => { onSeats && fetchSeats(roomId).then(onSeats).catch(() => {}); }
    )
    .subscribe();

  const chState = supabase
    .channel(`room:${roomId}:state`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "room_state", filter: `id=eq.${roomId}` },
      () => { onState && fetchState(roomId).then(onState).catch(() => {}); }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(chSeats);
    supabase.removeChannel(chState);
  };
}

/** host (owner) menekan Start -> ubah status room jadi 'playing' */
export async function startGame(roomId) {
  const user = await getUser();
  if (!user) throw new Error("Not signed in");
  const { error } = await supabase
    .from("room_state")
    .update({ status: "playing" })
    .eq("id", roomId)
    .eq("created_by", user.id);
  if (error) throw error;
}

/** selesai (atau force stop) -> kembalikan ke 'waiting' */
export async function endGame(roomId) {
  const { error } = await supabase
    .from("room_state")
    .update({ status: "waiting" })
    .eq("id", roomId);
  if (error) throw error;
}
