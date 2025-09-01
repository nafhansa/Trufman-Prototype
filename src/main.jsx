// src/main.jsx
import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

import AuthGate from "./components/AuthGate.jsx";
import Lobby from "./pages/Lobby.jsx";
import Room from "./pages/Room.jsx";
import Play from "./pages/Play.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import AppPage from "./App.jsx"; // halaman vs bot (default export TrufmanApp)
import ResetPassword from "./pages/ResetPassword.jsx";

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/room/:id" element={<Room />} />
          <Route path="/play/:id" element={<Play />} />
          <Route path="/solo" element={<AppPage />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  </React.StrictMode>
);
