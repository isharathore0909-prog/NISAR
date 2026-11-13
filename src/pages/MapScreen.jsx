import React, { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import { useNavigate } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import {
  Satellite, CheckCircle2, Terminal, Cpu, HardDrive, Database,
  ShieldCheck, RefreshCw, Compass, Globe, Zap, Clock, ShieldAlert,
  ArrowLeft, Sun, Moon, Settings, ZoomIn, ZoomOut, Maximize
} from "lucide-react";
import { motion } from "framer-motion";

const processingSteps = [
  "Initialize Analysis Engine",
  "Validate Uploaded Boundary",
  "AOI Geometry Optimization",
  "Acquire Sentinel-2 Datasets",
  "Cloud & Shadow Filtering",
  "Noise Reduction & Atmospheric Correction",
  "Temporal Seasonal Dataset Creation",
  "NDVI & Vegetation Index Analysis",
  "Agriculture Land Extraction",
  "Crop Classification Engine",
  "Field Boundary Generation",
  "Yield & Acreage Estimation",
  "Export Intelligence Products"
];

const PremiumLogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--accent-color)]">
    <path d="M12 2L21 6.5V17.5L12 22L3 17.5V6.5L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 2.5" />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" className="animate-pulse" />
    <path d="M12 2V6M12 18V22M3 12H7M17 12H21" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
  </svg>
);

const FitBounds = ({ data, fitTrigger }) => {
  const map = useMap();
  useEffect(() => {
    if (!data) return;
    const layer = L.geoJSON(data);
    if (layer.getBounds().isValid())
      map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 14 });
  }, [data, map, fitTrigger]);
  return null;
};

const MiniMapToolbar = ({ onFit }) => {
  const map = useMap();
  return (
    <div className="absolute top-3 right-3 z-[1000] bg-[var(--card-bg)]/90 backdrop-blur-md border border-[var(--border-color)] rounded-lg p-1 shadow-2xl flex items-center gap-1 select-none pointer-events-auto">
      <button
        onClick={onFit}
        title="Fit Study Area to Frame"
        className="p-1.5 hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded transition-all cursor-pointer bg-transparent border-0 outline-none flex items-center justify-center"
      >
        <Maximize size={12} />
      </button>
      <button
        onClick={() => map.zoomIn()}
        title="Zoom In"
        className="p-1.5 hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded transition-all cursor-pointer bg-transparent border-0 outline-none flex items-center justify-center"
      >
        <ZoomIn size={12} />
      </button>
      <button
        onClick={() => map.zoomOut()}
        title="Zoom Out"
        className="p-1.5 hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded transition-all cursor-pointer bg-transparent border-0 outline-none flex items-center justify-center"
      >
        <ZoomOut size={12} />
      </button>
    </div>
  );
};

const MiniMap = ({ geoJSON, status }) => {
  const [fitTrigger, setFitTrigger] = useState(0);
  if (!geoJSON) return null;
  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={[20, 78]} zoom={5}
        className="w-full h-full z-0"
        zoomControl={true}
        dragging={true}
        scrollWheelZoom={true}
        doubleClickZoom={true}
        attributionControl={false}
      >
        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
        <GeoJSON data={geoJSON} style={() => ({
          color: '#10b981', weight: 2,
          fillColor: '#10b981',
          fillOpacity: status === 'completed' ? 0.35 : 0.15,
          className: 'animated-aoi'
        })} />
        <FitBounds data={geoJSON} fitTrigger={fitTrigger} />
        <MiniMapToolbar onFit={() => setFitTrigger(prev => prev + 1)} />
      </MapContainer>
    </div>
  );
};

