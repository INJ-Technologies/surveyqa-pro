import React, { useState, useEffect, createContext, useContext } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import api from "./api";

// ─── Pages ───────────────────────────────────────────────────────────────────
import Login         from "./pages/Login";
import Dashboard     from "./pages/Dashboard";
import Projects      from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Personas      from "./pages/Personas";
import Sessions      from "./pages/Sessions";
import AIProviders   from './pages/AIProviders';

// ─── Auth Context ─────────────────────────────────────────────────────────────
export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("squser");
    const token  = localStorage.getItem("sqtoken");
    if (stored && token) setUser(JSON.parse(stored));
    setLoading(false);
  }, []);

  const login = (userData, token) => {
    localStorage.setItem("sqtoken", token);
    localStorage.setItem("squser", JSON.stringify(userData));
    setUser(userData);
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    localStorage.removeItem("sqtoken");
    localStorage.removeItem("squser");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Protected Route ──────────────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: "1rem", color: "#64748b" }}>
      Loading...
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <Routes>

        {/* Public */}
        <Route path="/login" element={<Login />} />

        {/* Protected — specific routes MUST come before the wildcard */}
        <Route path="/" element={
          <ProtectedRoute><Dashboard /></ProtectedRoute>
        } />

        <Route path="/projects" element={
          <ProtectedRoute><Projects /></ProtectedRoute>
        } />

        {/* This MUST be before path="*" */}
        <Route path="/projects/:id" element={
          <ProtectedRoute><ProjectDetail /></ProtectedRoute>
        } />

        <Route path="/personas" element={
          <ProtectedRoute><Personas /></ProtectedRoute>
        } />

        <Route path="/sessions" element={
          <ProtectedRoute><Sessions /></ProtectedRoute>
        } />

        <Route path="/ai_providers" element={
          <ProtectedRoute><AIProviders /></ProtectedRoute>
        } />

        {/* Wildcard — ALWAYS last */}
        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>
    </AuthProvider>
  );
}