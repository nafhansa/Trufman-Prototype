// src/lib/presence.js
import { supabase } from "./supabaseClient";

/**
 * Join presence channel untuk 1 room.
 * - meta: object ringan (mis. display_name, seat)
 * - onChange(list): dipanggil setiap ada perubahan presence
 * Return: controller { update(meta), leave() }
 */
export async function joinRoomPresence(roomId, meta = {}, onChange) {
  const { data: { user } } = await supabase.auth.getUser();

  // key presence = user.id (biar satu device per user)
  const presenceKey = user?.id || `anon-${crypto.randomUUID()}`;
  const channel = supabase.channel(`presence:room:${roomId}`, {
    config: { presence: { key: presenceKey } },
  });

  const emitList = () => {
    // presenceState() -> { userId: [metas...] }
    const state = channel.presenceState();
    const seen = new Set();
    const list = Object.entries(state)
      .map(([user_id, metas]) => {
        const key = `${user_id}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          user_id,
          ...metas[metas.length - 1], // ambil meta terakhir
        };
      })
      .filter(Boolean);
    onChange?.(list);
  };

  channel
    .on("presence", { event: "sync"  }, emitList)
    .on("presence", { event: "join"  }, emitList)
    .on("presence", { event: "leave" }, emitList);

  await channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      channel.track({ ...meta, at: new Date().toISOString() });
    }
  });

  return {
    update(partial) {
      // kirim meta baru (overwrite di server)
      channel.track({ ...partial, at: new Date().toISOString() });
    },
    leave() {
      supabase.removeChannel(channel);
    }
  };
}
