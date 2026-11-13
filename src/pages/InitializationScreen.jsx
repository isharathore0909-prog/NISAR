import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, RefreshCw, Radio, Cpu, Layers, Zap, ShieldCheck, Globe,
  Sun, Moon
} from "lucide-react";

// Software Logo matching Home page header
const PremiumLogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--accent-color)]">
    <path d="M12 2L21 6.5V17.5L12 22L3 17.5V6.5L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 2.5" />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" className="animate-pulse" />
    <path d="M12 2V6M12 18V22M3 12H7M17 12H21" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
  </svg>
);

const validationItems = [
  { id: 1, label: "System Memory Check", desc: "Verifying RAM allocation: Minimum 8 GB required", icon: Cpu },
  { id: 2, label: "CPU Core Capacity", desc: "Checking multi-threaded processor availability", icon: Layers },
  { id: 3, label: "GPU Acceleration Handshake", desc: "Locating dedicated hardware graphics pipeline", icon: Zap },
  { id: 4, label: "Encrypted Sandbox Workspace", desc: "Establishing secure token-authenticated session environment", icon: ShieldCheck },
  { id: 5, label: "Geospatial Core Graphics Ready", desc: "Binding WebGL and standard rendering engines", icon: Globe }
];

const FuturisticLoader = ({ progress }) => {
  return (
    <div className="flex flex-col items-center justify-center gap-6">
      {/* Circle Loader Container */}
      <div className="relative w-40 h-40 flex items-center justify-center">
        {/* Outer Ring - Slow rotation */}
        <div className="absolute inset-0 rounded-full border-2 border-dashed border-[var(--accent-color)]/20 animate-[spin_20s_linear_infinite]" />
        
        {/* Middle Ring - Faster counter-rotation */}
        <div className="absolute inset-2 rounded-full border-2 border-dotted border-[var(--accent-color)]/40 animate-[spin_10s_linear_infinite_reverse]" />
        
        {/* Inner Ring - Glowing, animated with progress stroke */}
        <svg className="absolute inset-0 w-full h-full transform -rotate-90">
          <circle
            cx="80"
            cy="80"
            r="70"
            className="stroke-[var(--border-color)]/30"
            strokeWidth="3"
            fill="transparent"
          />
          <circle
            cx="80"
            cy="80"
            r="70"
            className="stroke-[var(--accent-color)] transition-all duration-200"
            strokeWidth="4"
            fill="transparent"
            strokeDasharray={2 * Math.PI * 70}
            strokeDashoffset={2 * Math.PI * 70 * (1 - progress / 100)}
            strokeLinecap="round"
          />
        </svg>

        {/* Center content: Percentage & Glowing Core */}
        <div className="flex flex-col items-center justify-center z-10">
          <span className="text-3xl font-extrabold font-space text-[var(--text-main)] tracking-wider">
            {progress}%
          </span>
          <span className="text-[8px] font-mono text-[var(--accent-color)] uppercase tracking-widest mt-1 font-bold animate-pulse">
            LOADING
          </span>
        </div>
      </div>

      {/* Subtitle */}
      <div className="flex flex-col items-center gap-2">
        <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-[0.2em] font-bold text-center max-w-xs leading-relaxed animate-pulse">
          {progress < 25 ? "Verifying local environments..." :
           progress < 50 ? "Establishing satellite link..." :
           progress < 75 ? "Allocating graphics sandbox..." :
           "Pre-initializing components..."}
        </span>
        <div className="flex gap-1.5 mt-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-bounce" style={{ animationDelay: '0s' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-bounce" style={{ animationDelay: '0.2s' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-bounce" style={{ animationDelay: '0.4s' }} />
        </div>
      </div>
    </div>
  );
};

const InitializationScreen = () => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const [liveTime, setLiveTime] = useState("");
  const [theme, setTheme] = useState("dark");
  const [isCompleted, setIsCompleted] = useState(false);

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

  // Clock ticks
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

  // Boot progress sequence: ~5 seconds total
  useEffect(() => {
    const totalDuration = 5000;
    const intervalTime = 50;
    const totalSteps = totalDuration / intervalTime;
    let stepCount = 0;

    const bootTimer = setInterval(() => {
      stepCount++;
      const currentProgress = Math.min(100, Math.round((stepCount / totalSteps) * 100));
      setProgress(currentProgress);

      if (currentProgress >= 100) {
        clearInterval(bootTimer);
        setIsCompleted(true);
      }
    }, intervalTime);

    return () => clearInterval(bootTimer);
  }, []);

  // Auto-switch to dashboard when initialization completes
  useEffect(() => {
    if (isCompleted) {
      const timeout = setTimeout(() => {
        navigate("/dashboard");
      }, 1500); // 1.5 seconds delay to show the success badge
      return () => clearTimeout(timeout);
    }
  }, [isCompleted, navigate]);

  return (
    <div className={`h-screen w-screen font-sans flex flex-col overflow-hidden relative select-none theme-${theme} bg-[var(--bg-primary)] text-[var(--text-main)] transition-colors duration-500`}>
      <style>{`
        .bg-grid-pattern {
          background-image: 
            linear-gradient(var(--grid-color) 1px, transparent 1px),
            linear-gradient(90deg, var(--grid-color) 1px, transparent 1px);
          background-size: 40px 40px;
        }
      `}</style>

      {/* Dynamic Theme Gradients */}
      <div className="absolute inset-0 bg-gradient-to-br from-[var(--bg-primary)] via-[var(--bg-secondary)] to-[var(--bg-primary)] opacity-85 z-0 transition-colors duration-500" />
      <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none z-0" />

      {/* Theme-aware Ambient Glow Effects */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[var(--accent-glow)] rounded-full blur-3xl opacity-30 pointer-events-none z-0" />
      <div className={`absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl opacity-20 pointer-events-none z-0 ${theme === 'dark' ? 'bg-cyan-500/10' : 'bg-cyan-600/5'}`} />

      {/* ── TOP HEADER BAR (Matched to Home Screen Header) ────────────────────────── */}
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

        {/* Center label */}
        <div className="hidden md:flex items-center gap-2 text-[9px] font-mono text-[var(--accent-color)] font-bold bg-[var(--accent-glow)] px-3 py-0.75 rounded-full border border-[var(--accent-color)]/20 animate-pulse">
          <Radio size={10} className="text-[var(--accent-color)]" />
          <span>SECURE SYSTEM VALIDATION ACTIVE</span>
        </div>

        {/* Right Clock & Theme */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:block text-[10px] font-mono text-[var(--text-muted)] border-l border-[var(--border-color)]/30 pl-4 py-1 select-none">
            {liveTime}
          </div>
          
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg border border-[var(--border-color)]/30 hover:border-[var(--accent-color)]/30 bg-[var(--border-color)]/5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all cursor-pointer flex items-center justify-center"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={13} className="text-amber-500" /> : <Moon size={13} className="text-sky-600" />}
          </button>
        </div>
      </header>

      {/* ── MAIN WORKSPACE CONTAINER (Centered Screen Layout) ── */}
      <main className="flex-1 flex items-center justify-center p-6 z-10 relative">
        <AnimatePresence mode="wait">
          {progress <= 50 ? (
            <motion.div
              key="loader-phase"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col items-center justify-center relative z-20"
            >
              <FuturisticLoader progress={progress * 2} />
            </motion.div>
          ) : (
            <motion.div
              key="checklist-phase"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="w-full max-w-xl bg-[var(--glass-surface)] border border-[var(--border-color)] rounded-2xl p-6 md:p-8 shadow-2xl relative overflow-hidden backdrop-blur-md z-20"
            >
              {/* Subtle background card glows */}
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-[var(--accent-glow)] rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

              {/* Heading Section */}
              <div className="text-left mb-6 border-b border-[var(--border-color)]/20 pb-4">
                <span className="text-[9px] font-mono text-[var(--accent-color)] uppercase tracking-[0.25em] font-bold block mb-1">
                  Rajasthan State Agriculture Intelligence Management System
                </span>
                <h2 className="text-xl md:text-2xl font-bold font-space text-[var(--text-main)] tracking-wider uppercase">
                  SYSTEM READINESS CHECK
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-1.5 leading-relaxed font-normal">
                  Validating system resources and graphics configurations before launching workspace.
                </p>
              </div>

              {/* Checking Steps (Vertical Stepper Layout) */}
              <div className="relative pl-2 space-y-5">
                {/* Stepper Vertical Connector Line */}
                <div className="absolute left-[17px] top-4 bottom-4 w-[2px] bg-[var(--border-color)]/20 z-0" />

                {validationItems.map((item, idx) => {
                  // Map progress (51% to 100%) to item states
                  // items verify at 60%, 70%, 80%, 90%, 100%
                  const isItemVerified = progress >= 50 + (idx + 1) * 10;
                  const isItemScanning = progress >= 50 + idx * 10 && progress < 50 + (idx + 1) * 10;
                  const isQueued = progress < 50 + idx * 10;

                  const ItemIcon = item.icon;

                  return (
                    <motion.div
                      key={item.id}
                      layout
                      className={`relative z-10 flex items-start gap-5 transition-all duration-300
                        ${isQueued ? 'opacity-40' : 'opacity-100'}`}
                    >
                      {/* Step Circle/Icon */}
                      <div className={`flex-none w-9 h-9 rounded-full flex items-center justify-center border transition-all duration-300
                        ${isItemVerified
                          ? 'bg-[var(--accent-color)]/10 border-[var(--accent-color)] text-[var(--accent-color)] shadow-[0_0_10px_var(--accent-glow)]'
                          : isItemScanning
                            ? (theme === 'dark' 
                                ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400 animate-pulse shadow-[0_0_10px_rgba(6,182,212,0.2)]' 
                                : 'bg-cyan-50/80 border-cyan-600 text-cyan-600 animate-pulse shadow-[0_0_10px_rgba(6,182,212,0.1)]')
                            : 'bg-[var(--bg-primary)] border-[var(--border-color)]/50 text-[var(--text-muted)]'}`}
                      >
                        {isItemVerified ? (
                          <CheckCircle2 size={16} className="stroke-[2.5px]" />
                        ) : isItemScanning ? (
                          <RefreshCw size={14} className="animate-spin" />
                        ) : (
                          <ItemIcon size={14} />
                        )}
                      </div>

                      {/* Step Info */}
                      <div className="flex-1 min-w-0 text-left pt-0.5">
                        <div className="flex items-center gap-2.5">
                          <span className={`text-xs md:text-sm font-bold tracking-wide transition-colors duration-300
                            ${isItemVerified 
                              ? 'text-[var(--text-main)]' 
                              : isItemScanning 
                                ? (theme === 'dark' ? 'text-cyan-400 font-extrabold' : 'text-cyan-600 font-extrabold') 
                                : 'text-[var(--text-muted)]'}`}>
                            {item.label}
                          </span>
                          <span className={`text-[8px] font-mono uppercase tracking-wider font-extrabold px-1.5 py-0.25 rounded transition-all duration-300
                            ${isItemVerified
                              ? 'bg-[var(--accent-color)]/10 text-[var(--accent-color)] border border-[var(--accent-color)]/25'
                              : isItemScanning
                                ? (theme === 'dark' 
                                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/25 animate-pulse' 
                                    : 'bg-cyan-100/60 text-cyan-700 border border-cyan-300/40 animate-pulse')
                                : 'bg-[var(--border-color)]/10 text-[var(--text-muted)] border border-transparent'}`}>
                            {isItemVerified ? 'Verified' : isItemScanning ? 'Scanning...' : 'Queued'}
                          </span>
                        </div>
                        <span className="text-[10.5px] text-[var(--text-muted)] block mt-1 font-normal leading-normal">
                          {item.desc}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Success Banner inside the card when complete */}
              {isCompleted && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-5 p-3 bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/30 rounded-xl text-center flex items-center justify-center gap-2"
                >
                  <CheckCircle2 size={15} className="text-[var(--accent-color)] animate-bounce" />
                  <span className="text-[10px] font-bold text-[var(--accent-color)] font-space tracking-wider uppercase">
                    System Boot Successful. Diverting to Workspace...
                  </span>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

export default InitializationScreen;
