import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AnalysisForm from "../components/AnalysisForm";
import { ArrowLeft, Sun, Moon, ShieldCheck, Settings } from "lucide-react";
import { convertToGeoJSON } from "../utils/fileConverter";

const PremiumLogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--accent-color)]">
    <path d="M12 2L21 6.5V17.5L12 22L3 17.5V6.5L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 2.5" />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" className="animate-pulse" />
    <path d="M12 2V6M12 18V22M3 12H7M17 12H21" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
  </svg>
);

const Dashboard = () => {
  const navigate = useNavigate();
  const [theme, setTheme] = useState("dark");
  const [liveTime, setLiveTime] = useState("");

  // Sync theme
  useEffect(() => {
    const savedTheme = localStorage.getItem("workspace-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("workspace-theme", newTheme);
  };

  // Clock
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      const day = d.getDate().toString().padStart(2, "0");
      const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      const month = months[d.getMonth()];
      const year = d.getFullYear();

      let hrs = d.getHours();
      const mins = d.getMinutes().toString().padStart(2, "0");
      const secs = d.getSeconds().toString().padStart(2, "0");
      const ampm = hrs >= 12 ? "PM" : "AM";
      hrs = hrs % 12;
      hrs = hrs ? hrs : 12; // 0 should be 12
      const hrsStr = hrs.toString().padStart(2, "0");

      setLiveTime(`${day} ${month} ${year} | ${hrsStr}:${mins}:${secs} ${ampm} IST`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleProcess = async ({ file, season, year, outputFolder, boundaryName, analysis_type }) => {
    try {
      const geojson = await convertToGeoJSON(file);
      localStorage.setItem("geoData", JSON.stringify(geojson));
      localStorage.setItem("analysisConfig", JSON.stringify({
        season,
        year: year.split('-')[0],
        outputFolder,
        boundaryName,
        analysis_type
      }));
      navigate("/map");
    } catch (error) {
      alert("Error processing file: " + error.message);
    }
  };

  return (
    <div className={`h-screen w-screen bg-[var(--bg-primary)] overflow-hidden flex flex-col relative select-none theme-${theme}`}>
      {/* Background Gradients */}
      <div className="absolute inset-0 bg-grid-pattern opacity-60 pointer-events-none z-0" />
      <div className="absolute top-[10%] left-[20%] w-[450px] h-[450px] rounded-full bg-[var(--accent-glow)] blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-[10%] right-[20%] w-[450px] h-[450px] rounded-full bg-cyan-500/5 blur-[120px] pointer-events-none z-0" />

      {/* ── TOP HEADER BAR (Thin, Elegant, Minimal) ────────────────────────────────── */}
      <header className="h-14 border-b border-[var(--border-color)] bg-[var(--glass-surface)] backdrop-blur-md px-6 flex items-center justify-between z-40 flex-shrink-0 relative">
        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent opacity-60" />

        {/* Left: Navigation and Logo & Software Title */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="group flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors border border-[var(--border-color)] hover:border-[var(--accent-color)]/30 px-2.5 py-1 rounded-lg bg-[var(--border-color)]/10 cursor-pointer text-[10px] font-mono uppercase tracking-wider font-semibold"
          >
            <ArrowLeft size={11} className="group-hover:-translate-x-0.5 transition-transform" />
            <span>Back</span>
          </button>

          <div className="w-[1px] h-4 bg-[var(--border-color)]" />

          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-glow)] border border-[var(--border-color)] flex items-center justify-center backdrop-blur shadow-sm hover:border-[var(--accent-color)]/40 transition-colors duration-300">
              <PremiumLogo />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-widest font-space leading-none uppercase text-[var(--text-main)]">RS-AIMS</h1>
              </div>
              <span className="text-[8px] font-mono text-[var(--text-muted)] tracking-wider uppercase leading-none mt-1 block">
                Rajasthan State Agriculture Intelligence Management System
              </span>
            </div>
          </div>
        </div>

        {/* Right: Live Feed Indicator, Settings, Theme toggle, System Clock */}
        <div className="flex items-center gap-4">
          {/* Live system clock */}
          <div className="hidden sm:block text-[10px] font-mono text-[var(--text-muted)] border-l border-[var(--border-color)]/30 pl-4 py-1 select-none">
            {liveTime || "26 MAY 2026 | 11:12:16 AM IST"}
          </div>

          {/* Theme switcher */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg border border-[var(--border-color)]/30 hover:border-[var(--accent-color)]/30 bg-[var(--border-color)]/5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all cursor-pointer flex items-center justify-center"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={13} className="text-amber-500" /> : <Moon size={13} className="text-sky-600" />}
          </button>
        </div>
      </header>

      {/* ── MAIN CONFIGURATION FORM ─────────────────────────────────── */}
      <main className="flex-1 min-h-0 flex items-center justify-center p-8 z-10">
        <div className="w-full max-w-4xl glass-panel p-8 rounded-2xl relative shadow-2xl">
          {/* Subtle GIS design corner accents */}
          <div className="absolute top-3 left-3 border-t-2 border-l-2 border-[var(--accent-color)]/30 w-3 h-3 pointer-events-none" />
          <div className="absolute top-3 right-3 border-t-2 border-r-2 border-[var(--accent-color)]/30 w-3 h-3 pointer-events-none" />
          <div className="absolute bottom-3 left-3 border-b-2 border-l-2 border-[var(--accent-color)]/30 w-3 h-3 pointer-events-none" />
          <div className="absolute bottom-3 right-3 border-b-2 border-r-2 border-[var(--accent-color)]/30 w-3 h-3 pointer-events-none" />

          <div className="mb-6 text-center">
            <h2 className="text-2xl font-bold font-space text-[var(--text-main)] tracking-wide uppercase leading-none">
              WORKSPACE <span className="text-[var(--accent-color)]">SETUP</span>
            </h2>
            <p className="text-[10px] font-mono text-[var(--text-muted)] mt-1.5 uppercase tracking-wider">Configure geographic boundaries and Sentinel-2 data acquisition period</p>
          </div>
          <AnalysisForm onProcess={handleProcess} />
        </div>
      </main>

      {/* ── PREMIUM INTELLIGENT FOOTER ────────────────────────────────── */}
      <footer className="h-7 border-t border-[var(--border-color)] bg-[var(--glass-surface)] backdrop-blur px-6 flex items-center justify-between text-[8.5px] font-mono text-[var(--text-muted)] tracking-wider z-40 flex-shrink-0">
        {/* Left Side */}
        <div className="flex items-center gap-2">
          <span className="font-bold text-[var(--text-main)]">RS-AIMS v2.0</span>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-main)] font-semibold">{liveTime}</span>
        </div>
      </footer>
    </div>
  );
};

export default Dashboard;
