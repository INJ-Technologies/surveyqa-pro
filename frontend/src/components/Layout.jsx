import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../App";
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Activity,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Bell,
} from "lucide-react";

const NAV = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/projects", label: "Projects", icon: FolderKanban },
  { path: "/personas", label: "Personas", icon: Users },
  { path: "/sessions", label: "Sessions", icon: Activity },
];

export default function Layout({ children, title }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(true);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div style={s.shell}>
      {/* ── Sidebar ── */}
      <aside style={{ ...s.sidebar, width: open ? 240 : 64 }}>
        {/* Logo */}
        <div style={s.logo}>
          {open && (
            <img src="/logo.png" alt="INJ Technologies" style={s.logoImg} />
          )}
          <button style={s.toggleBtn} onClick={() => setOpen(!open)}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {/* Nav items */}
        <nav style={s.nav}>
          {NAV.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                style={{
                  ...s.navItem,
                  background: active ? "#f0f7ff" : "transparent",
                  borderLeft: active
                    ? "3px solid #2563eb"
                    : "3px solid transparent",
                  color: active ? "#1e3a5f" : "#64748b",
                  fontWeight: active ? 600 : 400,
                }}
              >
                <Icon size={20} style={{ flexShrink: 0 }} />
                {open && <span style={s.navLabel}>{label}</span>}
                {open && active && (
                  <ChevronRight size={14} style={{ marginLeft: "auto" }} />
                )}
              </button>
            );
          })}
        </nav>

        {/* User info + logout */}
        <div style={s.userArea}>
          {open && (
            <div style={s.userInfo}>
              <div style={s.userAvatar}>
                {user?.fullName?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div>
                <div style={s.userName}>{user?.fullName}</div>
                <div style={s.userRole}>{user?.role}</div>
              </div>
            </div>
          )}
          <button style={s.logoutBtn} onClick={handleLogout} title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main style={s.main}>
        {/* Header */}
        <header style={s.header}>
          <h1 style={s.pageTitle}>{title}</h1>
          <div style={s.headerRight}>
            <button style={s.iconBtn}>
              <Bell size={20} />
            </button>
            <div style={s.headerAvatar}>
              {user?.fullName?.charAt(0)?.toUpperCase() || "U"}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div style={s.content}>{children}</div>
      </main>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  shell: {
    display: "flex",
    height: "100vh",
    overflow: "hidden",
    background: "#f0f4f8",
  },
  sidebar: {
    background: "#ffffff",
    color: "#1e293b",
    display: "flex",
    flexDirection: "column",
    transition: "width 0.2s ease",
    overflow: "hidden",
    flexShrink: 0,
    borderRight: "1.5px solid #e2e8f0",
    boxShadow: "2px 0 8px rgba(0,0,0,0.04)",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px",
    borderBottom: "1.5px solid #f1f5f9",
    minHeight: 70,
  },
  logoImg: { height: 50, maxWidth: 150, objectFit: "contain" },
  logoTitle: {
    fontSize: "1.2rem",
    fontWeight: 700,
    color: "#1e3a5f",
    whiteSpace: "nowrap",
  },
  logoPro: {
    fontSize: "0.6rem",
    fontWeight: 700,
    color: "#2563eb",
    letterSpacing: 3,
    marginTop: 2,
  },
  toggleBtn: {
    background: "#f1f5f9",
    border: "none",
    color: "#1e293b",
    borderRadius: 6,
    padding: "6px 8px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
  },
  nav: { flex: 1, padding: "12px 0", overflowY: "auto" },
  navItem: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "11px 20px",
    border: "none",
    color: "#64748b",
    cursor: "pointer",
    fontSize: "0.9rem",
    transition: "all 0.15s",
    textAlign: "left",
    background: "transparent",
    fontFamily: "'Google Sans', -apple-system, sans-serif",
  },
  navLabel: { whiteSpace: "nowrap" },
  userArea: {
    borderTop: "1.5px solid #f1f5f9",
    padding: "16px",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },

  userInfo: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  userAvatar: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: "#1e3a5f",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: "0.9rem",
    flexShrink: 0,
    color: "white",
  },
  userName: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#1e293b",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  userRole: {
    fontSize: "0.7rem",
    color: "#94a3b8",
    textTransform: "capitalize",
  },
  logoutBtn: {
    background: "none",
    border: "none",
    color: "#94a3b8",
    cursor: "pointer",
    padding: 4,
    display: "flex",
    borderRadius: 6,
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    background: "white",
    padding: "0 28px",
    height: 64,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid #e2e8f0",
    flexShrink: 0,
  },
  pageTitle: { fontSize: "1.2rem", fontWeight: 700, color: "#1e293b" },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  iconBtn: {
    background: "none",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    display: "flex",
    color: "#64748b",
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "#1e3a5f",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  content: { flex: 1, overflow: "auto", padding: 28 },
};
