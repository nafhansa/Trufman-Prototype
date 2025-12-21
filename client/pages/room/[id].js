import { useRouter } from "next/router";
import { useState, useEffect, useRef } from "react";
import Head from "next/head";
import { db, auth } from "../../firebase";
import { calculateBotBid, getBestMove } from '../../utils/botAI';
import {
  doc,
  onSnapshot,
  updateDoc,
  collection,
  query,
  where,
  getDocs
} from "firebase/firestore";

// Helper: safe update wrapper to centralize error handling for Firestore updates
const safeUpdate = async (ref, data) => {
  try {
    await updateDoc(ref, data);
  } catch (err) {
    console.error('Failed to update room:', err);
    try { alert('Action failed. Please try again.'); } catch (e) { /* ignore in non-browser env */ }
  }
};

const LiveScorePanel = ({ roomData, mySeatIndex }) => {
  if (!roomData || (roomData.status !== 'playing' && roomData.status !== 'round_over')) return null;

  return (
    <div className="fixed top-24 right-6 z-50 w-64 bg-black/60 backdrop-blur-xl border border-white/10 rounded-[32px] overflow-hidden shadow-2xl animate-fade-in">
      <div className="bg-white/5 px-6 py-4 border-b border-white/5 flex items-center justify-between">
        <h3 className="text-[10px] font-black tracking-[0.2em] text-emerald-500 uppercase">Live Arena Score</h3>
        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_#10b981]"></div>
      </div>
      <div className="p-2 space-y-1">
        {roomData.seats.map((seat, idx) => {
          if (seat.type === 'empty') return null;
          const isCurrentTurn = roomData.turnIndex === idx && roomData.status === 'playing';
          const isMe = idx === mySeatIndex;
          const won = roomData.tricksWon?.[idx] || 0;
          const bid = roomData.bids?.[idx] || 0;

          return (
            <div
              key={idx}
              className={`flex items-center justify-between px-4 py-3 rounded-2xl transition-all duration-300 ${isCurrentTurn
                ? 'bg-emerald-500/20 border border-emerald-500/30 shadow-[inset_0_0_20px_rgba(16,185,129,0.1)]'
                : 'hover:bg-white/5 border border-transparent'
                }`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full ${isCurrentTurn ? 'bg-emerald-500 animate-pulse' : isMe ? 'bg-blue-400' : 'bg-slate-700'}`}></div>
                <span className={`text-xs font-bold tracking-wide ${isMe ? 'text-white' : 'text-slate-400'}`}>
                  {isMe ? 'YOU' : seat.name.split(' ')[0].toUpperCase()}
                  {seat.type === 'bot' && idx !== mySeatIndex && ' (BOT)'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-black ${won >= bid && bid > 0 ? 'text-emerald-400' : 'text-white'}`}>
                  {won}
                </span>
                <span className="text-[10px] text-slate-600 font-bold">/</span>
                <span className="text-xs font-extrabold text-slate-400">
                  {bid}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const TrumpIndicator = ({ trufSuit, trufValue, isRevealed, status }) => {
  // Hanya render jika status betting atau playing
  if (status === 'waiting') return null;

  return (
    <div className="flex flex-col items-center justify-center group relative z-40">
      {/* Label di atas kartu */}
      <div className="mb-2 text-[10px] font-black tracking-[0.2em] text-emerald-500 uppercase animate-pulse">
        {isRevealed ? "TRUMP SUIT" : "HIDDEN TRUMP"}
      </div>

      {/* Wrapper Perspective */}
      <div className="w-12 h-16 md:w-14 md:h-20 perspective-1000">

        {/* Container yang Berputar (Gunakan class baru 'flip-card-inner') */}
        <div className={`flip-card-inner ${isRevealed ? 'flipped' : ''}`}>

          {/* === SISI DEPAN (Hasil Akhir) === */}
          {/* Gunakan class 'flip-card-face flip-card-front' */}
          <div className="flip-card-face flip-card-front border-2 border-emerald-500 overflow-hidden flex flex-col items-center justify-center">
            <div className={`text-3xl leading-none ${['♥️', '♦️'].includes(trufSuit) ? 'text-red-600' : 'text-slate-900'}`}>
              {trufSuit}
            </div>
            <div className={`text-xs font-black mt-1 ${['♥️', '♦️'].includes(trufSuit) ? 'text-red-600' : 'text-slate-900'}`}>
              {(() => {
                if (trufValue === 14 || trufValue === 1) return 'A';
                if (trufValue === 13) return 'K';
                if (trufValue === 12) return 'Q';
                if (trufValue === 11) return 'J';
                return trufValue;
              })()}
            </div>
            {/* Kilau Efek */}
            <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/20 to-transparent pointer-events-none"></div>
          </div>

          {/* === SISI BELAKANG (Cover) === */}
          {/* Gunakan class 'flip-card-face flip-card-back' */}
          <div className="flip-card-face flip-card-back border border-white/20 flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/diagmonds-light.png')]"></div>
            <div className="w-6 h-6 rounded-full border border-emerald-500/50 flex items-center justify-center animate-spin-slow">
              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default function Room() {
  const router = useRouter();
  const { id: roomId } = router.query;
  const [roomData, setRoomData] = useState(null);
  const [docId, setDocId] = useState(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [hasSubmittedBet, setHasSubmittedBet] = useState(false);
  const isProcessingRoundStart = useRef(false);
  const [trumpAnnouncement, setTrumpAnnouncement] = useState(null);


  // --- Realtime Listener ---
  useEffect(() => {
    if (!roomId) return;

    setDocId(roomId); // roomId is now the document ID
    const unsubscribe = onSnapshot(doc(db, "rooms", roomId), (doc) => {
      if (doc.exists()) {
        setRoomData(doc.data());
      } else {
        router.push('/dashboard');
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  // --- Announcement Trigger (Trick Result with Trump Details) ---
  useEffect(() => {
    if (!roomData?.currentTrick || roomData.currentTrick.length !== 4) {
      if (trumpAnnouncement) setTrumpAnnouncement(null);
      return;
    }

    const trufSuit = roomData.trufSuit;

    // SCENARIO: TRICK RESULT (4th card played)
    let winner = roomData.currentTrick[0];
    let winningStrength = GetCardPlayingRank(winner.card);

    roomData.currentTrick.forEach((item) => {
      const currentStrength = GetCardPlayingRank(item.card);
      if (winner.card.suit !== trufSuit && item.card.suit === trufSuit) {
        winner = item;
        winningStrength = currentStrength;
      } else if (item.card.suit === winner.card.suit) {
        if (currentStrength > winningStrength) {
          winner = item;
          winningStrength = currentStrength;
        }
      }
    });

    // Collect all cards index-mapped for the compass
    const trickCards = {};
    roomData.currentTrick.forEach(item => {
      trickCards[item.seatIndex] = item;
    });

    setTrumpAnnouncement({
      type: 'trick_result',
      winnerName: roomData.seats[winner.seatIndex].name,
      winnerSeatIndex: winner.seatIndex,
      trickCards: trickCards,
      isTrumpWin: winner.card.suit === trufSuit
    });

    const timer = setTimeout(() => setTrumpAnnouncement(null), 4500);
    return () => clearTimeout(timer);
  }, [roomData?.currentTrick?.length, roomData?.trufSuit, roomData?.isTrumpRevealed]);

  // --- Card Valuation System (Trufman Rules) ---
  const GetCardBiddingValue = (card) => {
    if (!card) return 0;
    // Ace=1, 2 to 10 = face value
    if (card.value >= 11 && card.value <= 13) return 0;
    return card.value;
  };

  const GetCardPlayingRank = (card) => {
    if (!card) return 0;
    // Standard Hierarchy: A=14, K=13, Q=12, J=11, 10=10...
    if (card.value === 1) return 14;
    return card.value;
  };

  // --- Validation Logic (Strict Follow Suit & Breaking Trump) ---
  const GetValidMoves = (hand, currentTrick, trufSuit, isTrumpBroken) => {
    if (!hand || hand.length === 0) return [];

    // 1. Leading the trick (Table is empty)
    if (!currentTrick || currentTrick.length === 0) {
      if (!isTrumpBroken) {
        const nonTrumpCards = hand.filter(c => c.suit !== trufSuit);
        // Constraint: Must lead Non-Trump if hand has any.
        if (nonTrumpCards.length > 0) return nonTrumpCards;
      }
      return hand; // Can lead anything if broken or only trump left
    }

    // 2. Following Suit
    const leadSuit = currentTrick[0].card.suit;
    const followCards = hand.filter(c => c.suit === leadSuit);

    if (followCards.length > 0) {
      // MANDATORY: Must play lead suit if you have it
      return followCards;
    }

    // 3. Void in Lead Suit: Free to discard or cut
    return hand;
  };

  // --- Host & Seat Logic ---
  const isHost = auth.currentUser?.uid === roomData?.host;
  const mySeatIndex = roomData?.seats?.findIndex(seat => seat.type === 'human' && seat.uid === auth.currentUser?.uid);
  const isUserSeated = mySeatIndex !== -1;

  // --- Bot AI & Phase Management Logic (Host Only) ---
  useEffect(() => {
    if (!roomData || !isHost || !docId) return;

    // Phase: Betting - Auto Bet for Bots
    if (roomData.status === 'betting') {

      // Reset flag jika ini adalah ronde baru (bets masih kosong)
      const betsCount = Object.keys(roomData.bets || {}).length;
      if (betsCount === 0) {
        isProcessingRoundStart.current = false;
      }

      // 1. Bot Auto-Bet Logic
      const unfilledBets = roomData.seats.filter((s, i) => s.type === 'bot' && !roomData.bets?.[i]);
      if (unfilledBets.length > 0) {
        const timer = setTimeout(async () => {
          const newBets = { ...(roomData.bets || {}) };
          unfilledBets.forEach(botSeat => {
            const seatIdx = roomData.seats.indexOf(botSeat);
            const hand = botSeat.hand || [];
            if (hand.length > 0) {
              const botBid = calculateBotBid(hand, roomData.trufSuit);

              // Find card in hand that matches this bid value or is closest
              const bestBidCard = hand.reduce((prev, curr) => {
                const prevDiff = Math.abs(GetCardBiddingValue(prev) - botBid);
                const currDiff = Math.abs(GetCardBiddingValue(curr) - botBid);
                return currDiff < prevDiff ? curr : prev;
              });
              newBets[seatIdx] = bestBidCard;
            }
          });
          await safeUpdate(doc(db, "rooms", docId), { bets: newBets });
        }, 1500);
        return () => clearTimeout(timer);
      }

      // 2. Check if all bets are in -> TRIGGER GAME START
      const filledSeatsCount = roomData.seats.filter(s => s.type !== 'empty').length;

      // KUNCI: Tambahkan cek !isProcessingRoundStart.current agar tidak jalan 2x
      if (filledSeatsCount === betsCount && filledSeatsCount >= 2 && !isProcessingRoundStart.current) {

        // LOCK PROSES
        isProcessingRoundStart.current = true;

        const timer = setTimeout(async () => {
          // Recalculate Logic
          let winnerIndex = 0;
          let highestValue = -1;
          let winningSuit = '♠️';
          let winningCard = null;
          const newBids = {};

          let totalBidsSum = 0;
          Object.entries(roomData.bets || {}).forEach(([idx, card]) => {
            const val = GetCardBiddingValue(card);
            newBids[idx] = val;
            totalBidsSum += val;

            if (val > highestValue) {
              highestValue = val;
              winningSuit = card.suit;
              winnerIndex = parseInt(idx);
              winningCard = card;
            }
          });

          const strategy = totalBidsSum >= 13 ? "ATAS" : "BAWAH";

          console.log("STEP 1: Setting up playing phase (Card Hidden)"); // Debugging

          // --- STEP 1: Setup Playing tapi KARTU MASIH TUTUP (False) ---
          await safeUpdate(doc(db, "rooms", docId), {
            status: 'playing',
            trufSuit: winningSuit,
            trufCardValue: winningCard?.value || 0,
            isTrumpRevealed: false, // Wajib False
            turnIndex: winnerIndex,
            strategy: strategy,
            totalBids: totalBidsSum,
            bids: newBids,
            tricksWon: { 0: 0, 1: 0, 2: 0, 3: 0 },
            isTrumpBroken: false,
            playedCards: [] // Initialize history
          });

          // --- STEP 2: Reveal Animation (Jeda 1.5 Detik biar lebih kerasa) ---
          setTimeout(async () => {
            console.log("STEP 2: Revealing Card!"); // Debugging
            await safeUpdate(doc(db, "rooms", docId), {
              isTrumpRevealed: true
            });
          }, 2000); // Saya naikkan jadi 1500ms biar browser sempat napas

        }, 1000);
        return () => clearTimeout(timer);
      }
    }

    // Phase: Playing - Bot Game Logic
    if (roomData.status === 'playing' && (roomData.trickCount || 1) <= 13) {
      const currentPlayer = roomData.seats[roomData.turnIndex];
      // Only host runs bots, and don't act if table is full (waiting for host to clear)
      if (currentPlayer?.type === 'bot' && (roomData.currentTrick || []).length < 4 && (currentPlayer.hand || []).length > 0) {
        const timer = setTimeout(async () => {
          const hand = [...(currentPlayer.hand || [])];
          if (hand.length === 0) return;

          // Bot Logic: Use smart AI with card history
          const trufSuit = roomData.trufSuit || '♠️';
          const history = roomData.playedCards || [];
          const cardToPlay = getBestMove(hand, roomData.currentTrick || [], trufSuit, roomData.isTrumpBroken, history);
          const isFaceDown = cardToPlay.suit === trufSuit;
          const isLead = (roomData.currentTrick || []).length === 0;

          // Update Broken status
          let shouldBreakTrump = roomData.isTrumpBroken;
          if (!isLead && cardToPlay.suit === trufSuit && cardToPlay.suit !== roomData.currentTrick[0].card.suit) {
            shouldBreakTrump = true;
          }

          const newHand = hand.filter(c => !(c.value === cardToPlay.value && c.suit === cardToPlay.suit));
          const newSeats = [...roomData.seats];
          newSeats[roomData.turnIndex].hand = newHand;

          const newTrick = [...(roomData.currentTrick || []), {
            playerId: currentPlayer.uid || `bot-${roomData.turnIndex}`,
            seatIndex: roomData.turnIndex,
            card: cardToPlay,
            isFaceDown: isFaceDown
          }];

          let nextTurn = (roomData.turnIndex + 1) % 4;
          while (roomData.seats[nextTurn].type === 'empty') {
            nextTurn = (nextTurn + 1) % 4;
          }

          const updateFields = {
            seats: newSeats,
            currentTrick: newTrick,
            isTrumpBroken: shouldBreakTrump,
            lastAction: {
              player: currentPlayer.name,
              card: cardToPlay,
              type: 'play'
            }
          };

          // ONLY update turn if trick not finished
          if (newTrick.length < 4) {
            updateFields.turnIndex = nextTurn;
          }

          await safeUpdate(doc(db, "rooms", docId), updateFields);

          // If trick complete, trigger clear logic
          if (newTrick.length === 4) {
            handleEndTrick(newTrick);
          }
        }, 2500);
        return () => clearTimeout(timer);
      }
    }
  }, [roomData?.turnIndex, roomData?.status, roomData?.bets, (roomData?.currentTrick || []).length]);

  // Winner Calculation Logic
  const determineWinner = (trick) => {
    if (!trick || trick.length < 1) return null;

    const leadSuit = trick[0].card.suit;
    const trufSuit = roomData.trufSuit;
    const isAtas = roomData.strategy === "ATAS";

    let winner = trick[0];
    let winningStrength = getStrength(trick[0].card, isAtas);

    trick.forEach((item) => {
      const currentStrength = getStrength(item.card, isAtas);

      // If winner is NOT truf but current IS truf -> current wins
      if (winner.card.suit !== trufSuit && item.card.suit === trufSuit) {
        winner = item;
        winningStrength = currentStrength;
      }
      // If both are same suit (either truf or lead) -> higher strength wins
      else if (item.card.suit === winner.card.suit) {
        if (currentStrength > winningStrength) {
          winner = item;
          winningStrength = currentStrength;
        }
      }
      // Note: If item is neither truf nor leadSuit, it can't win.
    });

    return winner;
  };

  const getStrength = (card, isAtas) => {
    // In Playing Phase, we use Rank hierarchy (A=14, K=13...)
    return GetCardPlayingRank(card);
  };

  // Handle End of Trick (Host Only)
  const handleEndTrick = async (finishedTrick) => {
    if (!isHost || !docId) return;

    setTimeout(async () => {
      const winner = determineWinner(finishedTrick);
      const winnerSeatIdx = winner.seatIndex;

      const updatedWon = { ...(roomData.tricksWon || {}) };
      updatedWon[winnerSeatIdx] = (updatedWon[winnerSeatIdx] || 0) + 1;

      const nextTrickCount = (roomData.trickCount || 1) + 1;

      // Save trick to history for Bot Memory
      const cardsInTrick = finishedTrick.map(t => ({ suit: t.card.suit, value: t.card.value }));
      const currentHistory = roomData.playedCards || [];
      const updatedHistory = [...currentHistory, ...cardsInTrick];

      let updateFields = {
        currentTrick: [],
        trickCount: nextTrickCount,
        tricksWon: updatedWon,
        playedCards: updatedHistory,
        lastAction: {
          player: 'System',
          move: `${roomData.seats[winnerSeatIdx].name} Wins Trick!`
        }
      };

      // 1. CRITICAL CHECK: Check if Round is Over (13 tricks played)
      if (nextTrickCount > 13) {
        updateFields.status = 'round_over';
        updateFields.turnIndex = null; // Stop anyone from moving

        // Final Score Calculation
        const newSeats = [...roomData.seats];
        const isAtas = roomData.strategy === "ATAS";

        newSeats.forEach((seat, idx) => {
          if (seat.type !== 'empty') {
            const bid = roomData.bids?.[idx] || 0;
            const won = updatedWon[idx] || 0;
            const diff = Math.abs(won - bid);
            let roundScore = 0;

            if (won === bid) {
              // SUCCESS: Bid * 10 (or 50 if bid is 0)
              roundScore = bid === 0 ? 50 : bid * 10;
            } else {
              // FAILURE
              if (isAtas) {
                // ATAS: Over -1, Under -2
                roundScore = won > bid ? diff * -1 : diff * -2;
              } else {
                // BAWAH: Over -2, Under -1
                roundScore = won > bid ? diff * -2 : diff * -1;
              }
            }
            seat.score = (seat.score || 0) + roundScore;
          }
        });
        updateFields.seats = newSeats;
      } else {
        // Only if game is NOT over, assign next turn
        updateFields.turnIndex = winnerSeatIdx;
      }

      await safeUpdate(doc(db, "rooms", docId), updateFields);
    }, 3000);
  };


  const handleNextRound = async () => {
    if (!isHost || !docId) return;

    // 1. Hard Reset & Deck Generation
    const suits = ['♠️', '♥️', '♣️', '♦️'];
    const deck = [];
    for (let s of suits) {
      for (let v = 1; v <= 13; v++) deck.push({ suit: s, value: v });
    }
    console.log("Deck Size before deal: " + deck.length);

    // 2. Fisher-Yates Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // 3. Round Robin Dealing (Standard 52 cards -> 4 Players x 13 cards)
    const newSeats = [...roomData.seats];
    newSeats.forEach(s => s.hand = []); // Clear existing hands

    for (let i = 0; i < 52; i++) {
      let playerIndex = i % 4;
      newSeats[playerIndex].hand.push(deck[i]);
    }

    // 4. Final Validation
    newSeats.forEach((seat, idx) => {
      if (seat.hand.length !== 13) {
        console.error(`CRITICAL DEAL ERROR: Seat ${idx} has ${seat.hand.length} cards`);
        throw new Error("CRITICAL DEAL ERROR");
      }
    });

    const nextRoundNum = (roomData.roundNumber || 1) + 1;

    await safeUpdate(doc(db, "rooms", docId), {
      status: 'betting',
      seats: newSeats,
      roundNumber: nextRoundNum,
      currentTrick: [],
      trickCount: 1,
      trufSuit: "",
      trufCardValue: 0,
      isTrumpRevealed: false,
      strategy: "", // RESET for new round
      totalBids: 0,  // RESET for new round
      bets: {},
      bids: {},
      tricksWon: { 0: 0, 1: 0, 2: 0, 3: 0 },
      isTrumpBroken: false,
      playedCards: [], // Reset history
      lastAction: { player: 'System', move: `Round ${nextRoundNum} Started` }
    });
  };

  // Reset local submission state when phase changes
  useEffect(() => {
    if (roomData?.status !== 'betting') {
      setHasSubmittedBet(false);
      setSelectedCard(null);
    }
  }, [roomData?.status]);

  // --- Actions ---
  const handleTakeSeat = async (index) => {
    if (!docId || !auth.currentUser || isUserSeated) return;
    const newSeats = [...roomData.seats];
    newSeats[index] = {
      type: 'human',
      uid: auth.currentUser.uid,
      name: auth.currentUser.displayName,
      avatar: auth.currentUser.photoURL,
      score: 0,
      hand: []
    };
    await safeUpdate(doc(db, "rooms", docId), { seats: newSeats });
  };

  const handleAddBot = async (index) => {
    if (!docId) return;
    const newSeats = [...roomData.seats];
    newSeats[index] = {
      type: 'bot',
      name: `Bot ${index + 1}`,
      avatar: `https://api.dicebear.com/9.x/bottts/svg?seed=${index}-${roomId}`,
      score: 0,
      hand: []
    };
    await safeUpdate(doc(db, "rooms", docId), { seats: newSeats });
  };

  const handleKick = async (index) => {
    if (!docId || !isHost) return;
    const newSeats = [...roomData.seats];
    newSeats[index] = { type: 'empty', player: null };
    await safeUpdate(doc(db, "rooms", docId), { seats: newSeats });
  };

  const initializeGame = async () => {
    if (!docId || !isHost) return;

    // 1. Hard Reset & Deck Generation
    const suits = ['♠️', '♥️', '♣️', '♦️'];
    const deck = [];
    for (let s of suits) {
      for (let v = 1; v <= 13; v++) deck.push({ suit: s, value: v });
    }
    console.log("Deck Size before deal: " + deck.length);

    // 2. Fisher-Yates Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // 3. Round Robin Dealing (Standard 52 cards -> 4 Players x 13 cards)
    const newSeats = [...roomData.seats];
    newSeats.forEach(s => s.hand = []); // Clear existing hands

    for (let i = 0; i < 52; i++) {
      let playerIndex = i % 4;
      newSeats[playerIndex].hand.push(deck[i]);
    }

    // 4. Final Validation
    newSeats.forEach((seat, idx) => {
      if (seat.hand.length !== 13) {
        console.error(`CRITICAL DEAL ERROR: Seat ${idx} has ${seat.hand.length} cards`);
        throw new Error("CRITICAL DEAL ERROR");
      }
    });

    // Find first player turn (for play phase later)
    let firstTurn = 0;
    while (newSeats[firstTurn].type === 'empty') firstTurn++;

    await safeUpdate(doc(db, "rooms", docId), {
      status: 'betting', // Transition to simultaneous betting phase first
      seats: newSeats,
      turnIndex: firstTurn,
      roundNumber: 1,
      pot: 0,
      currentBet: 0,
      bets: {}, // Reset bets
      currentTrick: [],
      trickCount: 1,
      trufSuit: "", // Will be determined after betting
      trufCardValue: 0,
      isTrumpRevealed: false,
      bids: {}, // Initialize bids
      tricksWon: { 0: 0, 1: 0, 2: 0, 3: 0 }, // Initialize won count
      isTrumpBroken: false,
      playedCards: [] // Reset history
    });
  };

  const submitBet = async () => {
    if (!docId || !selectedCard || hasSubmittedBet) return;

    const newBets = { ...(roomData.bets || {}) };
    newBets[mySeatIndex] = selectedCard;

    await safeUpdate(doc(db, "rooms", docId), {
      bets: newBets
    });
    setHasSubmittedBet(true);
  };

  const isPlayable = (card) => {
    if (roomData.status !== 'playing') return true; // Betting phase all selectable
    if (roomData.turnIndex !== mySeatIndex) return false;

    const trufSuit = roomData.trufSuit || '♠️';
    const myHand = roomData.seats[mySeatIndex]?.hand || [];

    const validMoves = GetValidMoves(myHand, roomData.currentTrick || [], trufSuit, roomData.isTrumpBroken);

    // Check if the selected card matches any of the valid moves
    return validMoves.some(m => m.suit === card.suit && m.value === card.value);
  };

  const handlePlayCard = async () => {
    if (!docId || !selectedCard || roomData.turnIndex !== mySeatIndex || roomData.status !== 'playing' || (roomData.trickCount || 1) > 13) return;

    if (!isPlayable(selectedCard)) {
      const leadSuit = (roomData.currentTrick && roomData.currentTrick.length > 0)
        ? roomData.currentTrick[0].card.suit
        : null;

      if (leadSuit) {
        alert(`You must follow suit! Play a ${leadSuit} card.`);
      } else {
        alert("You cannot lead with Trump yet! It hasn't been broken.");
      }
      return;
    }

    if ((roomData.currentTrick || []).length >= 4) return; // Wait for trick to clear

    const trufSuit = roomData.trufSuit || '♠️';
    const isFaceDown = selectedCard.suit === trufSuit;
    const isLead = (roomData.currentTrick || []).length === 0;

    // Update Broken status
    let shouldBreakTrump = roomData.isTrumpBroken;
    if (!isLead && selectedCard.suit === trufSuit && selectedCard.suit !== roomData.currentTrick[0].card.suit) {
      shouldBreakTrump = true;
    }

    // Remove selected card from hand
    const newSeats = [...roomData.seats];
    newSeats[mySeatIndex].hand = newSeats[mySeatIndex].hand.filter(c =>
      !(c.value === selectedCard.value && c.suit === selectedCard.suit)
    );

    const newTrick = [...(roomData.currentTrick || []), {
      playerId: auth.currentUser.uid,
      seatIndex: mySeatIndex,
      card: selectedCard,
      isFaceDown: isFaceDown
    }];

    let nextTurn = (roomData.turnIndex + 1) % 4;
    while (roomData.seats[nextTurn].type === 'empty') {
      nextTurn = (nextTurn + 1) % 4;
    }

    const updateFields = {
      seats: newSeats,
      currentTrick: newTrick,
      isTrumpBroken: shouldBreakTrump,
      lastAction: {
        player: roomData.seats[mySeatIndex].name,
        card: selectedCard,
        type: 'play'
      }
    };

    // ONLY update turn if trick not finished
    if (newTrick.length < 4) {
      updateFields.turnIndex = nextTurn;
    }

    await safeUpdate(doc(db, "rooms", docId), updateFields);

    if (newTrick.length === 4) {
      handleEndTrick(newTrick);
    }
    setSelectedCard(null);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  // --- Helper for Rotation ---
  const getRelativePosition = (index) => {
    if (!isUserSeated) {
      const positions = ["bottom", "left", "top", "right"];
      return positions[index];
    }
    // Rotate so myIndex = bottom
    const rel = (index - mySeatIndex + 4) % 4;
    return ["bottom", "left", "top", "right"][rel];
  };

  const getPositionClasses = (pos) => {
    switch (pos) {
      case "bottom": return "bottom-0 left-1/2 -translate-x-1/2 translate-y-full pt-12";
      case "left": return "left-0 top-1/2 -translate-y-1/2 -translate-x-full pr-12";
      case "top": return "top-0 left-1/2 -translate-x-1/2 -translate-y-full pb-12";
      case "right": return "right-0 top-1/2 -translate-y-1/2 translate-x-full pl-12";
    }
  };

  if (!roomId) return null;
  if (!roomData) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-emerald-500 font-black">LOADING ARENA...</div>;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-20 relative overflow-hidden font-sans">
      <Head><title>Trufman Battle - {roomId}</title></Head>

      {/* Background Mesh */}
      <div className="fixed inset-0 pointer-events-none opacity-40">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-emerald-900/20 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-900/20 blur-[120px] rounded-full"></div>
      </div>

      {/* Header Bar */}
      <div className="absolute top-6 left-6 right-6 flex justify-between items-center z-50">
        <div className="flex items-center gap-4">
          <div className="px-4 py-2 bg-black/40 border border-white/10 rounded-xl backdrop-blur-md">
            <span className="text-emerald-500 font-black italic">#{roomId}</span>
          </div>

          {(roomData.status === 'playing' || roomData.status === 'betting') && (
            <div className="pl-6 border-l border-white/10 flex items-center gap-8">
              <TrumpIndicator
                trufSuit={roomData.trufSuit}
                trufValue={roomData.trufCardValue}
                isRevealed={roomData.isTrumpRevealed}
                status={roomData.status}
              />

              <div className="flex items-center gap-3">
                <div className={`px-4 py-2 ${roomData.status === 'betting' ? 'bg-yellow-500 shadow-[0_0_20px_rgba(234,179,8,0.2)]' : 'bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]'} text-black font-black rounded-xl animate-pulse`}>
                  {roomData.status === 'betting' ? 'BETTING PHASE' : 'LIVE BATTLE'}
                </div>
                {roomData.strategy && (
                  <div className="flex items-center gap-2">
                    <div className="px-4 py-2 bg-blue-600 text-white font-black rounded-xl border border-white/20 flex items-center gap-2 shadow-[0_0_20px_rgba(37,99,235,0.2)]">
                      {roomData.strategy === 'ATAS' ? '⬆️' : '⬇️'}
                      <span>MAIN {roomData.strategy}</span>
                    </div>
                    <div className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-slate-400 text-xs font-black">
                      TOTAL BIDS: <span className="text-white">{roomData.totalBids || 0}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={copyToClipboard} className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold transition-all">
            {copySuccess ? "COPIED!" : "INVITE"}
          </button>
          <button onClick={() => router.push('/dashboard')} className="px-4 py-2 bg-red-950/20 text-red-500 border border-red-500/20 rounded-xl text-xs font-bold hover:bg-red-500 hover:text-white transition-all">
            QUIT
          </button>
        </div>
      </div>
      <LiveScorePanel roomData={roomData} mySeatIndex={mySeatIndex} />

      <div className="relative w-full max-w-6xl aspect-[21/9] bg-emerald-950/20 rounded-[100px] border-[20px] border-slate-900 shadow-2xl flex items-center justify-center">
        {/* Table Logo */}
        <div className="absolute inset-0 flex flex-col items-center justify-center opacity-5 pointer-events-none select-none">
          <h2 className="text-[12rem] font-black tracking-tighter italic">TRUFMAN</h2>
          <p className="text-xl font-bold tracking-[2em]">ARENA SYSTEM</p>
        </div>

        {/* Dynamic Seats */}
        {roomData.seats.map((seat, index) => {
          const pos = getRelativePosition(index);
          const isTurn = roomData.status === 'playing' && roomData.turnIndex === index;

          return (
            <div key={index} className={`absolute ${getPositionClasses(pos)} transition-all duration-500 z-40`}>
              <div className={`relative flex flex-col items-center p-4 rounded-3xl transition-all ${isTurn ? 'scale-110 drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]' : 'scale-100 opacity-60'}`}>
                {/* Kick Button (Host Only) */}
                {isHost && seat.type !== 'empty' && seat.uid !== auth.currentUser?.uid && (
                  <button
                    onClick={() => handleKick(index)}
                    className="absolute top-2 right-2 w-6 h-6 bg-red-600/80 hover:bg-red-600 text-white rounded-full font-black text-[10px] z-50 transition-all"
                  >
                    X
                  </button>
                )}

                {seat.type === 'empty' ? (
                  <div className="w-24 h-24 rounded-full border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 group hover:border-emerald-500/50 transition-colors">
                    {!isUserSeated && (
                      <button onClick={() => handleTakeSeat(index)} className="text-[10px] font-black uppercase text-emerald-400 hover:text-white transition-colors">JOIN SEAT</button>
                    )}
                    <button onClick={() => handleAddBot(index)} className="text-[10px] font-black uppercase text-slate-500 hover:text-white transition-colors">+ ADD BOT</button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center group">
                    <div className={`p-1.5 rounded-full border-4 transition-all duration-300 ${isTurn ? 'border-yellow-400 shadow-[0_0_30px_rgba(234,179,8,0.5)] scale-110' : 'border-white/5'}`}>
                      <img src={seat.avatar} className="w-20 h-20 rounded-full object-cover shadow-2xl" />
                    </div>
                    <div className="mt-3 text-[11px] font-black uppercase tracking-widest bg-black/60 backdrop-blur-md px-4 py-2 rounded-2xl border border-white/10 flex flex-col items-center gap-1.5 shadow-xl">
                      <span className="text-white drop-shadow-md">{seat.name} {seat.type === 'bot' ? '🤖' : ''}</span>

                      {roomData.status === 'betting' && roomData.bets?.[index] && (
                        <div className="text-[9px] text-yellow-400 font-black animate-pulse flex items-center gap-1">
                          <span className="w-1.5 h-1.5 bg-yellow-400 rounded-full"></span>
                          READY
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Cards for other players (back side - Orbit Position) */}
                {roomData.status === 'playing' && seat.type !== 'empty' && pos !== 'bottom' && (
                  <div className={`absolute ${pos === 'top' ? 'top-full mt-4' :
                    pos === 'left' ? 'left-full ml-4' :
                      'right-full mr-4'
                    } flex -space-x-4 opacity-40 group-hover:opacity-100 transition-opacity`}>
                    {[1, 2, 3].map(c => (
                      <div key={c} className="w-6 h-10 bg-emerald-900 border border-white/20 rounded-md shadow-lg transform rotate-6"></div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Unified Trick Result - Compass Formation Layout (Optimized Sizing) */}
        {trumpAnnouncement?.type === 'trick_result' && (
          <div className="absolute inset-0 z-[120] flex items-center justify-center pointer-events-none animate-fade-in">
            {/* Backdrop Dimmer */}
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>

            <div className="relative w-full max-w-md aspect-square flex items-center justify-center scale-95 md:scale-100">
              {/* Winner Announcement Header - Moved higher to avoid overlap */}
              <div className="absolute -top-16 left-0 right-0 flex flex-col items-center animate-bounce-in z-50">
                <div className="bg-emerald-500 text-black px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.4em] shadow-2xl mb-2">
                  TRICK COMPLETE
                </div>
                <h2 className="text-4xl md:text-5xl font-black italic text-white tracking-tighter uppercase drop-shadow-[0_0_30px_rgba(0,0,0,0.5)] text-center px-4">
                  {trumpAnnouncement.winnerName} WINS!
                </h2>
              </div>

              {/* Central Table Visual */}
              <div className="relative w-32 h-32 bg-white/5 rounded-full border border-white/10 flex items-center justify-center shadow-inner">
                <div className="text-white/5 font-black text-4xl italic select-none">TRUF</div>

                {/* Compass Cards */}
                {[0, 1, 2, 3].map(seatIdx => {
                  const pos = getRelativePosition(seatIdx);
                  const playedData = trumpAnnouncement.trickCards[seatIdx];
                  const isWinner = seatIdx === trumpAnnouncement.winnerSeatIndex;

                  let posClass = "";
                  switch (pos) {
                    case "top": posClass = "-translate-y-28"; break;
                    case "bottom": posClass = "translate-y-28"; break;
                    case "left": posClass = "-translate-x-28"; break;
                    case "right": posClass = "translate-x-28"; break;
                  }

                  return (
                    <div key={seatIdx} className={`absolute transition-all duration-700 ${posClass} ${playedData ? 'opacity-100 scale-100' : 'opacity-10 scale-75'}`}>
                      {playedData ? (
                        <div className={`relative w-20 h-30 bg-white rounded-xl shadow-2xl border-2 flex flex-col justify-between p-2.5 transform ${isWinner ? 'border-yellow-400 scale-110 z-50 shadow-[0_0_40px_rgba(234,179,8,0.5)] animate-pulse' : 'border-slate-300'}`}>
                          {isWinner && (
                            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-yellow-400 text-black text-[8px] font-black px-2 py-0.5 rounded-full shadow-lg z-50 border border-black whitespace-nowrap">
                              WINNER
                            </div>
                          )}

                          <div className={`flex justify-between items-start font-black text-base leading-none ${['♥️', '♦️'].includes(playedData.card.suit) ? 'text-red-600' : 'text-slate-900'}`}>
                            <span>{playedData.card.value === 14 || playedData.card.value === 1 ? 'A' : playedData.card.value === 13 ? 'K' : playedData.card.value === 12 ? 'Q' : playedData.card.value === 11 ? 'J' : playedData.card.value}</span>
                            <span className="text-lg">{playedData.card.suit}</span>
                          </div>

                          <div className={`flex items-center justify-center text-4xl flex-1 drop-shadow-sm`}>
                            {playedData.card.suit}
                          </div>

                          <div className="text-[9px] font-black text-slate-500 uppercase tracking-tighter text-center border-t border-slate-100 pt-1 truncate w-full">
                            {roomData.seats[seatIdx].name}
                          </div>
                        </div>
                      ) : (
                        <div className="w-16 h-24 bg-black/40 border-2 border-dashed border-white/5 rounded-xl flex items-center justify-center">
                          <span className="text-white/5 text-[8px] font-black uppercase">EMPTY</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Footer Status */}
              <div className="absolute bottom-8 flex justify-center w-full">
                <div className={`px-6 py-2 rounded-xl font-black uppercase tracking-[0.2em] text-[10px] shadow-xl border transition-all ${trumpAnnouncement.isTrumpWin ? 'bg-emerald-500 text-black border-white animate-bounce' : 'bg-white/5 text-white/20 border-white/5'}`}>
                  {trumpAnnouncement.isTrumpWin ? 'TRUMP POWER USED' : 'NORMAL VICTORY'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Trick Round HUD (Floating) */}
        {(roomData.status === 'playing' || roomData.status === 'round_over') && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-48 z-40 opacity-40">
            <span className="text-2xl font-black text-emerald-500 uppercase tracking-[0.5em]">
              TRICK {Math.min(roomData.trickCount || 1, 13)} / 13
            </span>
          </div>
        )}

        {/* Trick Zone: Center of Table (Compass Formation) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {roomData.status === 'playing' ? (
            <div className="relative w-20 h-28">
              {roomData.currentTrick?.map((item, idx) => {
                const pos = getRelativePosition(item.seatIndex);
                let transformStyle = {};

                // Compass Formation Logic
                switch (pos) {
                  case "bottom": transformStyle = { transform: 'translateY(60px) rotate(0deg)' }; break;
                  case "left": transformStyle = { transform: 'translateX(-80px) rotate(-10deg)' }; break;
                  case "top": transformStyle = { transform: 'translateY(-60px) rotate(0deg)' }; break;
                  case "right": transformStyle = { transform: 'translateX(80px) rotate(10deg)' }; break;
                }

                return (
                  <div
                    key={idx}
                    style={transformStyle}
                    className="absolute inset-0 w-20 h-28 rounded-xl shadow-[0_15px_40px_rgba(0,0,0,0.6)] transition-all duration-700 ease-out border border-white/10"
                  >
                    {item.isFaceDown ? (
                      <div className="w-full h-full bg-emerald-950 border-2 border-emerald-500/30 rounded-xl flex items-center justify-center p-1">
                        <div className="w-full h-full border border-emerald-500/10 rounded-lg flex items-center justify-center bg-emerald-900/50">
                          <span className="text-2xl opacity-30 italic font-black text-emerald-400">T</span>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-full bg-white text-black border-2 border-slate-300 rounded-xl flex flex-col justify-between p-2 leading-none shadow-inner relative">
                        {/* Trump Badge */}
                        {item.card.suit === roomData.trufSuit && roomData.isTrumpRevealed && (
                          <div className="absolute -top-3 -right-3 bg-emerald-500 text-black text-[8px] font-black px-1.5 py-1 rounded-md shadow-lg animate-bounce z-50 border border-white/20">
                            TRUMP
                          </div>
                        )}

                        <div className="flex justify-between items-start font-bold text-xs">
                          <span className={['♥️', '♦️'].includes(item.card.suit) ? 'text-red-600' : 'text-black'}>
                            {item.card.value === 1 ? 'A' : item.card.value === 11 ? 'J' : item.card.value === 12 ? 'Q' : item.card.value === 13 ? 'K' : item.card.value}
                          </span>
                          <span>{item.card.suit}</span>
                        </div>
                        <div className="text-4xl text-center self-center">{item.card.suit}</div>
                        <div className="flex justify-end items-end font-bold text-xs rotate-180">
                          <span>{item.card.suit}</span>
                          <span className={['♥️', '♦️'].includes(item.card.suit) ? 'text-red-600' : 'text-black'}>
                            {item.card.value === 1 ? 'A' : item.card.value === 11 ? 'J' : item.card.value === 12 ? 'Q' : item.card.value === 13 ? 'K' : item.card.value}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : roomData.status === 'betting' ? (
            <div className="flex flex-col items-center gap-2 bg-black/40 backdrop-blur-xl p-8 rounded-[40px] border border-white/10 pointer-events-auto">
              <p className="text-xs font-black text-yellow-500 uppercase tracking-[0.5em] animate-pulse">Betting Phase</p>
              <div className="flex items-center gap-4">
                {roomData.seats.map((s, i) => s.type !== 'empty' && (
                  <div key={i} className={`w-3 h-3 rounded-full ${roomData.bets?.[i] ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-white/10'}`}></div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-black/40 backdrop-blur-xl p-8 rounded-[40px] border border-white/10 pointer-events-auto text-center">
              <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Awaiting Warriors</p>
              {isHost && roomData.seats.filter(s => s.type !== 'empty').length >= 2 ? (
                <button
                  onClick={initializeGame}
                  className="px-10 py-4 bg-gradient-to-r from-emerald-500 to-green-600 rounded-2xl font-black text-xl hover:scale-105 transition-all shadow-xl shadow-emerald-500/20"
                >
                  START GAME
                </button>
              ) : (
                <div className="text-sm text-slate-500 italic">Need at least 2 warriors...</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* My Hand & Action Controls (Bottom) */}
      {(roomData.status === 'playing' || roomData.status === 'betting') && isUserSeated && (
        <div className="fixed bottom-10 left-0 right-0 flex flex-col items-center gap-6 z-50">

          {/* Status Message */}
          {roomData.status === 'betting' && hasSubmittedBet && (
            <div className="bg-emerald-500 text-black px-6 py-2 rounded-full font-black animate-bounce shadow-xl">
              MENUNGGU PEMAIN LAIN...
            </div>
          )}

          {/* Hand Cards - Dynamic Layout System */}
          <div className="relative w-full max-w-4xl h-56 flex justify-center items-end select-none pointer-events-none">
            <div className="relative h-full w-full max-w-4xl pointer-events-auto">
              {roomData.seats[mySeatIndex].hand?.map((card, i) => {
                const hand = roomData.seats[mySeatIndex].hand;
                const totalCards = hand.length;
                const isSelected = selectedCard?.value === card.value && selectedCard?.suit === card.suit;
                const playable = isPlayable(card);
                const isMyTurn = roomData.turnIndex === mySeatIndex || roomData.status === 'betting';

                // Hand Layout Constants
                const containerWidth = typeof window !== 'undefined' ? Math.min(window.innerWidth * 0.85, 1000) : 900;
                const cardWidth = typeof window !== 'undefined' && window.innerWidth < 768 ? 80 : 112;
                const totalRequiredWidth = totalCards * cardWidth;

                let step = cardWidth + 8; // Default comfortable spacing
                if (totalRequiredWidth > containerWidth && totalCards > 1) {
                  const overlap = (totalRequiredWidth - containerWidth) / (totalCards - 1);
                  step = cardWidth - overlap;
                }

                // Center the hand by calculating the starting X
                const handWidth = (totalCards - 1) * step + cardWidth;
                const startX = (containerWidth - handWidth) / 2;
                const xPos = startX + (i * step);

                return (
                  <div
                    key={i}
                    onClick={() => playable && !hasSubmittedBet && setSelectedCard(isSelected ? null : card)}
                    style={{
                      left: `${xPos}px`,
                      zIndex: isSelected ? 200 : i + 1,
                      transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                    }}
                    className={`absolute bottom-0 w-20 h-32 md:w-28 md:h-40 bg-white rounded-2xl border-2 shadow-2xl origin-bottom group
                      ${isSelected ? 'border-yellow-400 -translate-y-[30px] scale-105 shadow-[0_20px_60px_rgba(234,179,8,0.5)]' : 'border-slate-200'}
                      ${playable && isMyTurn ? 'opacity-100 cursor-pointer hover:-translate-y-[20px] hover:z-[300]' : 'opacity-40 grayscale cursor-not-allowed translate-y-4'}
                    `}
                  >
                    <div className="flex justify-between items-start p-2 md:p-3 pb-0">
                      <div className="flex flex-col items-center leading-none">
                        <span className={`text-base md:text-xl font-black ${['♥️', '♦️'].includes(card.suit) ? 'text-red-600' : 'text-slate-900'}`}>
                          {card.value === 1 ? 'A' : card.value === 11 ? 'J' : card.value === 12 ? 'Q' : card.value === 13 ? 'K' : card.value}
                        </span>
                        <span className="text-xs md:text-sm mt-0.5">{card.suit}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-center text-3xl md:text-5xl h-16 md:h-20 drop-shadow-sm">
                      {card.suit}
                    </div>

                    <div className="flex justify-start items-end p-2 md:p-3 pt-0 rotate-180 opacity-20">
                      <div className="flex flex-col items-center leading-none">
                        <span className="text-sm md:text-lg font-bold">
                          {card.value === 1 ? 'A' : card.value === 11 ? 'J' : card.value === 12 ? 'Q' : card.value === 13 ? 'K' : card.value}
                        </span>
                        <span className="text-xs">{card.suit}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Player Actions */}
          <div className="flex items-center gap-4 animate-bounce-in">
            {roomData.status === 'betting' && !hasSubmittedBet && (
              <button
                disabled={!selectedCard}
                onClick={submitBet}
                className={`px-12 py-5 rounded-2xl font-black text-xl shadow-2xl transition-all transform active:scale-95 ${selectedCard
                  ? "bg-yellow-400 text-black hover:bg-yellow-300 hover:scale-105 shadow-[0_0_30px_rgba(234,179,8,0.3)]"
                  : "bg-white/5 border border-white/10 text-slate-500 cursor-not-allowed"
                  }`}
              >
                PLACE BET
              </button>
            )}

            {roomData.status === 'playing' && roomData.turnIndex === mySeatIndex && (
              <button
                disabled={!selectedCard}
                onClick={handlePlayCard}
                className={`px-12 py-5 rounded-2xl font-black text-xl shadow-2xl transition-all transform active:scale-95 ${selectedCard
                  ? "bg-emerald-500 text-black hover:bg-emerald-400 hover:scale-105 shadow-[0_0_30px_rgba(16,185,129,0.3)]"
                  : "bg-white/5 border border-white/10 text-slate-500 cursor-not-allowed"
                  }`}
              >
                PLAY CARD
              </button>
            )}
          </div>
        </div>
      )}



      {/* Round Result Modal */}
      {roomData.status === 'round_over' && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[100] flex flex-col items-center justify-center p-4 md:p-10 animate-fade-in overflow-y-auto">
          <div className="w-full max-w-3xl bg-slate-900/50 p-6 md:p-12 rounded-[50px] border border-white/10 shadow-2xl text-center relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent"></div>

            <h2 className="text-3xl md:text-5xl font-black italic tracking-tighter text-white mb-2 uppercase">Round {roomData.roundNumber || 1} Complete</h2>
            <p className="text-emerald-500 font-bold tracking-[0.4em] text-[10px] md:text-xs uppercase mb-10">Battle Arena Summary</p>

            {/* Stats Table */}
            <div className="w-full overflow-hidden rounded-3xl border border-white/5 bg-black/40 mb-10">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-white/5 text-[10px] md:text-xs font-black uppercase tracking-widest text-slate-500">
                    <th className="px-6 py-4">Warrior</th>
                    <th className="px-6 py-4 text-center">Target (Bid)</th>
                    <th className="px-6 py-4 text-center">Actual (Won)</th>
                    <th className="px-6 py-4 text-center">Verdict</th>
                    <th className="px-6 py-4 text-center">Round Score</th>
                    <th className="px-6 py-4 text-right">Total Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {roomData.seats.filter(s => s.type !== 'empty').sort((a, b) => {
                    // Sort by total score descending
                    return (b.score || 0) - (a.score || 0);
                  }).map((seat, i) => {
                    const originalIndex = roomData.seats.indexOf(seat);
                    const bid = roomData.bids?.[originalIndex] || 0;
                    const won = (roomData.tricksWon?.[originalIndex]) || 0;
                    const passed = won === bid;
                    const diff = Math.abs(won - bid);
                    let roundScore = 0;
                    const isAtas = roomData.strategy === "ATAS";

                    if (passed) {
                      roundScore = bid === 0 ? 50 : bid * 10;
                    } else {
                      if (isAtas) {
                        roundScore = won > bid ? diff * -1 : diff * -2;
                      } else {
                        roundScore = won > bid ? diff * -2 : diff * -1;
                      }
                    }

                    return (
                      <tr key={i} className={`text-xs md:text-sm group hover:bg-white/5 transition-colors`}>
                        <td className="px-6 py-4 flex items-center gap-3">
                          <img src={seat.avatar} className={`w-8 h-8 rounded-full border ${passed ? 'border-emerald-500' : 'border-red-500'}`} />
                          <span className="font-bold text-white uppercase">{seat.name}</span>
                        </td>
                        <td className="px-6 py-4 text-center font-mono font-bold text-slate-400">{bid}</td>
                        <td className="px-6 py-4 text-center font-mono font-bold text-white">{won}</td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter ${passed ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                            {passed ? 'PASSED' : 'FAILED'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`font-black text-lg ${roundScore >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {roundScore > 0 ? `+${roundScore}` : roundScore}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="font-black text-lg text-white">{seat.score || 0}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {isHost ? (
              <button
                onClick={handleNextRound}
                className="w-full py-6 md:py-8 bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xl md:text-2xl rounded-[30px] transition-all shadow-[0_0_50px_rgba(16,185,129,0.3)] active:scale-95 uppercase tracking-tighter italic"
              >
                Start Next Round
              </button>
            ) : (
              <div className="p-6 bg-white/5 border border-white/5 rounded-[30px] text-slate-400 italic font-bold text-sm md:text-base animate-pulse">
                Waiting for the host to initiate the next battle...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}