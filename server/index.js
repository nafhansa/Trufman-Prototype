const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(express.json());

// CORS: read allowed origins from env ALLOWED_ORIGINS (comma separated). If empty, fall back to allowing localhost origins for convenience.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true); // development convenience
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  }
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : "*",
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

  // (Intent endpoints are registered at top-level outside of this connection handler.)

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

  // Intent endpoints: allow clients to submit intents to the server which will validate and broadcast via socket
  // (Clients should POST to these endpoints instead of performing direct DB writes for critical actions.)
  app.post('/intent/playCard', (req, res) => {
    const { roomId, seatIndex, card, userId } = req.body || {};
    if (!roomId || card === undefined) return res.status(400).json({ error: 'missing roomId or card' });
    io.to(roomId).emit('intent:playCard', { seatIndex, card, userId });
    return res.json({ ok: true });
  });

  app.post('/intent/submitBet', (req, res) => {
    const { roomId, seatIndex, bet, userId } = req.body || {};
    if (!roomId || bet === undefined) return res.status(400).json({ error: 'missing roomId or bet' });
    io.to(roomId).emit('intent:submitBet', { seatIndex, bet, userId });
    return res.json({ ok: true });
  });

  app.post('/intent/endTrick', (req, res) => {
    const { roomId, trick, userId } = req.body || {};
    if (!roomId || !trick) return res.status(400).json({ error: 'missing roomId or trick' });
    io.to(roomId).emit('intent:endTrick', { trick, userId });
    return res.json({ ok: true });
  });

server.listen(3001, () => {
  console.log('✅ SERVER RUNNING ON PORT 3001');
});