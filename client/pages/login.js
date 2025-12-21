import { loginWithGoogle } from "../firebase";
import { useRouter } from "next/router";

export default function Login() {
  const router = useRouter();

  const handleLogin = async () => {
    const user = await loginWithGoogle();
    if (user) {
      // Simpan user di localStorage biar gampang diambil
      localStorage.setItem("user", JSON.stringify(user));
      localStorage.setItem("loginAt", Date.now().toString());
      router.push("/dashboard");
    }
  };

  return (
    <div className="h-screen bg-[#051109] flex flex-col items-center justify-center text-white relative overflow-hidden px-4">
      {/* Cinematic Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[220px] h-[220px] sm:w-[500px] sm:h-[500px] bg-emerald-600/20 blur-[80px] sm:blur-[120px] rounded-full"></div>
        <div className="absolute top-1/4 left-1/3 w-[160px] h-[160px] sm:w-[300px] sm:h-[300px] bg-yellow-600/10 blur-[60px] sm:blur-[100px] rounded-full transition-all animate-pulse"></div>
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <div className="mb-4 sm:mb-6 transform hover:scale-105 transition-transform duration-500 cursor-default">
          <span className="text-6xl sm:text-8xl drop-shadow-[0_0_30px_rgba(234,179,8,0.5)]">🃏</span>
        </div>

        <h1 className="text-3xl sm:text-5xl md:text-7xl font-black mb-2 text-center sm:text-left text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 to-yellow-500 tracking-tighter uppercase italic drop-shadow-2xl">
          TRUFMAN CARD GAME
        </h1>
        <p className="text-emerald-400 font-bold tracking-[0.25em] mb-8 sm:mb-12 uppercase opacity-80 text-xs sm:text-sm">"Jumlah Kartu Hanya 52"</p>

        <button
          onClick={handleLogin}
          className="group relative px-6 py-3 sm:px-8 sm:py-4 bg-white text-black rounded-xl sm:rounded-2xl font-black flex items-center gap-3 sm:gap-4 hover:bg-yellow-400 transition-all duration-300 shadow-[0_10px_30px_rgba(0,0,0,0.5)] hover:shadow-[0_10px_40px_rgba(234,179,8,0.4)] hover:-translate-y-1"
        >
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5 sm:w-6 sm:h-6 grayscale group-hover:grayscale-0 transition-all" alt="Google" />
          <span className="text-sm sm:text-lg uppercase">Mulai Bermain</span>
        </button>

        <p className="mt-6 sm:mt-8 text-white/30 text-[10px] sm:text-xs font-medium uppercase tracking-widest">Powered by Nafhan's Brain Engine</p>
      </div>
    </div>
  );
}