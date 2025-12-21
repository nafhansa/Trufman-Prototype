import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// --- PASTE CONFIG KAMU DI BAWAH SINI ---
const firebaseConfig = {
  apiKey: "AIzaSyBB5L1Mq77StB8egpD_tVgmK7pQzzJDX2I",
  authDomain: "trufman-card.firebaseapp.com",
  projectId: "trufman-card",
  storageBucket: "trufman-card.firebasestorage.app",
  messagingSenderId: "452210044016",
  appId: "1:452210044016:web:4253be05c1229d18fd98b5",
  measurementId: "G-97EF6FVS2Y"
};

// ----------------------------------------

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
const provider = new GoogleAuthProvider();

export const loginWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    console.error("Login Error:", error);
    return null;
  }
};