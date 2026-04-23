import React, { useState, useEffect, createContext, useContext } from "react";
import {
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import api from "./api";

// ─── Pages ───────────────────────────────────────────────────────────────────
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import Personas from "./pages/Personas";
import Sessions from "./pages/Sessions";
import ProjectDetail from "./pages/ProjectDetail";

// ─── Auth Context ─────────────────────────────────────────────────────────────
export const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("squser");
    const token = localStorage.getItem("sqtoken");
    if (stored && token) {
      setUser(JSON.parse(stored));
    }
    setLoading(false);
  }, []);

  const login = (userData, token) => {
    localStorage.setItem("sqtoken", token);
    localStorage.setItem("squser", JSON.stringify(userData));
    setUser(userData);
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {}
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
  if (loading) return <div style={styles.loader}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects"
          element={
            <ProtectedRoute>
              <Projects />
            </ProtectedRoute>
          }
        />
        <Route
          path="/personas"
          element={
            <ProtectedRoute>
              <Personas />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sessions"
          element={
            <ProtectedRoute>
              <Sessions />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
        <Route
          path="/projects/:id"
          element={
            <ProtectedRoute>
              <ProjectDetail />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

const styles = {
  loader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    fontSize: "1rem",
    color: "#64748b",
  },
};
