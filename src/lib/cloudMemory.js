import { supabase } from './supabaseClient';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY



export const debounce = (fn, ms = 600) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

const TABLE = 'bot_memory';
const CLIENT_KEY = 'trufman_client_id_v1';

function getClientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2)) + Date.now().toString(36);
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    // SSR / private mode fallback
    return 'local-' + Math.random().toString(36).slice(2);
  }
}

export async function cloudLoad(seat) {
  try {
    const client_id = getClientId();
    const { data, error } = await supabase
      .from(TABLE)
      .select('data')
      .eq('client_id', client_id)
      .eq('seat', seat)
      .maybeSingle();

    if (error) return null;
    return data?.data ?? null;
  } catch {
    return null;
  }
}

export async function cloudSave(seat, payload) {
  try {
    const client_id = getClientId();
    const row = { client_id, seat, data: payload };
    const { error } = await supabase
      .from(TABLE)
      .upsert(row, { onConflict: 'client_id,seat' }); // PK gabungan

    return !error;
  } catch {
    return false;
  }
}
