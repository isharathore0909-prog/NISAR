import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Satellite, ArrowRight, Map, Layers, BarChart2, CheckCircle2, X, Info,
  CloudOff, LineChart, Target, Cpu, BarChart3, Sun, Moon, Terminal, ShieldAlert,
  Activity, Settings, ShieldCheck, Globe, Compass, Eye, Sliders, Brain
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const steps = [
  { icon: Map, title: "Select Area", desc: "Upload the boundary of the farm, village, or district you want to analyse." },
  { icon: Satellite, title: "Download Satellite Images", desc: "High-resolution satellite images for the selected season are downloaded automatically." },
  { icon: CloudOff, title: "Cloud & Noise Removal", desc: "Clouds, shadows, and haze are removed so only clean, usable images remain." },
  { icon: LineChart, title: "Seasonal Monitoring", desc: "Vegetation changes are tracked month-by-month across the full growing season." },
  { icon: Target, title: "Agriculture Detection", desc: "Crop land is automatically separated from barren land, buildings, and water bodies." },
  { icon: Layers, title: "Field Boundary Mapping", desc: "Detected crop areas are converted into precise farm field outlines." },
  { icon: Cpu, title: "Crop Identification", desc: "Wheat, Rice, Mustard, Cotton, Bajra, and Maize are identified per field." },
  { icon: BarChart3, title: "Yield & Area Estimation", desc: "Area in hectares/acres and estimated yield in tonnes are computed per crop type." },
  { icon: CheckCircle2, title: "Results & Export", desc: "Agriculture maps, crop type maps, field boundaries, and statistics are ready to save." },
];

const PremiumLogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--accent-color)]">
    <path d="M12 2L21 6.5V17.5L12 22L3 17.5V6.5L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 2.5" />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" className="animate-pulse" />
    <path d="M12 2V6M12 18V22M3 12H7M17 12H21" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
  </svg>
);

const fieldsData = [
  { id: "FR-104", name: "Center-Left Field", points: "365,292 595,288 602,650 362,654", crop: "Wheat", area: "14.8 ha", health: "92%", anim: "field-pulse-1", cx: 480, cy: 470, pctX: "47%", pctY: "46%" },
  { id: "FR-102", name: "Left Field", points: "215,294 350,292 350,655 210,658", crop: "Mustard", area: "8.5 ha", health: "88%", anim: "field-pulse-2", cx: 280, cy: 475, pctX: "27%", pctY: "46%" },
  { id: "FR-108", name: "Top-Right Field", points: "620,95 860,82 850,286 610,290", crop: "Gram", area: "11.2 ha", health: "90%", anim: "field-pulse-1", cx: 735, cy: 190, pctX: "72%", pctY: "18%" },
  { id: "FR-118", name: "Target Sector Field", points: "610,290 850,286 850,770 610,770", crop: "Wheat", area: "18.4 ha", health: "95%", anim: "field-pulse-2", cx: 730, cy: 530, pctX: "71%", pctY: "52%" },
  { id: "FR-101", name: "Bottom-Left Field", points: "210,670 340,668 330,750 205,750", crop: "Barley", area: "4.2 ha", health: "85%", anim: "field-pulse-2", cx: 270, cy: 710, pctX: "26%", pctY: "69%" },
  { id: "FR-105", name: "Bottom-Center Field", points: "360,670 590,665 590,770 360,770", crop: "Wheat", area: "12.6 ha", health: "91%", anim: "field-pulse-1", cx: 475, cy: 718, pctX: "46%", pctY: "70%" }
];

