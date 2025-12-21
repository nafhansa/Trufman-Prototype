const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Mengizinkan koneksi dari mana saja (HP/Laptop beda IP)
    methods: ["GET", "POST"]
  }
});

// DATABASE SEMENTARA (Di RAM)
let rooms = {};

// Helper: Bikin Bot
const createBot = (seatIndex) => ({
  id: `bot_${Date.now()}_${seatIndex}`,
  name: `Bot ${['Joko', 'Siti', 'Budi'][seatIndex % 3]}`,
  isBot: true,
  avatar: `https://api.dicebear.com/9.x/bottts/svg?seed=${seatIndex}`,
  score: 1000, // Modal awal
  seatIndex: seatIndex
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // 1. CREATE ROOM
  socket.on('createRoom', (roomId) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        seats: [null, null, null, null], // 4 Kursi Kosong
        status: 'waiting', // waiting, betting, playing
        turnIndex: 0,
        pot: 0
      };
      console.log(`Room ${roomId} created`);
    }
    socket.emit('roomData', rooms[roomId]);
  });

  // 2. JOIN / TAKE SEAT
  socket.on('joinRoom', ({ roomId, user, seatIndex }) => {
    const room = rooms[roomId];
    if (room && !room.seats[seatIndex]) {
      // Masukkan User ke Kursi
      room.seats[seatIndex] = {
        id: socket.id,
        uid: user.uid,
        name: user.displayName,
        avatar: user.photoURL,
        isBot: false,
        score: 1000, // Modal awal
        seatIndex: seatIndex
      };
      socket.join(roomId);
      io.to(roomId).emit('updateRoom', room);
    }
  });

  // 3. ADD BOT
  socket.on('addBot', ({ roomId, seatIndex }) => {
    const room = rooms[roomId];
    if (room && !room.seats[seatIndex]) {
      room.seats[seatIndex] = createBot(seatIndex);
      io.to(roomId).emit('updateRoom', room);
    }
  });

  // 4. START GAME & BOT LOGIC
  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if(!room) return;

    room.status = 'betting';
    room.turnIndex = 0; // Mulai dari kursi 0
    io.to(roomId).emit('updateRoom', room);
    
    checkTurn(roomId); // Cek giliran pertama
  });

  // FUNGSI PINTAR: Cek Giliran
  function checkTurn(roomId) {
    const room = rooms[roomId];
    if(!room) return;

    const currentPlayer = room.seats[room.turnIndex];

    // Jika kursi kosong, skip ke orang berikutnya
    if (!currentPlayer) {
      nextTurn(roomId);
      return;
    }

    // JIKA YANG MAIN ADALAH BOT
    if (currentPlayer.isBot) {
      console.log(`Giliran Bot ${currentPlayer.name}...`);
      
      // Delay 2 detik biar kayak mikir
      setTimeout(() => {
        // Logika "13" / Kartu Tinggi
        // Kita simulasi dia dapet kartu acak 1-13
        const randomCard = Math.floor(Math.random() * 13) + 1; 
        let action = 'CALL'; // Default ikut

        // Kalo dapet 13 (King) atau 1 (As), Bot Berani Raise!
        if (randomCard === 13 || randomCard === 1) {
            action = 'RAISE';
            currentPlayer.score -= 200; // Kurangi duit bot
            room.pot += 200;
        } else {
            currentPlayer.score -= 50;
            room.pot += 50;
        }

        io.to(roomId).emit('botAction', { 
            seatIndex: room.turnIndex, 
            action: action,
            message: `Bot got ${randomCard}, deciding to ${action}!`
        });

        io.to(roomId).emit('updateRoom', room);
        nextTurn(roomId); // Lanjut ke user berikut
      }, 2000);
    }
  }

  function nextTurn(roomId) {
    const room = rooms[roomId];
    room.turnIndex = (room.turnIndex + 1) % 4; // Loop 0-1-2-3-0
    io.to(roomId).emit('updateRoom', room);
    checkTurn(roomId); // Rekursif cek orang berikutnya
  }
});

server.listen(3001, () => {
  console.log('✅ SERVER RUNNING ON PORT 3001');
});