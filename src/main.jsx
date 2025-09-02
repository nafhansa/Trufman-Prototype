// src/main.jsx
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Lobby />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/room/:id" element={<Room />} />
          <Route path="/play/:id" element={<Play />} />
          <Route path="/solo" element={<AppPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthGate>
  </React.StrictMode>
);