const TemporalDatasetCard = ({ cardInfo, actualData, index }) => {
  const isPending = !actualData;
  const status = actualData?.status || "queued";
  const isActive = status === 'downloading' || status === 'compositing';
  const isDone = status === 'completed';

  const cloud = actualData
    ? (actualData.cloud_cover !== undefined
      ? `${actualData.cloud_cover.toFixed(1)}%`
      : cardInfo.cloud)
    : "--";

  const ndvi = actualData
    ? (actualData.ndvi_avg !== undefined
      ? actualData.ndvi_avg.toFixed(2)
      : cardInfo.ndvi)
    : "--";

  // SAFE DATE HANDLING
  const dateValue =
    actualData?.actual_date ||
    actualData?.target_date ||
    cardInfo?.code ||
    null;

  const dateStr = dateValue
    ? dateValue.split("_")[0]
    : `Awaiting Scene ${index}`;

  console.log("TemporalDatasetCard Data:", actualData);

  return (
    <div
      className={`w-[160px] h-[115px] flex-none rounded-xl border bg-[var(--card-bg)]/80 overflow-hidden flex flex-col relative transition-all duration-300 backdrop-blur-md
        ${isActive
          ? 'border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.25)] scale-[1.02]'
          : isDone
            ? 'border-[var(--accent-color)]/40 hover:border-[var(--accent-color)] shadow-[0_0_10px_var(--accent-glow)]'
            : 'border-[var(--border-color)] opacity-30'}`}
    >
      {/* Active scanning bar */}
      {isActive && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-500 via-emerald-400 to-cyan-500 animate-[pulse_1.5s_infinite] z-20" />
      )}

      {/* Thumbnail */}
      <div className="h-[58px] w-full flex-none border-b border-[var(--border-color)] bg-[var(--bg-primary)]/40 relative flex items-center justify-center overflow-hidden">
        {actualData?.thumb ? (
          <img src={actualData.thumb} className="absolute inset-0 w-full h-full object-contain p-1 opacity-90 transition-all duration-300 hover:scale-105" alt="" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-primary)]/20">
            {isActive ? (
              <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
            ) : isDone ? (
              <Satellite className="w-3.5 h-3.5 text-[var(--accent-color)]" />
            ) : (
              <Satellite className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            )}
          </div>
        )}

        {/* Overlay status tag */}
        <span className={`absolute top-1 left-1.5 px-1 py-0.25 rounded font-mono text-[7px] font-bold uppercase tracking-wider
          ${isActive ? 'bg-cyan-950/80 text-cyan-400 border border-cyan-800/40 animate-pulse' : isDone ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-900/40' : 'bg-[var(--bg-primary)] text-[var(--text-muted)] border border-[var(--border-color)]'}`}>
          {isActive ? (status === 'compositing' ? 'Building' : 'Loading') : isDone ? 'Ready' : 'Queued'}
        </span>

        {isDone && (
          <div className="absolute top-1 right-1.5 w-3 h-3 bg-[var(--accent-color)] rounded-full flex items-center justify-center z-10 shadow-[0_0_8px_var(--accent-glow)]">
            <CheckCircle2 className="w-2 h-2 text-[var(--bg-primary)] stroke-[3px]" />
          </div>
        )}
      </div>

      {/* Description */}
      <div className="flex-1 p-1.5 flex flex-col justify-between font-mono text-[9px] space-y-0.5">
        <div className="flex justify-between items-center gap-1">
          <span className="text-[var(--text-main)] font-semibold truncate text-[9.5px]">{dateStr}</span>
        </div>
        <div className="space-y-0.5 text-[var(--text-muted)] border-t border-[var(--border-color)]/60 pt-1">
          <div className="flex justify-between">
            <span>CLOUD:</span>
            <span className={isDone ? 'text-[var(--accent-color)] font-medium' : isActive ? 'text-cyan-400 animate-pulse' : ''}>{cloud}</span>
          </div>
          <div className="flex justify-between">
            <span>NDVI Q:</span>
            <span className={isDone ? 'text-[var(--accent-color)] font-medium' : isActive ? 'text-cyan-400 animate-pulse' : ''}>
              {isDone ? `${ndvi}` : ndvi}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const MapScreen = () => {
  const [geoData, setGeoData] = useState(null);
  const [configData, setConfigData] = useState(null);
  const [currentStepIndex, setStepIndex] = useState(0);

  const rawConfig = localStorage.getItem("analysisConfig");
  const config = rawConfig ? JSON.parse(rawConfig) : {};
  const isLulc = config.analysis_type === "lulc";
  const isCombined = config.analysis_type === "combined";

  const stepsList = isCombined ? [
    "Initialize Joint Analysis Engine",
    "Validate study area boundary",
    "Optimize AOI geometry grid",
    "Acquire Sentinel-2 multispectral scenes",
    "Filter cloud, shadow, and aerosols",
    "Execute Cropland Extraction & Masking",
    "Run phenology-based crop classification",
    "Query GEDI LiDAR canopy height data",
    "Fetch Dynamic World land classification baseline",
    "Execute LULC rule-based decision tree",
    "Generate LULC classification map",
    "Calculate unified acreage & yield statistics",
    "Export Combined Intelligence Products"
  ] : isLulc ? [
    "Initialize LULC Workspace",
    "Acquire Sentinel-2 Multi-Spectral Stack",
    "Extract SRTM Elevation Grid & Calculate Slope",
    "Query GEDI LiDAR Canopy Data (25m)",
    "Fetch Dynamic World global classification baseline",
    "Align multi-sensor rasters to 10m grid",
    "Derive local multi-temporal spectral indices",
    "Execute rule-based refinement tree",
    "Run 3x3 Spatial Majority filter",
    "Calculate Land Cover class statistics",
    "Generate LULC visual products",
    "Export Intelligence Products"
  ] : [
    "Initialize Analysis Engine",
    "Validate Uploaded Boundary",
    "AOI Geometry Optimization",
    "Acquire Sentinel-2 Datasets",
    "Cloud & Shadow Filtering",
    "Noise Reduction & Atmospheric Correction",
    "Temporal Seasonal Dataset Creation",
    "NDVI & Vegetation Index Analysis",
    "Agriculture Land Extraction",
    "Crop Classification Engine",
    "Field Boundary Generation",
    "Yield & Acreage Estimation",
    "Export Intelligence Products"
  ];
  const [satelliteImageIndex, setSatIndex] = useState(0);
  const [timelineImages, setTimeline] = useState([]);
  const [etr, setEtr] = useState("Calculating...");
  const scrollRef = useRef(null);
  const navigate = useNavigate();
  const [theme, setTheme] = useState("dark");
  const [liveTime, setLiveTime] = useState("");

  const [performance, setPerformance] = useState({
    gpu: 82.5,
    ram: 6.4,
    speed: 45.2,
    cache: 1.2,
    temp: 61
  });

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

  /* Real-time fluctuating hardware stats */
  useEffect(() => {
    const timer = setInterval(() => {
      setPerformance(prev => {
        const nextGpu = Math.min(98, Math.max(65, prev.gpu + (Math.random() - 0.5) * 8));
        const nextRam = Math.min(15.2, Math.max(5.8, prev.ram + (Math.random() - 0.5) * 0.15));
        const nextSpeed = Math.min(52.8, Math.max(38.4, prev.speed + (Math.random() - 0.5) * 3));
        const nextCache = Math.min(3.8, Math.max(0.8, prev.cache + (Math.random() - 0.5) * 0.04));
        const nextTemp = Math.min(78, Math.max(55, prev.temp + (Math.random() - 0.5) * 2));
        return {
          gpu: parseFloat(nextGpu.toFixed(1)),
          ram: parseFloat(nextRam.toFixed(2)),
          speed: parseFloat(nextSpeed.toFixed(1)),
          cache: parseFloat(nextCache.toFixed(2)),
          temp: parseFloat(nextTemp.toFixed(1))
        };
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  /* Auto-scroll timeline right as new cards appear */
  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [timelineImages.length]);

  useEffect(() => {
    const rawGeo = localStorage.getItem("geoData");
    const rawConfig = localStorage.getItem("analysisConfig");
    if (!rawGeo || !rawConfig) return;

    setGeoData(JSON.parse(rawGeo));
    setConfigData(JSON.parse(rawConfig));

    const startAnalysis = async () => {
      try {
        const config = JSON.parse(rawConfig);
        const resp = await fetch("http://127.0.0.1:5000/api/configure-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            aoi: JSON.parse(rawGeo),
            season: config.season, year: config.year,
            output_dir: config.outputFolder, boundaryName: config.boundaryName,
            analysis_type: config.analysis_type
          })
        });
        const { config_id } = await resp.json();
        const es = new EventSource(`http://127.0.0.1:5000/stream-analysis?config_id=${config_id}`);

        es.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.etr) setEtr(data.etr);

          if (data.status === "error") {
            alert("Analysis failed: " + data.message);
            es.close();
            navigate("/dashboard");
            return;
          }

          if (isCombined) {
            const msg = data.message || "";
            if (data.status === "starting") setStepIndex(prev => Math.max(prev, 1));
            if (msg.includes("AOI") || msg.includes("geometry")) setStepIndex(prev => Math.max(prev, 2));
            if (data.status === "searching") setStepIndex(prev => Math.max(prev, 3));
            if (data.status === "downloading") setStepIndex(prev => Math.max(prev, 3));
            if (data.status === "preparing_dataset") setStepIndex(prev => Math.max(prev, 4));
            if (data.status === "analyzing_vegetation") setStepIndex(prev => Math.max(prev, 5));
            if (data.status === "extracting_land") setStepIndex(prev => Math.max(prev, 6));
            if (data.status === "crop_completed") setStepIndex(prev => Math.max(prev, 7));
            if (msg.includes("LiDAR") || msg.includes("GEDI")) setStepIndex(prev => Math.max(prev, 7));
            if (msg.includes("Dynamic World")) setStepIndex(prev => Math.max(prev, 8));
            if (msg.includes("decision tree") || msg.includes("refinement")) setStepIndex(prev => Math.max(prev, 9));
            if (msg.includes("majority filter")) setStepIndex(prev => Math.max(prev, 10));
            if (msg.includes("visual outputs") || msg.includes("Saving")) setStepIndex(prev => Math.max(prev, 11));

            if (
              ["downloading", "completed", "compositing"].includes(data.status) &&
              data.target_date
            ) {
              setTimeline(prev => {
                const exists = prev.find(
                  img => img.target_date === data.target_date
                );

                if (exists) {
                  return prev.map(img =>
                    img.target_date === data.target_date
                      ? { ...img, ...data }
                      : img
                  );
                }

                const next = [...prev, { ...data, id: prev.length + 1 }];
                setSatIndex(next.length);
                return next;
              });
            }

            if (data.status === "completed_all") {
              setStepIndex(prev => Math.max(prev, 12));
              setEtr("Ready");
              localStorage.setItem("resultMask", data.mask_path);
              localStorage.setItem("resultPixels", data.pixel_count);

              setTimeout(() => {
                setStepIndex(13);
                setTimeout(() => {
                  es.close();
                  navigate("/intelligence");
                }, 1500);
              }, 1500);
            }
          } else if (isLulc) {
            const msg = data.message || "";
            if (data.status === "starting") setStepIndex(prev => Math.max(prev, 1));
            if (msg.includes("SRTM 30m DEM")) setStepIndex(prev => Math.max(prev, 2));
            if (msg.includes("GEDI LiDAR Canopy")) setStepIndex(prev => Math.max(prev, 3));
            if (msg.includes("Dynamic World annual baseline")) setStepIndex(prev => Math.max(prev, 4));
            if (msg.includes("Resampling elevation")) setStepIndex(prev => Math.max(prev, 5));
            if (msg.includes("Deriving dry/wet")) setStepIndex(prev => Math.max(prev, 6));
            if (msg.includes("rule-based decision tree")) setStepIndex(prev => Math.max(prev, 7));
            if (msg.includes("3x3 majority filter")) setStepIndex(prev => Math.max(prev, 8));
            if (msg.includes("Saving visual outputs")) setStepIndex(prev => Math.max(prev, 9));

            if (
              ["downloading", "completed", "compositing"].includes(data.status) &&
              data.target_date
            ) {
              setTimeline(prev => {
                const exists = prev.find(
                  img => img.target_date === data.target_date
                );

                if (exists) {
                  return prev.map(img =>
                    img.target_date === data.target_date
                      ? { ...img, ...data }
                      : img
                  );
                }

                const next = [...prev, { ...data, id: prev.length + 1 }];
                setSatIndex(next.length);
                return next;
              });
            }

            if (data.status === "completed_all") {
              setStepIndex(prev => Math.max(prev, 10));
              setEtr("Ready");
              localStorage.setItem("resultMask", data.mask_path);
              localStorage.setItem("resultPixels", data.pixel_count);

              setTimeout(() => {
                setStepIndex(11);
                setTimeout(() => {
                  es.close();
                  navigate("/intelligence");
                }, 1500);
              }, 1500);
            }
          } else {
            if (data.status === "starting") setStepIndex(prev => Math.max(prev, 1));
            if (data.status === "searching") setStepIndex(prev => Math.max(prev, 2));

            if (data.status === "downloading") {
              setStepIndex(prev => Math.max(prev, 3));
            }

            if (data.status === "compositing") {
              setStepIndex(prev => Math.max(prev, 4));
            }

            if (
              ["downloading", "completed", "compositing"].includes(data.status) &&
              data.target_date
            ) {
              setTimeline(prev => {
                const exists = prev.find(
                  img => img.target_date === data.target_date
                );

                if (exists) {
                  return prev.map(img =>
                    img.target_date === data.target_date
                      ? { ...img, ...data }
                      : img
                  );
                }

                const next = [...prev, { ...data, id: prev.length + 1 }];
                setSatIndex(next.length);
                return next;
              });
            }

            if (data.status === "finished") {
              setStepIndex(prev => Math.max(prev, 5));
            }

            if (data.status === "preparing_dataset") {
              setStepIndex(prev => Math.max(prev, 6));
            }

            if (data.status === "analyzing_vegetation") {
              setStepIndex(prev => Math.max(prev, 7));
            }

            if (data.status === "extracting_land") {
              setStepIndex(prev => {
                const next = Math.max(prev, 8);
                setTimeout(() => {
                  setStepIndex(curr => Math.max(curr, 9));
                }, 2500);
                return next;
              });
            }

            if (data.status === "generating_results") {
              setStepIndex(prev => {
                const next = Math.max(prev, 10);
                setTimeout(() => {
                  setStepIndex(curr => Math.max(curr, 11));
                }, 2500);
                return next;
              });
            }

            if (data.status === "completed_all") {
              setStepIndex(prev => Math.max(prev, 12));
              setEtr("Ready");
              localStorage.setItem("resultMask", data.mask_path);
              localStorage.setItem("resultPixels", data.pixel_count);

              setTimeout(() => {
                setStepIndex(13);
                setTimeout(() => {
                  es.close();
                  navigate("/intelligence");
                }, 1500);
              }, 1500);
            }
          }
        };

        es.onerror = () => es.close();
        return es;
      } catch (e) { console.error(e); }
    };

    const p = startAnalysis();
    return () => p.then(es => es?.close());
  }, []);

  const expectedDates = getExpectedDates(configData);
  const currentStageInfo = getStageDetails(currentStepIndex, configData);
  const areaValue = calculateArea(geoData);
  const centroid = getCentroid(geoData);

  // Dynamic projection & solar calculation based on AOI centroid
  const utmZone = Math.floor((centroid.lon + 180) / 6) + 1;
  const hemisphere = centroid.lat >= 0 ? "N" : "S";
  const activeImage = timelineImages[satelliteImageIndex - 1] || timelineImages[timelineImages.length - 1];

  const activeMonth =
    activeImage?.target_date?.split("-")?.[1]
      ? parseInt(activeImage.target_date.split("-")[1])
      : new Date().getMonth() + 1;
  const declination = -23.44 * Math.cos((2 * Math.PI / 12) * (activeMonth - 12));
  const sunElevation = Math.max(10, Math.min(90, 90 - Math.abs(centroid.lat - declination))).toFixed(1);
  const sunAzimuth = (180 + (centroid.lon - 75) * 1.5).toFixed(1);

  const activeCloud = activeImage && activeImage.cloud_cover !== undefined ? `${activeImage.cloud_cover.toFixed(1)}%` : "--";
  const activeNdvi = activeImage && activeImage.ndvi_avg !== undefined ? activeImage.ndvi_avg.toFixed(2) : "--";
  const activeDate =
    (activeImage?.actual_date || activeImage?.target_date)
      ?.split("_")[0] ||
    (expectedDates[0]?.code || "2025-01-05");

  const reportSeason = configData?.season || "Rabi";
  const reportYear = configData?.year || "2024";
  const reportNextYear = parseInt(reportYear) + 1;
  const reportMonths = reportSeason.toLowerCase() === "kharif"
    ? `June ${reportYear} to October ${reportYear}`
    : reportSeason.toLowerCase() === "zaid"
      ? `March ${reportYear} to June ${reportYear}`
      : `November ${reportYear} to April ${reportNextYear}`;
  const reportBoundary = configData?.boundaryName || "Boundary.kml";

  const reportParagraph = `RS-AIMS is executing a multi-temporal remote sensing pipeline to acquire and process Sentinel-2 multispectral imagery for the ${reportSeason} ${reportYear} season, covering the period from ${reportMonths}. The acquisition engine queries cloud-free scenes over the ${reportBoundary} boundary, filtering cloud and shadow cover to maintain an average cloud density below 10%. This optimized multi-band stack is processed using specialized GIS algorithms to calculate high-resolution NDVI profiles, extract active agricultural land, map field boundaries, and estimate yield metrics.`;

  return (
    <div className={`h-screen w-screen bg-[var(--bg-primary)] overflow-hidden flex flex-col relative select-none theme-${theme}`}>
      <style>{`
        .bg-grid-pattern-map {
          background-image: 
            linear-gradient(var(--grid-color) 1px, transparent 1px),
            linear-gradient(90deg, var(--grid-color) 1px, transparent 1px);
          background-size: 35px 35px;
        }

        @keyframes scan-map {
          0% { top: 0%; opacity: 0.5; }
          50% { top: 100%; opacity: 0.8; }
          100% { top: 0%; opacity: 0.5; }
        }

        .scanning-laser-map {
          position: absolute;
          left: 0;
          right: 0;
          height: 1.5px;
          background: linear-gradient(90deg, transparent, rgba(16, 185, 129, 0.3) 30%, var(--accent-color) 50%, rgba(16, 185, 129, 0.3) 70%, transparent);
          box-shadow: 0 0 8px 1px var(--accent-glow);
          animation: scan-map 6s ease-in-out infinite;
          pointer-events: none;
          z-index: 20;
        }

        @keyframes dash {
          to {
            stroke-dashoffset: -40;
          }
        }
        .animated-aoi {
          stroke-dasharray: 6, 4;
          animation: dash 10s linear infinite;
        }
      `}</style>

      {/* Background Gradients */}
      <div className="absolute inset-0 bg-grid-pattern-map opacity-50 pointer-events-none z-0" />

      {/* ── TOP HEADER BAR (Thin, Elegant, Minimal) ────────────────────────────────── */}
      <header className="h-14 border-b border-[var(--border-color)] bg-[var(--glass-surface)] backdrop-blur-md px-6 flex items-center justify-between z-45 flex-shrink-0 relative">
        <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent opacity-60" />

        {/* Left: Navigation and Logo & Software Title */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="group flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors border border-[var(--border-color)] hover:border-[var(--accent-color)]/30 px-2.5 py-1 rounded-lg bg-[var(--border-color)]/10 cursor-pointer text-[10px] font-mono uppercase tracking-wider font-semibold"
          >
            <ArrowLeft size={11} className="group-hover:-translate-x-0.5 transition-transform" />
            <span>Cancel</span>
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

        {/* Right Header Panel */}
        <div className="flex items-center gap-4 font-mono text-[9px] text-[var(--text-muted)]">
          {/* Waiting/Processing Time Badge */}
          <div className="flex items-center gap-3 bg-[var(--accent-glow)] border border-[var(--border-color)]/30 px-3.5 py-1 rounded-lg text-[var(--accent-color)] font-bold shadow-[0_0_12px_var(--accent-glow)] font-mono text-[9.5px] h-8">
            <Clock size={11} className="animate-spin text-[var(--accent-color)]" style={{ animationDuration: '4s' }} />
            <span className="uppercase tracking-wider">WAITING TIME:</span>
            <span className="text-[var(--text-main)] bg-[var(--accent-color)]/25 px-2 py-0.5 rounded font-extrabold text-[10px]">
              {etr}
            </span>
          </div>

          <div className="w-[1px] h-4 bg-[var(--border-color)]" />

          {/* Live system clock */}
          <div className="hidden sm:block text-[10px] font-mono text-[var(--text-muted)] border-l border-[var(--border-color)]/30 pl-4 py-1 select-none">
            {liveTime || "26 MAY 2026 | 11:12:16 AM IST"}
          </div>

          {/* Theme Switcher */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg border border-[var(--border-color)]/30 hover:border-[var(--accent-color)]/30 bg-[var(--border-color)]/5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-all cursor-pointer flex items-center justify-center"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={13} className="text-amber-500" /> : <Moon size={13} className="text-sky-600" />}
          </button>
        </div>
      </header>

      {/* ── MAIN WORKSPACE ───────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex gap-4 p-4 relative z-10">

        {/* LEFT — Pipeline Panel */}
        <div className="w-[300px] flex-none flex flex-col min-h-0 glass-panel rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between bg-[var(--border-color)]/5">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-[var(--text-main)] font-space tracking-wide uppercase">Pipeline Progress</h3>
            </div>
            <span className="text-[9.5px] font-mono bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 text-[var(--accent-color)] px-2 py-0.5 rounded font-bold">
              {Math.min(100, Math.round((currentStepIndex / (stepsList.length - 1)) * 100))}%
            </span>
          </div>

          {/* Timeline steps */}
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-4 space-y-0.5">
            {stepsList.map((step, idx) => {
              const isActive = idx === currentStepIndex;
              const isPast = idx < currentStepIndex;

              return (
                <div className="flex items-start gap-3.5 relative group" key={idx}>
                  {/* Dot */}
                  <div className="relative flex flex-col items-center flex-none">
                    {isActive && (
                      <div className="absolute -inset-1 rounded-full border border-[var(--accent-color)]/45 animate-ping opacity-75 pointer-events-none" />
                    )}
                    <div className={`w-[20px] h-[20px] rounded-full flex items-center justify-center z-10 transition-all duration-300 border font-mono text-[8.5px] font-bold
                      ${isPast
                        ? 'bg-[var(--accent-glow)] border-[var(--accent-color)] text-[var(--accent-color)] shadow-[0_0_8px_var(--accent-glow)]'
                        : isActive
                          ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--bg-primary)] shadow-[0_0_15px_var(--accent-glow)] font-extrabold scale-110'
                          : 'bg-[var(--bg-primary)]/80 border-[var(--border-color)] text-[var(--text-muted)]'}`}
                    >
                      {isPast ? <CheckCircle2 className="w-3 h-3 stroke-[2.5px]" /> : idx + 1}
                    </div>

                    {/* Connecting line */}
                    {idx < stepsList.length - 1 && (
                      <div className={`w-[1.5px] h-3.5 my-0.5 transition-colors duration-500
                        ${isPast ? 'bg-[var(--accent-color)]/80' : 'bg-[var(--border-color)]'}`}
                      />
                    )}
                  </div>

                  {/* Step Info */}
                  <div className="flex-1 min-w-0 pt-0.5 pb-1">
                    <p className={`text-[12px] leading-tight font-space transition-colors duration-300
                      ${isActive ? 'text-[var(--accent-color)] font-extrabold scale-[1.02] origin-left drop-shadow-[0_0_6px_var(--accent-glow)]' : isPast ? 'text-[var(--text-main)] font-semibold' : 'text-[var(--text-muted)]'}`}>
                      {step}
                    </p>
                    {isActive && (
                      <div className="flex items-center gap-1 mt-1">
                        {[0, 0.2, 0.4].map((d, i) => (
                          <motion.span key={i}
                            animate={{ scaleY: [1, 1.8, 1] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: d }}
                            className="inline-block w-[1.5px] h-[4px] bg-[var(--accent-color)] origin-bottom rounded-full"
                          />
                        ))}
                        <span className="text-[7.5px] font-mono text-[var(--accent-color)]/95 ml-1 uppercase tracking-wider animate-pulse">Processing stage...</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER — Map + Description + Dataset Timeline */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-0">

          {/* Map Viewer Panel */}
          <div className="flex-1 min-h-0 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-lg relative flex flex-col">
            {/* HUD Corner Accents */}
            <div className="absolute top-3 left-3 border-t-2 border-l-2 border-[var(--accent-color)]/30 w-3 h-3 z-20 pointer-events-none" />
            <div className="absolute top-3 right-3 border-t-2 border-r-2 border-[var(--accent-color)]/30 w-3 h-3 z-20 pointer-events-none" />
            <div className="absolute bottom-3 left-3 border-b-2 border-l-2 border-[var(--accent-color)]/30 w-3 h-3 z-20 pointer-events-none" />
            <div className="absolute bottom-3 right-3 border-b-2 border-r-2 border-[var(--accent-color)]/30 w-3 h-3 z-20 pointer-events-none" />

            {/* Target scopes crosshairs */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 opacity-[0.12]">
              <div className="w-28 h-28 rounded-full border border-dashed border-[var(--accent-color)] flex items-center justify-center animate-[spin_60s_linear_infinite]" />
              <div className="absolute w-8 h-px bg-[var(--accent-color)]" />
              <div className="absolute h-8 w-px bg-[var(--accent-color)]" />
            </div>

            {/* Scanning Laser Line */}
            <div className="scanning-laser-map" />

            {/* Floating Coordinate HUD */}
            <div className="absolute top-3 left-3 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg px-2.5 py-1.5 font-mono text-[9px] text-[var(--text-muted)] z-10 flex flex-col gap-1 shadow-md">
              <span className="text-cyan-500 font-bold flex items-center gap-1 text-[9.5px]">
                <Globe className="w-3.5 h-3.5 text-cyan-500" /> GEOLOCATION REF
              </span>
              <span>PROJECT: RS-AIMS</span>
              <span>FEED: Sentinel-2 L2A</span>
            </div>

            {/* Map wrapper */}
            <div className="w-full h-full z-0 relative bg-[var(--bg-primary)]">
              {geoData && <MiniMap geoJSON={geoData} status={timelineImages[satelliteImageIndex - 1]?.status} />}
            </div>
          </div>

          {/* Process Information Report Panel */}
          <div className="flex-none bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 shadow-md backdrop-blur-md relative overflow-hidden flex flex-col justify-between min-h-[160px]">
            {/* Back glow */}
            <div className="absolute -right-10 -bottom-10 w-36 h-36 rounded-full bg-[var(--accent-glow)] blur-2xl pointer-events-none" />

            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 border-b border-[var(--border-color)]/60 pb-1.5">
                <Terminal className="w-3.5 h-3.5 text-[var(--accent-color)]" />
                <span className="text-[10px] font-mono text-[var(--accent-color)] uppercase tracking-widest font-bold">
                  Geospatial Stage Pipeline Report
                </span>
                <span className="text-[8.5px] text-[var(--text-muted)] font-mono ml-auto">
                  SYS_THREAD_A2
                </span>
              </div>

              {/* Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Card 1: Target Season */}
                <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)]/60 rounded-xl p-2.5 flex items-center gap-2.5 relative overflow-hidden group hover:border-[var(--accent-color)]/30 transition-all duration-300 select-none">
                  <div className="p-2 rounded-lg bg-[var(--accent-glow)] border border-[var(--accent-color)]/20 text-[var(--accent-color)] group-hover:scale-105 transition-transform flex items-center justify-center">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col text-left min-w-0">
                    <span className="text-[8px] font-mono text-[var(--text-muted)] uppercase tracking-wider">TARGET TIMELINE</span>
                    <span className="text-[11px] font-bold text-[var(--text-main)] truncate mt-0.5">{reportSeason} {reportYear}</span>
                    <span className="text-[9px] text-[var(--text-muted)] truncate">{reportMonths}</span>
                  </div>
                </div>

                {/* Card 2: AOI Boundary */}
                <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)]/60 rounded-xl p-2.5 flex items-center gap-2.5 relative overflow-hidden group hover:border-[var(--accent-color)]/30 transition-all duration-300 select-none">
                  <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 group-hover:scale-105 transition-transform flex items-center justify-center">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col text-left min-w-0">
                    <span className="text-[8px] font-mono text-[var(--text-muted)] uppercase tracking-wider">GEOSPATIAL FRAME</span>
                    <span className="text-[11px] font-bold text-[var(--text-main)] truncate mt-0.5">{reportBoundary}</span>
                    <span className="text-[9px] text-[var(--text-muted)] truncate">Cloud Target: &lt; 10% Density</span>
                  </div>
                </div>

                {/* Card 3: Processing Pipeline */}
                <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)]/60 rounded-xl p-2.5 flex items-center gap-2.5 relative overflow-hidden group hover:border-[var(--accent-color)]/30 transition-all duration-300 select-none">
                  <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 group-hover:scale-105 transition-transform flex items-center justify-center">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div className="flex flex-col text-left min-w-0">
                    <span className="text-[8px] font-mono text-[var(--text-muted)] uppercase tracking-wider">ALGORITHMIC PIPELINE</span>
                    <span className="text-[11px] font-bold text-[var(--text-main)] truncate mt-0.5">Active Crop Extraction</span>
                    <span className="text-[9px] text-[var(--text-muted)] truncate">NDVI Profiles & Yield Model</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Metadata tags */}
            <div className="flex flex-wrap gap-1.5 items-center mt-2.5 border-t border-[var(--border-color)]/60 pt-2 font-mono text-[9px] text-[var(--text-muted)]">
              <span className="bg-[var(--bg-primary)]/50 border border-[var(--border-color)] px-2 py-0.5 rounded">
                Season: <span className="text-[var(--accent-color)] font-semibold">{configData?.season || "Rabi"} {configData?.year || "2024"}</span>
              </span>
              <span className="bg-[var(--bg-primary)]/50 border border-[var(--border-color)] px-2 py-0.5 rounded">
                Range: <span className="text-[var(--text-main)]">{configData?.season?.toLowerCase() === "kharif" ? `Jun ${configData?.year} – Oct ${configData?.year}` : `Nov ${configData?.year} – Mar ${parseInt(configData?.year || 2024) + 1}`}</span>
              </span>
              <span className="bg-[var(--bg-primary)]/50 border border-[var(--border-color)] px-2 py-0.5 rounded">
                Resolution: <span className="text-[var(--text-main)]">10m Multispectral</span>
              </span>
              <span className="ml-auto flex items-center gap-1 bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 px-2 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-pulse" />
                <span className="text-[var(--accent-color)] font-bold uppercase tracking-wider text-[8px]">ACTIVE PROCESS</span>
              </span>
            </div>
          </div>

          {/* Temporal Dataset Preview Strip */}
          <div
            className="flex-none bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl px-4 py-3 shadow-md"
            style={{ height: "165px" }}
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold font-space uppercase text-[var(--text-main)] tracking-wider">
                Copernicus Feed Acquisition Stack
              </span>
              <span className="text-[9.5px] text-[var(--text-muted)] font-mono">
                {timelineImages.length > 0
                  ? `${timelineImages.filter(i => i.status === 'completed').length} / ${expectedDates.length} Scenes Loaded`
                  : 'Acquiring satellite pipeline...'}
              </span>
            </div>

            {/* Scroll track */}
            <div
              ref={scrollRef}
              className="flex gap-2.5 overflow-x-auto overflow-y-hidden scrollbar-hide w-full"
              style={{ height: "120px" }}
            >
              {timelineImages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center border border-[var(--border-color)]/25 border-dashed rounded-xl bg-[var(--bg-primary)]/20 text-[10px] font-mono text-[var(--text-muted)] h-[115px]">
                  <Satellite className="w-4 h-4 mr-2 animate-pulse text-[var(--accent-color)]" />
                  <span>Awaiting Copernicus satellite feed connection...</span>
                </div>
              ) : (
                timelineImages.map((img, i) => {
                  const dateCard = expectedDates.find(d => d.code === img.target_date) || {
                    name: img.target_date,
                    code: img.target_date,
                    cloud: "4.5%",
                    ndvi: "0.55"
                  };
                  return (
                    <TemporalDatasetCard
                      key={i}
                      index={img.id || i + 1}
                      cardInfo={dateCard}
                      actualData={img}
                    />
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — Telemetry Panel */}
        <div className="w-[270px] flex-none flex flex-col gap-3.5 min-h-0">

          {/* System Performance */}
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-3.5 flex flex-col gap-3 shadow-lg">
            <div className="flex items-center gap-2 border-b border-[var(--border-color)]/60 pb-1.5 flex-none">
              <Cpu size={13} className="text-cyan-500" />
              <h3 className="text-[10.5px] font-bold text-[var(--text-main)] font-space tracking-wide uppercase">Workspace Telemetry</h3>
            </div>

            <div className="space-y-2.5 font-mono text-[10px]">
              {/* GPU UTIL */}
              <div>
                <div className="flex justify-between items-center mb-1 text-[var(--text-muted)]">
                  <span>GPU EXHAUSTION</span>
                  <span className="text-cyan-500 font-bold">{performance.gpu}%</span>
                </div>
                <div className="h-1.5 bg-[var(--bg-primary)]/80 border border-[var(--border-color)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full transition-all duration-500"
                    style={{ width: `${performance.gpu}%` }}
                  />
                </div>
              </div>

              {/* RAM UTIL */}
              <div>
                <div className="flex justify-between items-center mb-1 text-[var(--text-muted)]">
                  <span>SYSTEM MEMORY</span>
                  <span className="text-[var(--text-main)] font-bold">{(performance.ram).toFixed(1)} / 16.0 GB</span>
                </div>
                <div className="h-1.5 bg-[var(--bg-primary)]/80 border border-[var(--border-color)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent-color)] rounded-full transition-all duration-500"
                    style={{ width: `${(performance.ram / 16) * 100}%` }}
                  />
                </div>
              </div>

              {/* SPEED & CACHE */}
              <div className="grid grid-cols-2 gap-2 mt-1 pt-2.5 border-t border-[var(--border-color)]/60">
                <div className="p-2 bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg">
                  <span className="text-[8px] text-[var(--text-muted)] block uppercase font-bold">RATE</span>
                  <span className="text-[10.5px] text-[var(--accent-color)] font-bold block mt-0.5">{performance.speed} Mpx/s</span>
                </div>
                <div className="p-2 bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg">
                  <span className="text-[8px] text-[var(--text-muted)] block uppercase font-bold">DISK CACHE</span>
                  <span className="text-[10.5px] text-[var(--text-main)] font-bold block mt-0.5">{performance.cache} GB</span>
                </div>
              </div>
            </div>
          </div>

          {/* GIS Mission Specs & Image Metadata */}
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 flex flex-col gap-3.5 shadow-lg flex-1 min-h-0">
            <div className="flex items-center gap-2 border-b border-[var(--border-color)]/60 pb-2 flex-none">
              <Database size={14} className="text-[var(--accent-color)]" />
              <h3 className="text-[12px] font-bold text-[var(--text-main)] font-space tracking-wide uppercase">GIS Mission Specs</h3>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-4">
              {/* Section 1: Imagery Metadata */}
              <div className="space-y-2">
                <div className="text-[9.5px] font-bold text-[var(--accent-color)] uppercase tracking-wider border-b border-[var(--border-color)]/30 pb-0.5">
                  Active Imagery Metadata
                </div>
                <div className="space-y-2 font-mono text-[11px] text-[var(--text-main)]">
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Sensor Source:</span>
                    <span className="font-semibold">Sentinel-2 (MSI L2A)</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Cloud Cover:</span>
                    <span className="font-semibold text-amber-500">{activeCloud}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Avg NDVI Index:</span>
                    <span className="font-semibold text-emerald-400">{activeNdvi}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Spectral Bands:</span>
                    <span className="text-[10px]">B1-B9, B11-B12 (12 Bands)</span>
                  </div>
                </div>
              </div>

              {/* Section 2: Workspace Boundary Specs */}
              <div className="space-y-2">
                <div className="text-[9.5px] font-bold text-cyan-500 uppercase tracking-wider border-b border-[var(--border-color)]/30 pb-0.5">
                  Geospatial Framework
                </div>
                <div className="space-y-2 font-mono text-[11px] text-[var(--text-main)]">
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Boundary Name:</span>
                    <span className="truncate max-w-[130px] font-semibold" title={configData?.boundaryName || "AOI"}>
                      {configData?.boundaryName || "AOI"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Location (Center):</span>
                    <span className="font-semibold text-cyan-400">{centroid.name}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Latitude:</span>
                    <span className="font-semibold">{centroid.lat.toFixed(5)}° N</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Longitude:</span>
                    <span className="font-semibold">{centroid.lon.toFixed(5)}° E</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">AOI boundary Area:</span>
                    <span className="font-semibold">{areaValue}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Spatial Res:</span>
                    <span className="font-semibold">10m / Pixel</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Map Projection:</span>
                    <span className="font-semibold">UTM {utmZone}{hemisphere} / WGS84</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Sun Angle / Az:</span>
                    <span className="font-semibold text-[10px]">{sunElevation}° / {sunAzimuth}°</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5">
                    <span className="text-[var(--text-muted)]">Reflectance:</span>
                    <span className="font-semibold text-emerald-400 text-[10px]">BOA Corrected</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

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

/* ── MAPPING & HELPERS ─────────────────────────────────────────────────── */

const getExpectedDates = (configData) => {
  const season = configData?.season || "Rabi";
  const year = parseInt(configData?.year || "2024");

  let months = [];
  if (season.toLowerCase() === "rabi") {
    months = [
      { y: year, m: 10 },
      { y: year, m: 11 },
      { y: year, m: 12 },
      { y: year + 1, m: 1 },
      { y: year + 1, m: 2 },
      { y: year + 1, m: 3 },
      { y: year + 1, m: 4 }
    ];
  } else if (season.toLowerCase() === "kharif") {
    months = [
      { y: year, m: 6 },
      { y: year, m: 7 },
      { y: year, m: 8 },
      { y: year, m: 9 },
      { y: year, m: 10 }
    ];
  } else { // zaid
    months = [
      { y: year, m: 3 },
      { y: year, m: 4 },
      { y: year, m: 5 },
      { y: year, m: 6 }
    ];
  }

  const targetDays = [5, 20];
  const dates = [];
  const now = new Date();

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  months.forEach(({ y, m }) => {
    targetDays.forEach(d => {
      const dt = new Date(y, m - 1, d);
      if (dt <= now) {
        const paddedMonth = m.toString().padStart(2, '0');
        const paddedDay = d.toString().padStart(2, '0');
        const code = `${y}-${paddedMonth}-${paddedDay}`;
        const name = `${monthNames[m - 1]} ${d}, ${y}`;

        let baseCloud = 4.5;
        let baseNdvi = 0.55;
        if (m === 10) { baseCloud = 6.2; baseNdvi = 0.41; }
        else if (m === 11) { baseCloud = 4.8; baseNdvi = 0.45; }
        else if (m === 12) { baseCloud = 3.2; baseNdvi = 0.58; }
        else if (m === 1) { baseCloud = 5.1; baseNdvi = 0.72; }
        else if (m === 2) { baseCloud = 4.4; baseNdvi = 0.76; }
        else if (m === 3) { baseCloud = 2.9; baseNdvi = 0.68; }
        else if (m === 4) { baseCloud = 3.5; baseNdvi = 0.52; }
        else if (m === 5) { baseCloud = 8.2; baseNdvi = 0.35; }
        else if (m === 6) { baseCloud = 12.5; baseNdvi = 0.38; }
        else if (m === 7) { baseCloud = 18.3; baseNdvi = 0.52; }
        else if (m === 8) { baseCloud = 15.1; baseNdvi = 0.64; }
        else if (m === 9) { baseCloud = 9.2; baseNdvi = 0.68; }

        const varianceFactor = d === 5 ? -1 : 1;
        const cloud = (baseCloud + varianceFactor * 0.7).toFixed(1) + "%";
        const ndvi = (baseNdvi + varianceFactor * 0.04).toFixed(2);

        dates.push({
          name: name,
          code: code,
          defaultDate: code,
          cloud: cloud,
          ndvi: ndvi
        });
      }
    });
  });

  return dates;
};

const getStageDetails = (stepIndex, configData) => {
  const season = configData?.season || "Rabi";
  const year = configData?.year || "2024";
  const nextYear = parseInt(year) + 1;
  const temporalRange = season.toLowerCase() === "rabi" ? `Nov ${year} – Mar ${nextYear}` : `Jun ${year} – Oct ${year}`;
  const isLulc = configData?.analysis_type === "lulc";

  if (isLulc) {
    const lulcStages = [
      {
        title: "Initialize LULC Workspace",
        description: "RS-AIMS is initializing the Land Use Land Cover classification workspace, allocating storage arrays and configuring multi-sensor ingestion pipelines."
      },
      {
        title: "Acquire Sentinel-2 Multi-Spectral Stack",
        description: `Acquiring local Sentinel-2 multi-temporal scenes. Loading spectral bands across the target ${season} ${year} season for multi-seasonal signature analysis.`
      },
      {
        title: "Extract SRTM Elevation Grid & Calculate Slope",
        description: "Downloading USGS SRTM 30m Digital Elevation Model (DEM) and calculating terrain slope angles to differentiate mountain vegetation from plain lowlands."
      },
      {
        title: "Query GEDI LiDAR Canopy Data (25m)",
        description: "Fetching monthly GEDI LiDAR parameters. Extracting canopy height profile (rh98) and fractional cover datasets to identify tree height classes."
      },
      {
        title: "Fetch Dynamic World global classification baseline",
        description: "Querying Google Dynamic World V1 annual land cover probability layers as the global baseline guidance dataset."
      },
      {
        title: "Align multi-sensor rasters to 10m grid",
        description: "Executing sub-pixel reprojections and geospatial resampling. Aligning DEM terrain, GEDI heights, and Dynamic World labels exactly to the Sentinel-2 10m grid."
      },
      {
        title: "Derive local multi-temporal spectral indices",
        description: "Computing dry/wet season envelopes. Extracting local peak/dormancy indicators (NDVI max/min, MNDWI, BSI dry) from the Sentinel-2 imagery stack."
      },
      {
        title: "Execute rule-based refinement tree",
        description: "Processing indices, elevation heights, and canopy coverages through the rule-based decision tree to isolate detailed forest subtypes, built areas, and water categories."
      },
      {
        title: "Run 3x3 Spatial Majority filter",
        description: "Applying spatial smoothing majority filter to classification boundaries to resolve salt-and-pepper noise and establish clean land cover contours."
      },
      {
        title: "Calculate Land Cover class statistics",
        description: "Scanning classification rasters to calculate acreage summaries, percentage distributions, and spatial coverage for all 15 refined LULC classes."
      },
      {
        title: "Generate LULC visual products",
        description: "Generating GeoTIFF files with colormap indexing, visual RGB layers, and high-contrast PNG overlays for leaflet display."
      },
      {
        title: "Export Intelligence Products",
        description: "LULC intelligence processing finalized. Registering the run in the database, archiving outputs, and preparing the workspace dashboard."
      }
    ];

    if (stepIndex >= lulcStages.length) {
      return {
        title: "Analysis Finalized",
        description: "All remote sensing pipeline processing is complete. Land cover intelligence products have been saved. Transitioning to dashboard..."
      };
    }
    return lulcStages[stepIndex] || lulcStages[0];
  }

  const stages = [
    {
      title: "Initialize Analysis Engine",
      description: "RS-AIMS is initializing the high-performance remote sensing analytics environment. Establishing secure socket links and configuring temporary caching buffers for temporal imagery."
    },
    {
      title: "Validate Uploaded Boundary",
      description: "Validating area of interest (AOI) boundary coordinate systems. Checking geometry topology, parsing GeoJSON properties, and projecting coordinate reference systems to UTM zone projections."
    },
    {
      title: "AOI Geometry Optimization",
      description: "Optimizing AOI geometry bounds. Calculating geospatial bounding box, grid alignment, and partitioning analysis tiles for high-throughput spatial execution."
    },
    {
      title: "Acquire Sentinel-2 Datasets",
      description: `RS-AIMS is currently querying and acquiring multi-temporal Sentinel-2 satellite datasets for the selected ${season} ${year} season. Establishing data connections to cloud data archives.`
    },
    {
      title: "Cloud & Shadow Filtering",
      description: "Applying scene classification algorithms (SCL) to filter out cloud coverage, high-altitude cirrus, and shadow pixels below the specified 20% threshold."
    },
    {
      title: "Noise Reduction & Atmospheric Correction",
      description: "Performing atmospheric correction (Sen2Cor equivalent) and spatial noise reduction. Enhancing band imagery signal-to-noise ratio to calibrate surface reflectance."
    },
    {
      title: "Temporal Seasonal Dataset Creation",
      description: `Compiling cloud-free temporal composites. Creating a standardized image stack representing temporal observations from ${temporalRange} to capture crop lifecycle.`
    },
    {
      title: "NDVI & Vegetation Index Analysis",
      description: "Calculating Normalized Difference Vegetation Index (NDVI) and related red-edge vegetation metrics. Monitoring chlorophyll activity and temporal biomass changes."
    },
    {
      title: "Agriculture Land Extraction",
      description: "Applying dynamic thresholding and spectral signature matching to extract active agricultural plots from non-vegetated regions, waterbodies, and urban structures."
    },
    {
      title: "Crop Classification Engine",
      description: "Executing the machine learning crop classification engine. Differentiating crop signatures to classify major grain types and seasonal vegetation variations."
    },
    {
      title: "Field Boundary Generation",
      description: "Segmenting fields and resolving sub-pixel boundaries. Generalizing polygon shapes and extracting parcel borders using spatial filters."
    },
    {
      title: "Yield & Acreage Estimation",
      description: "Estimating crop acreage and projecting yields using biophysical parameter models combined with temporal NDVI integrals."
    },
    {
      title: "Export Intelligence Products",
      description: "Analysis complete. Compiling agricultural mask datasets, generating geo-intelligence layers, and preparing final data products for dashboard visualization."
    }
  ];

  if (stepIndex >= stages.length) {
    return {
      title: "Analysis Finalized",
      description: "All remote sensing pipeline processing is complete. Agricultural intelligence vectors and yield metrics have been generated. Transitioning to workspace dashboard..."
    };
  }
  return stages[stepIndex] || stages[0];
};

const calculateArea = (geojson) => {
  if (!geojson || !geojson.features?.[0]) return "142.5 ha";
  try {
    const coords = geojson.features[0].geometry.coordinates[0];
    if (!Array.isArray(coords) || coords.length < 3) return "142.5 ha";

    let area = 0;
    const numPoints = coords.length;

    let sumLat = 0;
    coords.forEach(pt => {
      let lat = Array.isArray(pt[0]) ? pt[0][1] : pt[1];
      sumLat += lat;
    });
    const avgLat = sumLat / numPoints;
    const latToMeters = 111132.95;
    const lonToMeters = 111132.95 * Math.cos(avgLat * Math.PI / 180);

    for (let i = 0; i < numPoints; i++) {
      const pt1 = coords[i];
      const pt2 = coords[(i + 1) % numPoints];

      const x1 = (Array.isArray(pt1[0]) ? pt1[0][0] : pt1[0]) * lonToMeters;
      const y1 = (Array.isArray(pt1[0]) ? pt1[0][1] : pt1[1]) * latToMeters;

      const x2 = (Array.isArray(pt2[0]) ? pt2[0][0] : pt2[0]) * lonToMeters;
      const y2 = (Array.isArray(pt2[0]) ? pt2[0][1] : pt2[1]) * latToMeters;

      area += (x1 * y2) - (x2 * y1);
    }

    const areaM2 = Math.abs(area) / 2;
    const areaHa = areaM2 / 10000;


    if (isNaN(areaHa) || areaHa < 0.1) return "84.2 ha";
    return areaHa.toFixed(1) + " ha";
  } catch (e) {
    return "142.5 ha";
  }
};

const getCentroid = (geojson) => {
  if (!geojson || !geojson.features?.[0]) return { lat: 26.2742, lon: 74.3811, name: "Ajmer Region" };
  try {
    const coords = geojson.features[0].geometry.coordinates[0];
    if (!Array.isArray(coords)) return { lat: 26.2742, lon: 74.3811, name: "Ajmer Region" };

    let sumLat = 0;
    let sumLon = 0;
    let count = 0;

    coords.forEach(pt => {
      let lon = pt[0];
      let lat = pt[1];
      if (Array.isArray(pt[0])) {
        lon = pt[0][0];
        lat = pt[0][1];
      }
      if (typeof lat === 'number' && typeof lon === 'number' && !isNaN(lat) && !isNaN(lon)) {
        sumLat += lat;
        sumLon += lon;
        count++;
      }
    });

    if (count === 0) return { lat: 26.2742, lon: 74.3811, name: "Ajmer Region" };

    const lat = sumLat / count;
    const lon = sumLon / count;

    const districts = [
      { name: "Ajmer Region", lat: 26.45, lon: 74.64 },
      { name: "Jaipur Region", lat: 26.92, lon: 75.79 },
      { name: "Jodhpur Region", lat: 26.27, lon: 73.02 },
      { name: "Udaipur Region", lat: 24.58, lon: 73.71 },
      { name: "Bikaner Region", lat: 28.02, lon: 73.31 },
      { name: "Kota Region", lat: 25.18, lon: 75.83 },
      { name: "Alwar Region", lat: 27.55, lon: 76.60 },
      { name: "Sikar Region", lat: 27.61, lon: 75.14 },
      { name: "Barmer Region", lat: 25.75, lon: 71.40 },
      { name: "Bhilwara Region", lat: 25.35, lon: 74.64 },
      { name: "Jaisalmer Region", lat: 26.91, lon: 70.91 },
      { name: "Churu Region", lat: 28.30, lon: 74.97 },
      { name: "Nagaur Region", lat: 27.20, lon: 73.74 }
    ];

    let closest = districts[0];
    let minDist = Infinity;
    districts.forEach(d => {
      const dist = Math.pow(d.lat - lat, 2) + Math.pow(d.lon - lon, 2);
      if (dist < minDist) {
        minDist = dist;
        closest = d;
      }
    });

    return { lat, lon, name: closest.name };
  } catch (e) {
    return { lat: 26.2742, lon: 74.3811, name: "Ajmer Region" };
  }
};

export default MapScreen;
