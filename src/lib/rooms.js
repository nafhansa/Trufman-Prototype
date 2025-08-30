// src/lib/rooms.js
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

/* ===================== READ ===================== */
export async function fetchSeats(roomId) {
  const { data, error } = await supabase
    .from("room_seats")
    .select("seat,user_id,display_name")
    .eq("room_id", roomId)
    .order("seat", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchState(roomId) {
  const { data, error } = await supabase
    .from("room_state")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/* ===================== CREATE ROOM ===================== */
// Membuat room baru; otomatis mencoba claim seat 0 untuk creator.
export async function createRoom() {
  const user = await getUser();
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("room_state")
    .insert({ created_by: user.id }) // status & code dihandle default/generated column
    .select("id")
    .single();
  if (error) throw error;

  const roomId = data.id;
  try {
    await claimSeat(roomId, 0);
  } catch {
    // abaikan jika gagal claim
  }
  return roomId;
}

/* ===================== JOIN BY CODE/UUID ===================== */
// Bisa pakai full UUID, atau kode pendek (prefix) yang disimpan di kolom room_state.code
export async function joinByCode(input) {
  const key = (input || "").trim();
  if (!key) throw new Error("Masukkan kode/ID room");

  let q = supabase.from("room_state").select("id").limit(1);

  if (isUuid(key)) {
    q = q.eq("id", key);
  } else {
    // izinkan 6–12 char prefix; kolom `code` bertipe text, biasanya 8 char
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

  const { data, error } = await supabase
    .from("room_seats")
    .insert({
      room_id: roomId,
      seat: s,
      user_id: user.id,
      display_name: displayNameFromUser(user),
    })
    .select("*")
    .single();

  if (error) {
    // 23505 = unique_violation (PK (room_id, seat) sudah ada)
    if (error.code === "23505") throw new Error("Seat sudah diambil");
    throw error;
  }
  return data;
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

// Opsional: melepas semua seat milik user di room tsb
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

/* ===================== REALTIME ===================== */
// Auto-fetch sekali di awal, lalu dengarkan perubahan via Realtime.
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
    .eq("created_by", user.id); // biar cuma owner yang boleh
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
