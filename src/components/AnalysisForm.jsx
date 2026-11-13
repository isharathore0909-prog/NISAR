import React, { useState } from "react";
import { FolderOpen, Upload, CheckCircle2, X, Info, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const AnalysisForm = ({ onProcess }) => {
  const [file, setFile]               = useState(null);
  const [season, setSeason]           = useState("rabi");
  const [year, setYear]               = useState("2026-2027");
  const [outputFolder, setOutputFolder] = useState("");
  const [boundaryName, setBoundaryName] = useState("");
  const [analysisType, setAnalysisType] = useState("combined");
  const [isDragging, setIsDragging]   = useState(false);
  const [error, setError]             = useState("");
  const [warning, setWarning]         = useState("");

  const getValidYears = (sel) => {
    const valid = [];
    const today = new Date();
    const cur = today.getFullYear();
    for (let y = cur + 1; y >= 2015; y--) {
      const startMonth = sel === "rabi" ? 10 : sel === "kharif" ? 6 : 3;
      if (today >= new Date(y, startMonth - 1, 1)) valid.push(`${y}-${y + 1}`);
    }
    return valid;
  };

  const yearOptions = getValidYears(season);

  const handleFolderSelect = async () => {
    if (window.electron?.selectFolder) {
      const p = await window.electron.selectFolder();
      if (p) setOutputFolder(p);
    } else {
      alert("Folder selection is only available in the desktop app.");
    }
  };

  const validate = (sel, yr) => {
    setError(""); setWarning("");
    if (analysisType === "cropping_intensity") return true;
    const today = new Date();
    const [sy] = yr.split("-").map(Number);
    const cfg = {
      rabi:   { sm: 10, ey: sy + 1, em: 4 },
      kharif: { sm: 6,  ey: sy,     em: 10 },
      zaid:   { sm: 3,  ey: sy,     em: 6  },
    }[sel];
    const start = new Date(sy,     cfg.sm - 1, 1);
    const end   = new Date(cfg.ey, cfg.em, 0);
    if (today < start) { setError(`${sel.toUpperCase()} ${yr} has not started yet.`); return false; }
    if (today < end)   { setWarning("Season is active — using partial data."); }
    return true;
  };

  const handleSubmit = () => {
    if (!file)         return alert("Please upload a boundary file.");
    if (!outputFolder) return alert("Please select an output folder.");
    if (!validate(season, year)) return;
    onProcess({ file, season, year, outputFolder, boundaryName: boundaryName || "Unnamed AOI", analysis_type: analysisType });
  };

  return (
    <div className="w-full font-sans text-[var(--text-main)]">
      <div className="w-full bg-[var(--border-color)]/5 border border-[var(--border-color)]/80 rounded-2xl shadow-lg p-6 flex flex-col gap-6 backdrop-blur-xl">

        <div className="grid grid-cols-2 gap-8">

          {/* LEFT — Boundary file */}
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-xs font-bold text-[var(--text-main)] font-space uppercase tracking-wider mb-0.5">Boundary File</h3>
              <p className="text-[10.5px] text-[var(--text-muted)]">Upload the geographic area boundary</p>
            </div>

            <label
              className={`relative h-40 flex flex-col items-center justify-center border border-dashed rounded-xl cursor-pointer transition-all duration-200 group
                ${isDragging 
                  ? 'border-[var(--accent-color)] bg-[var(--accent-glow)]' 
                  : file 
                    ? 'border-[var(--accent-color)]/70 bg-[var(--accent-glow)]/30' 
                    : 'border-[var(--border-color)] hover:border-[var(--accent-color)]/50 hover:bg-[var(--border-color)]/10'}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); setFile(e.dataTransfer.files[0]); }}
            >
              <input type="file" className="hidden" onChange={e => e.target.files[0] && setFile(e.target.files[0])} />
              {!file ? (
                <div className="text-center flex flex-col items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[var(--bg-primary)]/60 border border-[var(--border-color)] flex items-center justify-center group-hover:bg-[var(--accent-glow)] group-hover:border-[var(--accent-color)] transition-all">
                    <Upload className="text-[var(--text-muted)] group-hover:text-[var(--accent-color)] w-3.5 h-3.5 transition-colors" />
                  </div>
                  <p className="text-xs font-bold text-[var(--text-main)]">Click or drag boundary file here</p>
                  <div className="flex gap-1.5 mt-0.5">
                    {['KML', 'KMZ', 'SHP', 'GeoJSON'].map(f => (
                      <span key={f} className="text-[8.5px] border border-[var(--border-color)] text-[var(--text-muted)] px-1.5 py-0.25 rounded font-mono font-medium">{f}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center flex flex-col items-center gap-1.5">
                  <div className="w-8 h-8 rounded-lg bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 flex items-center justify-center">
                    <CheckCircle2 className="text-[var(--accent-color)] w-4 h-4" />
                  </div>
                  <p className="text-xs font-bold text-[var(--text-main)] truncate max-w-[200px]">{file.name}</p>
                  <button
                    onClick={(e) => { e.preventDefault(); setFile(null); }}
                    className="text-[10px] text-[var(--text-muted)] hover:text-red-500 font-semibold transition-colors mt-0.5"
                  >
                    Remove File
                  </button>
                </div>
              )}
            </label>
          </div>

          {/* RIGHT — Season & year */}
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-xs font-bold text-[var(--text-main)] font-space uppercase tracking-wider mb-0.5">Analysis Period</h3>
              <p className="text-[10.5px] text-[var(--text-muted)]">Select target cropping season and year</p>
            </div>

            <div className="flex flex-col gap-3 pt-1">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-wider">Analysis Engine</label>
                <select
                  value={analysisType}
                  onChange={(e) => setAnalysisType(e.target.value)}
                  className="w-full bg-[var(--bg-primary)]/50 border border-[var(--border-color)] text-[var(--text-main)] text-xs h-10 px-3 rounded-lg outline-none focus:border-[var(--accent-color)] transition-all appearance-none cursor-pointer"
                >
                  <option value="combined" className="bg-[var(--card-bg)] text-[var(--text-main)]">Unified (Cropland + LULC)</option>
                  <option value="lulc" className="bg-[var(--card-bg)] text-[var(--text-main)]">LULC Refined Map</option>
                  <option value="cropping_intensity" className="bg-[var(--card-bg)] text-[var(--text-main)]">Cropping Intensity (Annual)</option>
                </select>
              </div>

              {analysisType !== "cropping_intensity" && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-wider">Season</label>
                  <select
                    value={season}
                    onChange={(e) => { setSeason(e.target.value); validate(e.target.value, year); }}
                    className="w-full bg-[var(--bg-primary)]/50 border border-[var(--border-color)] text-[var(--text-main)] text-xs h-10 px-3 rounded-lg outline-none focus:border-[var(--accent-color)] transition-all appearance-none cursor-pointer"
                  >
                    <option value="rabi" className="bg-[var(--card-bg)] text-[var(--text-main)]">Rabi — Winter (Oct–Apr)</option>
                    <option value="kharif" className="bg-[var(--card-bg)] text-[var(--text-main)]">Kharif — Monsoon (Jun–Oct)</option>
                    <option value="zaid" className="bg-[var(--card-bg)] text-[var(--text-main)]">Zaid — Summer (Mar–Jun)</option>
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-wider">Year</label>
                <select
                  value={year}
                  onChange={(e) => { setYear(e.target.value); validate(season, e.target.value); }}
                  className="w-full bg-[var(--bg-primary)]/50 border border-[var(--border-color)] text-[var(--text-main)] text-xs h-10 px-3 rounded-lg outline-none focus:border-[var(--accent-color)] transition-all appearance-none cursor-pointer"
                >
                  {yearOptions.map(y => <option key={y} value={y} className="bg-[var(--card-bg)] text-[var(--text-main)]">{y}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Output configuration + submit */}
        <div className="grid grid-cols-2 gap-8 pt-5 border-t border-[var(--border-color)]/60">

          {/* Output config */}
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="text-xs font-bold text-[var(--text-main)] font-space uppercase tracking-wider mb-0.5">Output Settings</h3>
              <p className="text-[10.5px] text-[var(--text-muted)]">Set destination file configs</p>
            </div>

            <div className="flex flex-col gap-2.5">
              <div className="flex h-10 items-center gap-2 bg-[var(--bg-primary)]/50 border border-[var(--border-color)] rounded-lg px-3 focus-within:border-[var(--accent-color)] transition-all">
                <input
                  type="text"
                  value={boundaryName}
                  onChange={(e) => setBoundaryName(e.target.value)}
                  placeholder="Area boundary name (e.g. Ajmer block)"
                  className="w-full bg-transparent text-xs text-[var(--text-main)] outline-none placeholder:text-[var(--text-muted)]"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1 flex h-10 items-center gap-2 bg-[var(--bg-primary)]/50 border border-[var(--border-color)] rounded-lg px-3 overflow-hidden">
                  <FolderOpen className="w-3.5 h-3.5 text-[var(--text-muted)] flex-none" />
                  <span className={`text-xs truncate ${outputFolder ? 'text-[var(--text-main)]' : 'text-[var(--text-muted)]'}`}>
                    {outputFolder || "Select output workspace folder"}
                  </span>
                </div>
                <button
                  onClick={handleFolderSelect}
                  className="w-10 h-10 flex items-center justify-center bg-[var(--border-color)]/20 border border-[var(--border-color)] hover:border-[var(--accent-color)]/40 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="flex flex-col justify-end">
            <button
              onClick={handleSubmit}
              className="btn-primary w-full h-20 rounded-xl flex flex-col items-center justify-center gap-1 cursor-pointer"
            >
              <span className="text-xs font-extrabold uppercase tracking-wider flex items-center gap-2">
                Initialize Data Processing
                <ArrowRight size={13} className="stroke-[2.5px]" />
              </span>
              <span className="text-[9px] opacity-90 font-medium tracking-wide normal-case font-sans">
                Downloads raw Sentinel datasets and extracts agriculture masks
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Error / warning toast */}
      <AnimatePresence>
        {(error || warning) && (
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm"
          >
            <div className="p-3.5 rounded-xl border flex items-start gap-3 bg-[var(--card-bg)] shadow-2xl border-[var(--border-color)]">
              <div className={`w-6 h-6 rounded flex items-center justify-center flex-none mt-0.5
                ${error ? 'bg-red-950/20 text-red-500 border border-red-900/20' : 'bg-amber-950/20 text-amber-500 border border-amber-900/20'}`}>
                <Info size={13} />
              </div>
              <p className="text-xs text-[var(--text-main)] font-medium flex-1">{error || warning}</p>
              <button onClick={() => { setError(""); setWarning(""); }} className="text-[var(--text-muted)] hover:text-[var(--text-main)] flex-none cursor-pointer">
                <X size={13} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AnalysisForm;
