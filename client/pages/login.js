import { loginWithGoogle } from "../firebase";
import { useRouter } from "next/router";

export default function Login() {
  const router = useRouter();

  const handleLogin = async () => {
    const user = await loginWithGoogle();
    if (user) {
      // Simpan user di localStorage biar gampang diambil
      localStorage.setItem("user", JSON.stringify(user));
      router.push("/dashboard");
    }
  };

  return (
    <div className="h-screen bg-[#051109] flex flex-col items-center justify-center text-white relative overflow-hidden">
      {/* Cinematic Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-600/20 blur-[120px] rounded-full"></div>
        <div className="absolute top-1/4 left-1/3 w-[300px] h-[300px] bg-yellow-600/10 blur-[100px] rounded-full transition-all animate-pulse"></div>
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <div className="mb-6 transform hover:scale-110 transition-transform duration-500 cursor-default">
          <span className="text-8xl drop-shadow-[0_0_30px_rgba(234,179,8,0.5)]">🃏</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-black mb-2 text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 to-yellow-500 tracking-tighter uppercase italic drop-shadow-2xl">
          SUPER CARD BATTLE
        </h1>
        <p className="text-emerald-400 font-bold tracking-[0.3em] mb-12 uppercase opacity-80">The Ultimate Truf Experience</p>

        <button
          onClick={handleLogin}
          className="group relative px-8 py-4 bg-white text-black rounded-2xl font-black flex items-center gap-4 hover:bg-yellow-400 transition-all duration-300 shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:shadow-[0_10px_40px_rgba(234,179,8,0.4)] hover:-translate-y-1"
        >
          <img src="https://www.google.com/favicon.ico" className="w-6 h-6 grayscale group-hover:grayscale-0 transition-all" alt="Google" />
          <span className="text-lg uppercase">Mulai Bertarung</span>
        </button>

        <p className="mt-8 text-white/30 text-xs font-medium uppercase tracking-widest">Powered by Trufman Card Engine</p>
      </div>
    </div>
  );
}