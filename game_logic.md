# COMPREHENSIVE GAMEPLAY SCENARIO: "THE HIDDEN TRUMP"

Please use this specific scenario to validate and implement the logic for **Betting Results**, **Trump Determination**, and the **Face-Down Rule**.

## SCENARIO SETUP
* **Players:** P1 (Host), P2, P3, P4.
* **Deck:** Standard 52 cards.
* **Phase:** Transitions from `betting` to `playing`.

---

### PHASE 1: THE BETTING (Simultaneous)

**User Actions:**
1.  **P1** selects `King of Hearts` (K♥️) -> Clicks "Place Bet".
2.  **P2** selects `5 of Spades` (5♠️) -> Clicks "Place Bet".
3.  **P3** selects `Ace of Clubs` (A♣️) -> Clicks "Place Bet".
4.  **P4** selects `2 of Diamonds` (2♦️) -> Clicks "Place Bet".

**System Logic (Expected Result):**
1.  **Compare:** A♣️ (14) > K♥️ (13) > 5♠️ (5) > 2♦️ (2).
2.  **Winner:** **P3** is the winner of the bid.
3.  **Truf Determination:** The suit of the winning card (`A♣️`) is **CLUBS (♣️)**.
4.  **Database Updates:**
    * `roomData.trufSuit` = "♣️"
    * `roomData.turnIndex` = Index of P3 (P3 starts the game).
    * `roomData.status` = "playing"

---

### PHASE 2: THE PLAY - TRICK 1 (Normal Cards)

**Context:** Truf is **CLUBS (♣️)**.

**Action Sequence:**
1.  **P3 (Turn)** plays `Queen of Diamonds` (Q♦️).
    * *Logic:* Suit is ♦️ (Not Truf).
    * *Data:* `isFaceDown: false`.
    * *UI:* Shows "Q♦️" image.
2.  **P4 (Turn)** plays `10 of Diamonds` (10♦️).
    * *UI:* Shows "10♦️" image.
3.  **P1 (Turn)** plays `Jack of Diamonds` (J♦️).
    * *UI:* Shows "J♦️" image.
4.  **P2 (Turn)** plays `4 of Diamonds` (4♦️).
    * *UI:* Shows "4♦️" image.

**Table State (Visual):**
* Center Table contains 4 cards.
* **ALL** cards are **FACE UP** (Visible).
* *System clears table after delay.*

---

### PHASE 3: THE PLAY - TRICK 2 (The "Trump" Rule)

**Context:** Truf is still **CLUBS (♣️)**. P3 won the last trick (let's assume), so P3 leads again.

**Action Sequence:**
1.  **P3 (Turn)** plays `Jack of Spades` (J♠️).
    * *Check:* Suit ♠️ !== ♣️ (Truf).
    * *UI:* **Face Up** (Visible).
2.  **P4 (Turn)** has no Spades. Decides to cut. Plays `2 of Clubs` (2♣️).
    * *Check:* Suit ♣️ === ♣️ (**TRUF MATCH!**).
    * *Data:* `isFaceDown: true`.
    * *UI:* **FACE DOWN** (Show Card Back / Red Pattern). **Value/Suit hidden.**
3.  **P1 (Turn)** plays `King of Spades` (K♠️).
    * *Check:* Suit ♠️ !== ♣️.
    * *UI:* **Face Up** (Visible).
4.  **P2 (Turn)** has no Spades. Plays `King of Clubs` (K♣️).
    * *Check:* Suit ♣️ === ♣️ (**TRUF MATCH!**).
    * *Data:* `isFaceDown: true`.
    * *UI:* **FACE DOWN** (Show Card Back).

**CRITICAL TABLE STATE (Visual Requirement):**
The table must render 4 slots:
1.  Top (P3): `J♠️` (Visible)
2.  Right (P4): 🟥 **CARD BACK** (Hidden because it's Truf)
3.  Bottom (P1): `K♠️` (Visible)
4.  Left (P2): 🟥 **CARD BACK** (Hidden because it's Truf)
4.  Left (P2): 🟥 **CARD BACK** (Hidden because it's Truf)

---

**Implementation Checklist for Agent:**
1.  Did you create the `trufSuit` field in Firestore when betting ends?
2.  Does `handlePlayCard` compare `card.suit` vs `roomData.trufSuit`?
3.  Does the UI map over `roomData.currentTrick` and conditionally render the `<CardBack />` component if `isFaceDown` is true?