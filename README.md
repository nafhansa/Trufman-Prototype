# Trufman — Trick-Taking Card Game with a Self-Learning Bot

Trufman adalah game kartu kecil yang memamerkan product thinking, UI rapi, dan bot adaptif yang belajar dari permainan. Siklusnya lengkap: bidding → reveal → play → scoring, dengan trump dinamis, SFX, dan memori bot yang tersinkron ke cloud (Supabase).


## 🎮 Cara Main (Singkat)
- 4 pemain: kamu + 3 bot.
- Bid 1 kartu (nilai 2–10 = angka, J/Q/K = 0, A = 1). Bid tertinggi menentukan trump (C < D < H < S).
- Mode: ATAS jika total bid ≥ 13 (target = bid+1), BAWAH jika < 13 (target = bid−1, min 0).
- Ikuti suit lead jika bisa; trump boleh dimainkan jika tidak bisa ikut suit atau setelah trump broken.
- Skor: tepat target = +target; miss/over penalti tergantung mode.


## 🧠 Tentang Bot
Bot menyimpan weights (JSON) di Supabase per client_id + seat. Setelah tiap trick/round, weights di-adjust ringan berdasarkan hasil (bukan deep ML, tapi cukup membuat bot terasa “belajar”). Sinkronisasi dilakukan debounced untuk hemat write.


## 🧰 Tech Stack
- Frontend: React + Vite, Tailwind CSS
-Data: Supabase (Postgres, RLS-ready)
- Tabel: public.bot_memory(client_id text, seat smallint, data jsonb, updated_at timestamptz)
- PK: (client_id, seat) + index bot_memory_client_seat_idx
- Hosting: GitHub Pages + custom domain (CNAME → nafhansa.github.io)
- SFX/Music: WAV/MP3 (web-safe, pendek)


## HOW TO RUN IT??
```bash
git clone https://github.com/nafhansa/Trufman-Prototype.git
cd Trufman-Prototype
npm install

### Buat file .env (Vite)
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>

### Jalankan dev server
npm run dev

### Build
npm run build
```

## 🚀 Deploy
- GitHub Pages dengan workflow standar atau folder /docs.
- public/CNAME sudah menunjuk ke domain: trufman.nafhan.space.
- DNS: CNAME trufman → nafhansa.github.io.


## 🔑 Lisensi
MIT — silakan pakai, fork, dan kembangkan
