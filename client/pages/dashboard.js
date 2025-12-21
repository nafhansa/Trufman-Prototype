import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import io from "socket.io-client";
import { getFirestoreInstance, getAuthInstance } from "../firebase";
import { collection, addDoc, setDoc, doc, serverTimestamp } from "firebase/firestore";

// Ganti localhost dengan IP laptopmu jika ingin akses dari jaringan lokal
const socket = io("http://localhost:3001");

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const u = JSON.parse(localStorage.getItem("user"));
    if (u) setUser(u);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("user");
    localStorage.removeItem("loginAt");
    const a = getAuthInstance();
    a?.signOut();
    router.push("/login");
  };

  const createRoom = async () => {
    if (isCreating) return;
    setIsCreating(true);

    try {
      const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
      const hostUid = getAuthInstance()?.currentUser?.uid || user?.uid || user?.id;

      if (!hostUid) {
        alert("Sesi anda berakhir. Silakan login kembali.");
        router.push("/login");
        return;
      }

      // Gunakan doc + setDoc agar roomId jadi Document ID
      // Ini jauh lebih reliabel daripada addDoc
      await setDoc(doc(getFirestoreInstance(), "rooms", roomId), {
        roomId: roomId,
        host: hostUid,
        status: "waiting",
        createdAt: serverTimestamp(),
        players: [],
        turnIndex: 0,
        pot: 0,
        currentBet: 0,
        currentTrick: [],
        trickCount: 0,
        trufSuit: "",
        bets: {},
        lastAction: { player: 'System', move: 'Room Created' },
        seats: [
          { type: 'empty', player: null },
          { type: 'empty', player: null },
          { type: 'empty', player: null },
          { type: 'empty', player: null }
        ]
      });

      // Emit ke socket jika perlu
      socket.emit("createRoom", roomId);
      router.push(`/room/${roomId}`);
    } catch (error) {
      console.error("Error creating room:", error);
      alert("Gagal membuat room: " + error.message);
      setIsCreating(false);
    }
  };

  const joinRoom = () => {
    if (!roomCode) return;
    const code = roomCode.trim().toUpperCase();
    router.push(`/room/${code}`);
  };

  return (
    <div className="min-h-screen bg-slate-950 relative overflow-hidden flex items-center justify-center px-4 py-12">
      {/* Subtle Gradient Mesh Background */}
      <div className="fixed inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-emerald-900/10 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-900/10 blur-[120px] rounded-full"></div>
        <div className="absolute top-[20%] right-[10%] w-[30%] h-[30%] bg-purple-900/5 blur-[100px] rounded-full"></div>
      </div>

      <div className="w-full max-w-4xl mx-auto relative z-10">
        {/* Header / Hero Section */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-12">
          <div className="flex flex-col items-center md:items-start">
            <h1 className="text-6xl md:text-8xl font-black text-white tracking-tighter uppercase italic select-none">
              TRUF<span className="text-emerald-500">MAN</span>
            </h1>
            <p className="text-slate-400 font-bold tracking-[0.4em] uppercase text-sm mt-2">The Hero's Card Game</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 p-2 pr-6 bg-white/5 border border-white/10 rounded-full backdrop-blur-md">
              <div className="relative">
                <img
                  src={user?.photoURL}
                  alt="avatar"
                  className="w-12 h-12 rounded-full border-2 border-emerald-500 object-cover"
                />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-slate-950 rounded-full"></div>
              </div>
              <div>
                <p className="text-white font-bold text-sm leading-none">{user?.displayName}</p>
                <p className="text-emerald-500/80 text-[10px] uppercase font-black tracking-widest mt-1">Satriya Level 1</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowTutorial(true)}
                className="px-4 py-2 rounded-full bg-emerald-600/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-600 hover:text-white transition-all transform active:scale-95 shadow-sm flex items-center gap-2"
                title="Tutorial"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 20a8 8 0 100-16 8 8 0 000 16z" />
                </svg>
                <span className="text-sm font-bold uppercase tracking-widest">Tutorial</span>
              </button>

              <button
                onClick={handleLogout}
                className="p-3 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition-all transform active:scale-95 shadow-lg group"
                title="Logout"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Main Dashboard Container - Glassmorphism */}
        <div className="relative">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500/20 to-blue-500/20 rounded-3xl blur opacity-20"></div>
          <div className="relative bg-black/60 border border-white/10 backdrop-blur-2xl rounded-3xl p-8 md:p-12 overflow-hidden shadow-2xl">
            {/* Background Decorative Element */}
            <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-emerald-500/5 blur-[80px] rounded-full pointer-events-none"></div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 relative z-10">
              {/* Left Side: Create/Explore */}
              <div className="space-y-8">
                <div>
                  <h2 className="text-3xl font-bold text-white mb-4">Mulai Bermain</h2>
                  <p className="text-slate-400 leading-relaxed">Panggil teman-temanmu atau hadapi Self Learning AI Bot dalam arena kartu Trufman</p>
                </div>

                <div className="flex flex-col gap-4">
                  <button
                    onClick={createRoom}
                    disabled={isCreating}
                    className={`w-full py-5 rounded-2xl text-xl font-black text-white bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 transform transition-all active:scale-95 shadow-[0_0_30px_rgba(16,185,129,0.3)] hover:shadow-[0_0_40px_rgba(16,185,129,0.5)] uppercase tracking-tight ${isCreating ? 'opacity-50 cursor-not-allowed scale-95' : 'hover:scale-[1.02]'}`}
                  >
                    {isCreating ? 'SEDANG MEMBUAT...' : '+ BUAT ROOM BARU'}
                  </button>

                  <button
                    onClick={() => { setRoomCode(""); router.push('/dashboard'); }}
                    className="w-full py-4 rounded-2xl text-lg font-bold text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-all uppercase"
                  >
                    Lihat Room Tersedia
                  </button>
                </div>
              </div>

              {/* Right Side: Join */}
              <div className="flex flex-col justify-center bg-white/5 border border-white/5 rounded-2xl p-8">
                <h3 className="text-xl font-bold text-white mb-6 uppercase tracking-wider italic">Masuk ke Arena</h3>

                <div className="space-y-4">
                  <div className="relative">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest absolute -top-2 left-4 bg-slate-950 px-2 py-0.5 rounded-md border border-white/10">ID Ruangan</label>
                    <input
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value)}
                      placeholder="MISAL: X7K9P3"
                      className="w-full px-6 py-5 rounded-xl bg-slate-900/80 border border-white/5 placeholder:text-slate-700 text-white font-mono text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all uppercase"
                    />
                  </div>

                  <button
                    onClick={joinRoom}
                    className="w-full py-5 rounded-xl bg-white text-black font-black text-xl hover:bg-blue-400 transition-all transform active:scale-95 uppercase shadow-xl"
                  >
                    Masuk Sekarang
                  </button>
                </div>

                <p className="mt-8 text-[11px] text-slate-500 text-center uppercase tracking-tight font-medium opacity-60">
                  Bersiaplah, setiap langkah menentukan kemenangan anda.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="mt-12 text-center">
          <p className="text-slate-600 text-xs font-bold uppercase tracking-[0.5em]">Nafhan's Brain Engine • Worldwide Servers Active</p>
        </div>

        {/* Tutorial Modal */}
        {showTutorial && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
            onClick={() => setShowTutorial(false)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

            <div
              className="relative z-50 max-w-3xl w-full bg-gradient-to-br from-slate-900/95 to-slate-800/95 border border-white/10 rounded-2xl shadow-2xl p-8 md:p-12 text-white overflow-auto"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-extrabold">Tutorial Bermain Trufman</h2>
                  <p className="text-slate-400 mt-2">Panduan singkat cara bermain, objective, dan tips kemenangan.</p>
                </div>
                <button onClick={() => setShowTutorial(false)} className="p-2 rounded-md bg-white/5 hover:bg-white/10">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-emerald-400">Objective</h3>
                  <p className="text-slate-300">Kumpulkan poin dengan memenangkan trik dan menebak jumlah trik yang akan Anda menangkan setiap ronde. Gunakan strategi, komunikasi, dan perhatikan truf.</p>

                  <h3 className="text-lg font-bold text-emerald-400 mt-4">Langkah Dasar</h3>
                  <ol className="list-decimal list-inside text-slate-300 space-y-2">
                    <li>Setiap pemain mendapat kartu. Lihat kartu Anda dan nilai potensinya.</li>
                    <li>Tentukan jumlah trik (bet) yang akan Anda menangkan untuk ronde ini.</li>
                    <li>Mainkan kartu secara bergantian mengikuti aturan suit/truf.</li>
                    <li>Pemenang trick mendapat poin sesuai aturan, round berlanjut hingga selesai.</li>
                  </ol>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-bold text-emerald-400">Aturan Penting</h3>
                  <ul className="list-disc list-inside text-slate-300 space-y-2">
                    <li>Ikuti suit jika memungkinkan. Jika tidak, Anda boleh membuang atau menggunakan truf.</li>
                    <li>Truf mengalahkan suit biasa kecuali ada truf yang lebih tinggi.</li>
                    <li>Pastikan memasang bet sebelum ronde dimulai.</li>
                  </ul>

                  <h3 className="text-lg font-bold text-emerald-400 mt-4">Tips & Strategi</h3>
                  <ul className="list-disc list-inside text-slate-300 space-y-2">
                    <li>Catat kartu yang sudah dimainkan untuk memprediksi sisa kartu.</li>
                    <li>Gunakan truf pada momen yang tepat untuk mencuri trick penting.</li>
                    <li>Jika bermain melawan bot, perhatikan pola AI untuk memanfaatkan kelemahan.</li>
                  </ul>
                </div>
              </div>

              <div className="mt-8 flex items-center justify-end gap-3">
                <button onClick={() => setShowTutorial(false)} className="px-5 py-3 rounded-xl bg-white text-black font-bold hover:bg-white/90">Siap, Mengerti</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}