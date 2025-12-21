// utils/botAI.js

/**
 * 1. SMART BETTING LOGIC
 * Menghitung prediksi kemenangan berdasarkan kekuatan kartu
 */
export const calculateBotBid = (hand, trufSuit) => {
    let estimatedTricks = 0;
    const suits = {};

    hand.forEach((card) => {
        // Hitung distribusi suit untuk deteksi Long Suit
        if (!suits[card.suit]) suits[card.suit] = 0;
        suits[card.suit]++;

        // A. High Card Points (HCP)
        if (card.value === 14) estimatedTricks += 1.0; // As = Hampir pasti menang
        else if (card.value === 13) estimatedTricks += 0.7; // King = 70% menang
        else if (card.value === 12) estimatedTricks += 0.4; // Queen = 40% menang

        // B. Trump Power
        if (card.suit === trufSuit) {
            estimatedTricks += 0.5; // Bonus nilai untuk setiap kartu truf
            // Truf tinggi dapat bonus ekstra
            if (card.value >= 11) estimatedTricks += 0.3;
        }
    });

    // C. Long Suit Bonus (Panjang suit > 5 kartu bisa menang pakai kartu kecil)
    Object.keys(suits).forEach((suit) => {
        if (suits[suit] >= 5 && suit !== trufSuit) {
            estimatedTricks += (suits[suit] - 4) * 0.5;
        }
    });

    // D. Aggressiveness / Personality (Random Factor -1 sampai +1)
    const randomness = (Math.random() * 2) - 1;

    // Total Bid (Minimal 0)
    const finalBid = Math.max(0, Math.round(estimatedTricks + randomness));

    return finalBid;
};


/**
 * 2. HELPER: MEMORY & BOSS CARD LOGIC
 * Mengecek apakah kartu di tangan adalah kartu tertinggi yang TERSISA di permainan
 */
const isCardBoss = (myCard, playedCardsHistory, trufSuit) => {
    // Kartu yang bisa mengalahkan myCard adalah:
    // 1. Kartu dengan suit sama tapi value lebih besar.
    // 2. Kartu Truf (jika myCard bukan truf).

    // Kita asumsikan deck standar (2-14)
    // Cek apakah ada kartu "Lebih Kuat" yang BELUM keluar (tidak ada di playedCardsHistory)

    // Logic Sederhana: Cek semua kemungkinan kartu di atas myCard
    for (let val = myCard.value + 1; val <= 14; val++) {
        const betterCardExists = !playedCardsHistory.some(
            pc => pc.suit === myCard.suit && pc.value === val
        );
        // Jika ada kartu lebih tinggi yang belum keluar, berarti myCard BUKAN Boss
        if (betterCardExists) return false;
    }

    // Jika myCard bukan Truf, cek apakah masih ada Truf di luar sana?
    // (Ini logic expert, bisa disederhanakan: Anggap Boss jika tertinggi di Suit-nya)
    return true;
};


/**
 * 3. SMART PLAYING LOGIC
 * Menentukan kartu terbaik untuk dimainkan
 */
export const getBestMove = (botHand, currentTrick, trufSuit, isTrumpBroken, playedCardsHistory = []) => {

    // Helper: Hitung Power Absolut untuk perbandingan di meja
    const getCardPower = (card, leadSuit) => {
        let power = card.value;
        if (card.suit === trufSuit) power += 1000; // Truf level dewa
        else if (card.suit !== leadSuit && leadSuit) power = 0; // Salah suit = sampah
        return power;
    };

    // --- SKENARIO A: BOT JALAN DULUAN (LEAD) ---
    if (currentTrick.length === 0) {
        // 1. Cek aturan Breaking Trump: Jika belum broken, dilarang jalan truf kecuali cuma punya truf
        const nonTrumpCards = botHand.filter(c => c.suit !== trufSuit);
        let playableLeadCards = botHand;

        if (!isTrumpBroken && nonTrumpCards.length > 0) {
            playableLeadCards = nonTrumpCards;
        }

        // 2. Cek apakah punya "Boss Card" yang legal untuk dimainkan
        const bossCard = playableLeadCards.find(c =>
            isCardBoss(c, playedCardsHistory, trufSuit)
        );
        if (bossCard) return bossCard;

        // 3. Kalau gak punya Boss, mainkan kartu dari suit terpendek (selain truf)
        // atau kartu paling kecil dari pilihan yang legal
        const sortedPlayable = [...playableLeadCards].sort((a, b) => a.value - b.value);
        return sortedPlayable[0];
    }

    // --- SKENARIO B: BOT MERESPON (FOLLOW) ---
    else {
        const leadSuit = currentTrick[0].card.suit;

        // Cari kartu legal (harus ikut suit)
        const legalCards = botHand.filter(c => c.suit === leadSuit);
        const hasLeadSuit = legalCards.length > 0;

        // Cek kondisi meja saat ini
        let highestEnemyPower = -1;

        currentTrick.forEach((item) => {
            const p = getCardPower(item.card, leadSuit);
            if (p > highestEnemyPower) {
                highestEnemyPower = p;
            }
        });

        // --- SUB-SKENARIO: PUNYA SUIT YANG SAMA ---
        if (hasLeadSuit) {
            // Urutkan dari terlemah ke terkuat
            legalCards.sort((a, b) => a.value - b.value);

            // Cek apakah ada yang bisa mengalahkan meja?
            const winningCandidates = legalCards.filter(c => getCardPower(c, leadSuit) > highestEnemyPower);

            if (winningCandidates.length > 0) {
                // MENANG HEMAT: Keluarkan kartu terendah yang cukup buat menang
                return winningCandidates[0];
            } else {
                // PASTI KALAH: Buang sampah (kartu terendah)
                return legalCards[0];
            }
        }

        // --- SUB-SKENARIO: GAK PUNYA SUIT (CUT / DISCARD) ---
        else {
            // Cek apakah punya Truf?
            const trumps = botHand.filter(c => c.suit === trufSuit);

            if (trumps.length > 0) {
                // Urutkan truf dari kecil ke besar
                trumps.sort((a, b) => a.value - b.value);

                // Cek apakah meja sudah dikuasai Truf lawan yang sangat tinggi?
                const currentWinnerIsTrump = highestEnemyPower >= 1000;

                if (currentWinnerIsTrump) {
                    // Kalau lawan pakai truf, kita harus cari truf yang lebih tinggi
                    const higherTrump = trumps.find(t => getCardPower(t, leadSuit) > highestEnemyPower);
                    if (higherTrump) return higherTrump; // Over-trump

                    // Kalau truf kita kalah semua, jangan buang truf! Buang sampah lain.
                    // Ambil kartu non-truf terendah
                    const trash = botHand.filter(c => c.suit !== trufSuit).sort((a, b) => a.value - b.value);
                    return trash.length > 0 ? trash[0] : trumps[0];
                } else {
                    // Lawan belum pakai truf, kita potong pakai truf terkecil!
                    return trumps[0];
                }
            }

            // Gak punya suit, gak punya truf -> Pasrah (Buang kartu terendah apapun)
            return botHand.sort((a, b) => a.value - b.value)[0];
        }
    }
};