// src/components/UserBar.jsx
import React from 'react';
import { supabase } from '../lib/supabaseClient';

export function UserBar({ session }) {
  const email = session?.user?.email ?? 'Anonymous';

  return (
    <div className="w-full bg-zinc-900 sticky top-0 z-40 border-b border-zinc-800">
      <div className="max-w-[1200px] mx-auto px-4 py-2 flex items-center justify-end gap-3 text-stone-200">
        <span className="text-xs md:text-sm opacity-80">{email}</span>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-xs rounded-md px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