const Home = () => {
  const navigate = useNavigate();
  const [showInfo, setShowInfo] = useState(false);
  const [theme, setTheme] = useState("dark"); // "dark" or "light"
  const [liveTime, setLiveTime] = useState("");
  const [mapCollapsed, setMapCollapsed] = useState(false);
  const [hoveredField, setHoveredField] = useState(null);

  // Load theme preference on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem("workspace-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  // Sync theme to localStorage
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
      hrs = hrs ? hrs : 12;
      const hrsStr = hrs.toString().padStart(2, "0");

      setLiveTime(`${day} ${month} ${year} | ${hrsStr}:${mins}:${secs} ${ampm} IST`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`h-screen w-screen font-sans flex flex-col overflow-hidden relative select-none theme-${theme} bg-[var(--bg-primary)] text-[var(--text-main)]`}>
      {/* Global CSS variables & layout tokens */}
      <style>{`
        .font-space {
          font-family: 'Space Grotesk', sans-serif;
        }

        .bg-grid-pattern {
          background-image: 
            linear-gradient(var(--grid-color) 1px, transparent 1px),
            linear-gradient(90deg, var(--grid-color) 1px, transparent 1px);
          background-size: 40px 40px;
        }

        .grain-overlay {
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.035'/%3E%3C/svg%3E");
        }

        @keyframes grid-move {
          0% { background-position: 0px 0px; }
          100% { background-position: 40px 40px; }
        }

        @keyframes field-pulse-1 {
          0%, 100% { fill-opacity: 0.02; stroke-opacity: 0.25; }
          50% { fill-opacity: 0.12; stroke-opacity: 0.6; }
        }

        @keyframes field-pulse-2 {
          0%, 100% { fill-opacity: 0.01; stroke-opacity: 0.2; }
          50% { fill-opacity: 0.08; stroke-opacity: 0.45; }
        }

        @keyframes scan-line {
          0% { top: 0%; opacity: 0.08; }
          50% { top: 100%; opacity: 0.35; }
          100% { top: 0%; opacity: 0.08; }
        }

        .scanning-laser {
          position: absolute;
          left: 0;
          right: 0;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.08) 25%, var(--accent-color) 50%, rgba(16, 185, 129, 0.08) 75%, transparent);
          box-shadow: 0 0 10px 1.5px var(--accent-glow);
          animation: scan-line 12s ease-in-out infinite;
          pointer-events: none;
          z-index: 22;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--border-color);
          border-radius: 9px;
        }
      `}</style>

      {/* Global Background Systems */}
      <div className="absolute inset-0 transition-colors duration-500 z-0 bg-[var(--bg-primary)]" />
      <div className="absolute inset-0 bg-radial-gradient(circle at 50% -20%, rgba(16, 185, 129, 0.04), transparent 60%) pointer-events-none z-0" />
      <div className="absolute inset-0 bg-radial-gradient(circle at 10% 80%, rgba(6, 182, 212, 0.03), transparent 50%) pointer-events-none z-0" />
      <div className="absolute inset-0 grain-overlay opacity-35 dark:opacity-20 pointer-events-none z-0" />
      <div className="absolute inset-0 bg-grid-pattern opacity-[0.25] dark:opacity-[0.14] animate-[grid-move_80s_linear_infinite] pointer-events-none z-0" />

      {/* ── TOP HEADER BAR (Thin, Elegant, Minimal) ────────────────────────────────── */}
      <header className="h-14 border-b border-[var(--border-color)] bg-[var(--glass-surface)] backdrop-blur-md px-6 flex items-center justify-between z-40 flex-shrink-0 relative">
        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent opacity-60" />

        {/* Left: Logo & Software Title */}
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




        {/* Right: Live Feed Indicator, Settings, Theme toggle, System Clock */}
        <div className="flex items-center gap-4">


          {/* Live system clock */}
          <div className="hidden sm:block text-[10px] font-mono text-[var(--text-muted)] border-l border-[var(--border-color)]/30 pl-4 py-1 select-none">
            {liveTime || "26 MAY 2026 | 11:12:16 AM IST"}
          </div>



          {/* Theme switcher */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg border border-[var(--border-color)]/30 hover:border-[var(--accent-color)]/30 bg-[var(--border-color)]/5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all cursor-pointer"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={13} className="text-amber-500" /> : <Moon size={13} className="text-sky-600" />}
          </button>
        </div>
      </header>

      {/* ── MAIN WORKSPACE BODY (Split layout: 48% Left / 52% Right) ──────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden relative z-10">

        {/* ── LEFT PANEL: PREMIUM WORKSPACE (48% Width) ─────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="w-full lg:w-[48%] h-full flex flex-col border-r border-[var(--border-color)] bg-[var(--glass-surface)] backdrop-blur-md px-6 md:px-12 py-6 md:py-10 justify-between z-20 overflow-y-auto custom-scrollbar"
        >
          {/* Section Slogan & Headline */}
          <div className="space-y-5 my-auto text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--accent-glow)] border border-[var(--accent-color)]/25 text-[9px] font-bold font-mono tracking-widest text-[var(--accent-color)] uppercase shadow-[0_0_12px_var(--accent-glow)] select-none">
              <Satellite size={11} className="text-[var(--accent-color)] animate-[pulse_2s_infinite]" />
              <span>Precision Satellite Analytics</span>
            </div>
            <h2 className="text-2xl md:text-4xl font-extrabold tracking-tight font-space leading-[1.2] uppercase">
              <span className="bg-gradient-to-r from-[var(--text-main)] via-[var(--text-main)] to-[var(--accent-color)] bg-clip-text text-transparent">
                Satellite-Powered
              </span>
              <br className="hidden md:inline" />
              <span className="bg-gradient-to-r from-[var(--accent-color)] via-emerald-400 to-teal-500 bg-clip-text text-transparent">
                Agriculture Intelligence
              </span>
            </h2>
            <p className="text-xs md:text-sm text-[var(--text-muted)] leading-relaxed font-normal max-w-xl border-l-2 border-[var(--accent-color)]/20 pl-4">
              Upload field boundaries, process Sentinel satellite imagery, classify crop regions, generate vegetation intelligence layers, and estimate agricultural productivity using multi-temporal geospatial analytics.
            </p>
          </div>

          {/* Capability Modules Section */}
          <div className="flex flex-col gap-3 my-8 md:my-auto">
            <span className="font-mono text-[9px] text-[var(--text-muted)] uppercase tracking-wider block font-bold leading-none">
              System Capabilities
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "AI Farmland Extraction", desc: "Neural network-based boundary mapping & non-crop extraction", icon: Map, color: "text-[var(--accent-color)]" },
                { label: "Deep Crop Classification", desc: "Multi-spectral deep learning crop type identification", icon: Cpu, color: "text-teal-400" },
                { label: "Predictive Yield Analytics", desc: "AI-powered regression models for acreage & production yield", icon: BarChart3, color: "text-emerald-400" },
                { label: "AI Vegetation Health", desc: "Neural temporal profile tracking for seasonal health & stress", icon: Brain, color: "text-cyan-400" }
              ].map((feat, idx) => {
                const IconComp = feat.icon;
                return (
                  <div
                    key={idx}
                    className="group relative p-3 bg-[var(--border-color)]/5 border border-[var(--border-color)]/20 hover:border-[var(--accent-color)]/30 rounded-xl flex flex-col items-start gap-2.5 transition-all duration-300 cursor-default overflow-hidden"
                  >
                    {/* Subtle hover background highlight */}
                    <div className="absolute inset-0 bg-gradient-to-b from-[var(--accent-glow)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                    <div className="w-8 h-8 flex items-center justify-center bg-[var(--border-color)]/10 rounded-lg border border-[var(--border-color)]/30 flex-none group-hover:border-[var(--accent-color)]/20 transition-colors duration-300">
                      <IconComp size={15} className={`${feat.color} group-hover:scale-110 transition-transform duration-300`} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] font-bold text-[var(--text-main)] group-hover:text-[var(--accent-color)] transition-colors duration-200 leading-tight">
                        {feat.label}
                      </span>
                      <span className="text-[9.5px] text-[var(--text-muted)] leading-tight mt-1">
                        {feat.desc}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>



          {/* Action Triggers */}
          <div className="flex flex-col sm:flex-row gap-3 my-auto w-full pt-4 border-t border-[var(--border-color)]/20">
            <button
              onClick={() => navigate("/initialize")}
              className="flex-1 h-11 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold font-space tracking-wider text-[11px] uppercase rounded-lg shadow-[0_4px_14px_rgba(16,185,129,0.15)] hover:shadow-[0_6px_20px_rgba(16,185,129,0.3)] hover:-translate-y-[1px] active:translate-y-0 transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Start New Analysis</span>
              <ArrowRight size={13} className="stroke-[2.5px] transition-transform duration-300 group-hover:translate-x-1" />
            </button>

            <button
              onClick={() => setShowInfo(true)}
              className="flex-1 h-11 bg-[var(--border-color)]/5 border border-[var(--border-color)]/30 hover:border-[var(--accent-color)]/30 hover:bg-[var(--border-color)]/10 text-[var(--text-main)] hover:text-[var(--accent-color)] font-semibold font-space tracking-wider text-[11px] uppercase rounded-lg shadow-sm transition-all duration-300 flex items-center justify-center cursor-pointer"
            >
              System Overview
            </button>
          </div>
        </motion.div>

        {/* Mobile/Tablet Map Toggle Header */}
        <div
          onClick={() => setMapCollapsed(!mapCollapsed)}
          className="lg:hidden w-full flex items-center justify-between px-6 py-2.5 border-b border-t border-[var(--border-color)]/40 bg-[var(--glass-surface)]/80 text-[10px] font-mono text-[var(--accent-color)] cursor-pointer select-none"
        >
          <div className="flex items-center gap-2">
            <Globe size={12} className="animate-spin" style={{ animationDuration: "12s" }} />
            <span className="font-bold tracking-wider">LIVE SATELLITE VISUALIZER PREVIEW</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-[var(--text-muted)]">[{mapCollapsed ? "EXPAND" : "COLLAPSE"}]</span>
            <Compass size={11} className={`transform transition-transform duration-300 ${mapCollapsed ? "" : "rotate-180"}`} />
          </div>
        </div>

        {/* ── RIGHT PANEL: GIS SATELLITE INTELLIGENCE ENVIRONMENT (52% Width) ─────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.0, ease: "easeOut" }}
          style={{ height: mapCollapsed ? "0px" : undefined }}
          className={`w-full lg:w-[52%] h-[320px] sm:h-[400px] lg:h-full relative bg-[#020617] overflow-hidden transition-all duration-500 lg:block flex-shrink-0 ${mapCollapsed ? "h-0 border-b-0 overflow-hidden" : ""}`}
        >
          {/* Sweeping Laser Scanline */}
          <div className="scanning-laser z-20" />

          {/* Main Visualizer Container - matches aspect ratio and centers the image and overlays */}
          <div className="absolute inset-0 m-auto aspect-square max-h-full max-w-full flex items-center justify-center">
            {/* Live satellite imagery overlay spanning full parent width */}
            <img
              src="home_satellite_data.png"
              alt="Farmland Analytics Visual"
              className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none transition-all duration-700 filter brightness-[0.95] contrast-[1.02] z-10"
            />

            {/* Cropland Extraction Mask SVG Overlay */}
            <svg
              viewBox="0 0 1024 1024"
              className="absolute inset-0 w-full h-full z-15 pointer-events-auto"
            >
              <defs>
                <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {fieldsData.map((field) => (
                <polygon
                  key={field.id}
                  points={field.points}
                  className={`cursor-pointer transition-all duration-300 stroke-[#10b981] hover:stroke-[#34d399] ${
                    field.anim === 'field-pulse-1' 
                      ? 'animate-[field-pulse-1_6s_ease-in-out_infinite]' 
                      : 'animate-[field-pulse-2_7s_ease-in-out_infinite]'
                  }`}
                  style={{
                    filter: "url(#neonGlow)",
                    strokeWidth: hoveredField?.id === field.id ? 3.5 : 2,
                    fill: hoveredField?.id === field.id ? "rgba(16, 185, 129, 0.28)" : "rgba(16, 185, 129, 0.12)",
                  }}
                  onMouseEnter={() => setHoveredField(field)}
                  onMouseLeave={() => setHoveredField(null)}
                />
              ))}
            </svg>

            {/* Floating Cyber Tooltip Overlay */}
            <AnimatePresence>
              {hoveredField && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 5 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 5 }}
                  transition={{ duration: 0.2 }}
                  className="absolute z-30 pointer-events-none bg-[var(--card-bg)]/90 backdrop-blur-md border border-[var(--accent-color)]/50 rounded-lg p-2.5 shadow-[0_0_15px_var(--accent-glow)] flex flex-col gap-1 w-36 font-mono text-[9px]"
                  style={{
                    left: hoveredField.pctX,
                    top: hoveredField.pctY,
                    transform: "translate(-50%, -120%)",
                  }}
                >
                  <div className="flex justify-between items-center border-b border-[var(--border-color)] pb-1 mb-1">
                    <span className="font-bold text-[var(--accent-color)]">{hoveredField.id}</span>
                    <span className="text-[7px] bg-[var(--accent-glow)] px-1 rounded text-[var(--accent-color)] font-bold">EXTRACTED</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">CROP:</span>
                    <span className="text-[var(--text-main)] font-bold">{hoveredField.crop}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">AREA:</span>
                    <span className="text-[var(--text-main)] font-bold">{hoveredField.area}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">HEALTH:</span>
                    <span className="text-emerald-400 font-bold">{hoveredField.health}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Fine GIS Overlay Grid (Pattern lines) */}
          <svg className="absolute inset-0 w-full h-full opacity-[0.08] pointer-events-none z-15">
            <defs>
              <pattern id="gisPatternGrid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M 50 0 L 0 0 0 50" fill="none" stroke="var(--accent-color)" strokeWidth="0.5" strokeDasharray="1 3" />
                <circle cx="0" cy="0" r="1.2" fill="var(--accent-color)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#gisPatternGrid)" />
          </svg>

          {/* HUD Corner borders */}
          <div className="absolute pointer-events-none z-25" style={{ top: 20, left: 20, right: 20, bottom: 20 }}>
            <div className="absolute top-0 left-0 w-[15px] h-[15px] border-t border-l border-[var(--border-color)] opacity-40" />
            <div className="absolute top-0 right-0 w-[15px] h-[15px] border-t border-r border-[var(--border-color)] opacity-40" />
            <div className="absolute bottom-0 left-0 w-[15px] h-[15px] border-b border-l border-[var(--border-color)] opacity-40" />
            <div className="absolute bottom-0 right-0 w-[15px] h-[15px] border-b border-r border-[var(--border-color)] opacity-40" />
          </div>
        </motion.div>
      </div>



      {/* ── SYSTEM SPECIFICATIONS MODAL (Cinematic Overlay) ────────────────────────── */}
      <AnimatePresence>
        {showInfo && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 md:p-8"
            onClick={() => setShowInfo(false)}
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-[var(--card-bg)] w-full max-w-xl rounded-2xl shadow-2xl border border-[var(--border-color)] flex flex-col max-h-[85vh] overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--glass-surface)] relative">
                <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--accent-color)]/30 to-transparent opacity-60" />
                <h3 className="text-xs font-bold text-[var(--text-main)] uppercase tracking-widest font-space flex items-center gap-2">
                  <Sliders size={13} className="text-[var(--accent-color)] animate-[spin_5s_linear_infinite]" />
                  <span>Processing Pipeline Workflow</span>
                </h3>
                <button
                  onClick={() => setShowInfo(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-1 rounded-md hover:bg-[var(--border-color)]/10 transition-all cursor-pointer flex items-center justify-center border-0 outline-none"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Pipeline Step List */}
              <div className="overflow-y-auto px-6 py-5 space-y-4 custom-scrollbar relative">
                {/* Vertical timeline connector */}
                <div className="absolute left-[34px] top-6 bottom-6 w-[1.5px] bg-gradient-to-b from-[var(--accent-color)]/60 via-[var(--accent-color)]/20 to-transparent z-0 pointer-events-none" />

                {steps.map((step, idx) => {
                  const IconComp = step.icon;
                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="flex gap-5 relative z-10 group"
                    >
                      {/* Timeline Dot/Icon */}
                      <div className="w-9 h-9 rounded-full flex items-center justify-center bg-[var(--card-bg)] border border-[var(--border-color)] group-hover:border-[var(--accent-color)]/60 group-hover:shadow-[0_0_12px_var(--accent-glow)] text-[var(--text-muted)] group-hover:text-[var(--accent-color)] transition-all duration-300 flex-shrink-0 z-10 relative">
                        <div className="absolute -inset-0.5 rounded-full bg-gradient-to-r from-[var(--accent-color)] to-emerald-500 opacity-0 group-hover:opacity-10 transition-opacity duration-300" />
                        <IconComp size={14} className="transition-transform duration-300 group-hover:scale-110" />
                      </div>

                      {/* Content Card */}
                      <div className="flex-1 bg-[var(--border-color)]/5 border border-[var(--border-color)]/20 group-hover:border-[var(--accent-color)]/20 group-hover:bg-[var(--border-color)]/10 p-3.5 rounded-xl transition-all duration-300 text-left">
                        <div className="flex items-center justify-between mb-1">
                          <h4 className="text-xs font-bold text-[var(--text-main)] group-hover:text-[var(--accent-color)] transition-colors duration-200">
                            {idx + 1}. {step.title}
                          </h4>
                          <span className="text-[7.5px] font-mono text-[var(--accent-color)] font-bold bg-[var(--accent-glow)] px-1.5 py-0.5 rounded uppercase tracking-wider border border-[var(--accent-color)]/20 shadow-sm">
                            STEP 0{idx + 1}
                          </span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] leading-relaxed font-normal">
                          {step.desc}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-3 bg-[var(--glass-surface)] border-t border-[var(--border-color)]/60 text-right">
                <button
                  onClick={() => setShowInfo(false)}
                  className="px-4 py-1.5 bg-[var(--border-color)]/15 border border-[var(--border-color)]/30 hover:border-[var(--accent-color)]/30 rounded-lg text-[10px] font-semibold text-[var(--text-main)] uppercase tracking-wider transition-all duration-300 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Home;
