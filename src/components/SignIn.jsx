import { useState } from "react";
import { useNavigate, useInRouterContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function SignIn() {
  const inRouter = useInRouterContext();
  const nav = inRouter
      ? useNavigate()
      : (to, opts) => { window.location.replace(typeof to === "string" ? to : "/"); };
  const [tab, setTab] = useState("login"); // 'login' | 'register'

  // login
  const [loginId, setLoginId] = useState("");
  const [loginPw, setLoginPw] = useState("");
  const [busyLogin, setBusyLogin] = useState(false);
  const [loginMsg, setLoginMsg] = useState("");

  // register
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPw, setRegPw] = useState("");
  const [regPw2, setRegPw2] = useState("");
  const [busyReg, setBusyReg] = useState(false);
  const [regMsg, setRegMsg] = useState("");

  async function resolveEmailFromUsernameMaybe(id) {
    if (id.includes("@")) return id.trim().toLowerCase();
    // OPSIONAL: akan bekerja kalau SQL function di bawah sudah dibuat
    try {
      const { data, error } = await supabase.rpc("get_email_by_username", {
        p_username: id.trim().toLowerCase(),
      });
      if (error) return null;
      return data || null;
    } catch {
      return null;
    }
  }

  async function onLogin(e) {
    e?.preventDefault();
    setLoginMsg(""); setBusyLogin(true);
    try {
      let email = loginId.trim();
      if (!email.includes("@")) {
        const maybeEmail = await resolveEmailFromUsernameMaybe(email);
        if (!maybeEmail) throw new Error("Gunakan email, atau username tidak ditemukan.");
        email = maybeEmail;
      }
      const { error } = await supabase.auth.signInWithPassword({
        email, password: loginPw,
      });
      if (error) throw error;
      nav("/", { replace: true });
    } catch (err) {
      setLoginMsg(err.message || "Gagal login.");
    } finally {
      setBusyLogin(false);
    }
  }

  async function onGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/` },
    });
  }

  async function ensureProfile(userId, username, displayName) {
    // bikin row profiles kalau belum ada
    await supabase.from("profiles").upsert({
      id: userId,
      username: (username || "").trim().toLowerCase(),
      display_name: displayName || username || "",
    }, { onConflict: "id" });
  }

  async function onRegister(e) {
    e?.preventDefault();
    setRegMsg(""); setBusyReg(true);
    try {
      const uname = (regUsername || "").trim().toLowerCase();
      const email = (regEmail || "").trim().toLowerCase();
      if (!email.includes("@")) throw new Error("Email tidak valid.");
      if (regPw.length < 8) throw new Error("Password minimal 8 karakter.");
      if (regPw !== regPw2) throw new Error("Konfirmasi password tidak sama.");

      const { data, error } = await supabase.auth.signUp({
        email, password: regPw,
        options: { data: { full_name: uname } },
      });
      if (error) throw error;

      // Jika email confirmation OFF, user langsung tersedia → pastikan profiles dibuat.
      if (data?.user) await ensureProfile(data.user.id, uname, uname);

      setRegMsg("Registrasi berhasil. Cek email untuk verifikasi (jika diminta).");
      setRegUsername(""); setRegEmail(""); setRegPw(""); setRegPw2("");
      setTab("login");
    } catch (err) {
      setRegMsg(err.message || "Gagal registrasi.");
    } finally {
      setBusyReg(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-zinc-900 text-stone-200 px-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-700/70 bg-zinc-900/80 shadow-xl p-6">
        <h1 className="text-center text-3xl font-extrabold text-amber-300 mb-5">
          Masuk ke Trufman
        </h1>

        {/* Tabs */}
        <div className="mb-5">
          <div className="flex rounded-md bg-zinc-800/70 p-1">
            <button
              onClick={() => setTab("login")}
              className={`flex-1 py-2 rounded md:text-sm font-semibold transition
                ${tab === "login" ? "bg-zinc-900 text-stone-100 shadow" : "text-stone-400 hover:text-stone-200"}`}
            >
              Login
            </button>
            <button
              onClick={() => setTab("register")}
              className={`flex-1 py-2 rounded md:text-sm font-semibold transition
                ${tab === "register" ? "bg-zinc-900 text-stone-100 shadow" : "text-stone-400 hover:text-stone-200"}`}
            >
              Register
            </button>
          </div>
        </div>

        {tab === "login" ? (
          <form onSubmit={onLogin} className="space-y-3">
            <div>
              <label className="block text-sm mb-1 text-stone-300">Username atau Email</label>
              <input
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 placeholder-stone-500"
                placeholder="contoh: rencana atau rencana@mail.com"
                value={loginId} onChange={(e) => setLoginId(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-stone-300">Password</label>
              <input
                type="password"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700"
                value={loginPw} onChange={(e) => setLoginPw(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={busyLogin}
              className="w-full py-2.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 font-bold"
            >
              {busyLogin ? "Memeriksa..." : "Login"}
            </button>

            <div className="relative my-3">
              <div className="h-px bg-zinc-700" />
              <span className="absolute left-1/2 -translate-x-1/2 -top-2.5 text-xs bg-zinc-900 px-2 text-stone-400">
                atau
              </span>
            </div>

            <button
              type="button"
              onClick={onGoogle}
              className="w-full py-2.5 rounded-lg bg-white text-black font-semibold hover:opacity-90"
            >
              Lanjut dengan Google
            </button>

            {loginMsg && <p className="text-sm mt-2 text-red-400">{loginMsg}</p>}
          </form>
        ) : (
          <form onSubmit={onRegister} className="space-y-3">
            <div>
              <label className="block text-sm mb-1 text-stone-300">Username</label>
              <input
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 placeholder-stone-500"
                placeholder="pilih username"
                value={regUsername} onChange={(e) => setRegUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-stone-300">Email</label>
              <input
                type="email"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700"
                value={regEmail} onChange={(e) => setRegEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1 text-stone-300">Password</label>
                <input
                  type="password"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700"
                  value={regPw} onChange={(e) => setRegPw(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-sm mb-1 text-stone-300">Ulangi Password</label>
                <input
                  type="password"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700"
                  value={regPw2} onChange={(e) => setRegPw2(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busyReg}
              className="w-full py-2.5 rounded-lg bg-red-700 hover:bg-red-600 disabled:opacity-50 font-bold"
            >
              {busyReg ? "Mendaftarkan..." : "Register"}
            </button>

            {regMsg && <p className="text-sm mt-2">{regMsg}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
