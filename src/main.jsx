import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import "./index.css";

import AuthGate from "./components/AuthGate.jsx";
import Lobby from "./pages/Lobby.jsx";
import Room from "./pages/Room.jsx";
import Play from "./pages/Play.jsx"; // ⬅️ tambah ini

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/room/:id" element={<Room />} />
          <Route path="/play/:id" element={<Play />} /> {/* ⬅️ route baru */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  </React.StrictMode>
);
