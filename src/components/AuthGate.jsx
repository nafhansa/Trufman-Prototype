import React, { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import SignIn from "./SignIn";

export default function AuthGate({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-zinc-900 text-stone-200">
        <div className="animate-pulse">Memuat…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen grid place-items-center bg-zinc-900 px-4">
        <SignIn />
      </div>
    );
  }

  return <>{children}</>;
}
