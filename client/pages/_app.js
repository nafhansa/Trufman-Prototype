import Head from "next/head";
import "../styles/globals.css";
import { useEffect } from "react";
import { useRouter } from "next/router";
import { auth } from "../firebase";

export default function App({ Component, pageProps }) {
  const router = useRouter();

  useEffect(() => {
    // Jangan cek di halaman login
    if (router.pathname === "/login") return;

    const u = localStorage.getItem("user");
    const loginAt = localStorage.getItem("loginAt");

    if (!u) {
      if (router.pathname !== "/login") router.push("/login");
      return;
    }

    // Cek durasi login (6 jam = 21,600,000 ms)
    if (loginAt) {
      const now = Date.now();
      const sixHours = 6 * 60 * 60 * 1000;
      if (now - parseInt(loginAt) > sixHours) {
        localStorage.removeItem("user");
        localStorage.removeItem("loginAt");
        auth.signOut();
        router.push("/login");
      }
    }
  }, [router.pathname]);

  return (
    <>
      <Head />
      <Component {...pageProps} />
    </>
  );
}