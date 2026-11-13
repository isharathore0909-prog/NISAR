import React, { useState, useEffect, useMemo } from "react";
import { MapContainer, TileLayer, GeoJSON, ImageOverlay, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Globe, Layout, PieChart, Activity, ArrowLeft,
  Calendar, Settings, MousePointer2,
  Filter, Info, Cpu, Leaf, Target, Database, Trash2, Sliders, Eye, EyeOff, Play, Pause,
  Sprout, Droplet, Maximize, RotateCcw, ZoomIn, ZoomOut, Crosshair,
  FileText, Layers, X, ChevronRight, ChevronDown, ArrowLeftRight, Sun, Moon, ShieldCheck,
  Cloud, CloudRain, CloudLightning, Wind, Thermometer, AlertTriangle
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import * as turf from "@turf/turf";
import {
  ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis,
  Tooltip as ChartTooltip, Legend as ChartLegend, Bar, Line, ReferenceDot
} from "recharts";

const FitBounds = ({ data, padding }) => {
  const map = useMap();
  useEffect(() => {
    if (data) {
      const geoJsonLayer = L.geoJSON(data);
      if (geoJsonLayer.getBounds().isValid()) {
        map.fitBounds(geoJsonLayer.getBounds(), padding ? padding : { padding: [100, 100] });
      }
    }
  }, [data, map, padding]);
  return null;
};

const SyncView = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => {
    if (center && zoom) {
      const currentCenter = map.getCenter();
      const currentZoom = map.getZoom();
      if (Math.abs(currentCenter.lat - center[0]) > 0.00001 ||
        Math.abs(currentCenter.lng - center[1]) > 0.00001 ||
        currentZoom !== zoom) {
        map.setView(center, zoom, { animate: false });
      }
    }
  }, [center, zoom, map]);
  return null;
};

const SyncListener = ({ onSync, active }) => {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const handleMove = () => {
      const c = map.getCenter();
      onSync([c.lat, c.lng], map.getZoom());
    };
    map.on("move", handleMove);
    map.on("zoomend", handleMove);
    return () => {
      map.off("move", handleMove);
      map.off("zoomend", handleMove);
    };
  }, [map, onSync, active]);
  return null;
};

const getCentroid = (geojson) => {
  if (!geojson) return { lat: 26.45, lon: 74.64 };
  try {
    let geom = geojson;
    if (geojson.type === "FeatureCollection" && geojson.features?.[0]) {
      geom = geojson.features[0].geometry;
    } else if (geojson.type === "Feature") {
      geom = geojson.geometry;
    }

    if (geom.type === "Polygon") {
      const coords = geom.coordinates[0];
      let sumLat = 0, sumLon = 0;
      coords.forEach(pt => {
        sumLon += pt[0];
        sumLat += pt[1];
      });
      return { lat: sumLat / coords.length, lon: sumLon / coords.length };
    } else if (geom.type === "MultiPolygon") {
      const coords = geom.coordinates[0][0];
      let sumLat = 0, sumLon = 0;
      coords.forEach(pt => {
        sumLon += pt[0];
        sumLat += pt[1];
      });
      return { lat: sumLat / coords.length, lon: sumLon / coords.length };
    }
    return { lat: 26.45, lon: 74.64 };
  } catch (e) {
    console.error("Centroid calculation error:", e);
    return { lat: 26.45, lon: 74.64 };
  }
};


const PremiumLogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--accent-color)]">
    <path d="M12 2L21 6.5V17.5L12 22L3 17.5V6.5L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.5 2.5" />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" className="animate-pulse" />
    <path d="M12 2V6M12 18V22M3 12H7M17 12H21" stroke="currentColor" strokeWidth="1" strokeOpacity="0.5" />
  </svg>
);


const LogoIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-[var(--accent-color)]">
    <path d="M12 2L20.6603 7V17L12 22L3.33975 17V7L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
    <circle cx="12" cy="12" r="2" fill="currentColor" className="animate-pulse" />
  </svg>
);

const getBandFromCombo = (comboStr, channel) => {
  let r = 1, g = 2, b = 3; // defaults for natural
  if (comboStr === 'natural') {
    r = 1; g = 2; b = 3;
  } else if (comboStr === 'false_color') {
    r = 4; g = 1; b = 2;
  } else if (comboStr === 'swir') {
    r = 5; g = 4; b = 1;
  } else if (comboStr === 'agriculture') {
    r = 5; g = 4; b = 2;
  } else if (comboStr && comboStr.startsWith('custom_')) {
    const parts = comboStr.split('_');
    r = parseInt(parts[1]) || 1;
    g = parseInt(parts[2]) || 2;
    b = parseInt(parts[3]) || 3;
  }
  if (channel === 'R') return r;
  if (channel === 'G') return g;
  if (channel === 'B') return b;
  return 1;
};

const makeCustomCombo = (r, g, b) => {
  return `custom_${r}_${g}_${b}`;
};

const MapController = ({ fitTrigger, bounds, geoData, padding }) => {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const performFit = () => {
      if (bounds) {
        map.fitBounds(bounds, padding);
      } else if (geoData) {
        const geoJsonLayer = L.geoJSON(geoData);
        if (geoJsonLayer.getBounds().isValid()) {
          map.fitBounds(geoJsonLayer.getBounds(), padding);
        }
      }
    };
    performFit();
    const timer = setTimeout(performFit, 150);
    return () => clearTimeout(timer);
  }, [bounds, geoData, padding, map, fitTrigger]);
  return null;
};

const LeafletResizeHandler = ({ dependency }) => {
  const map = useMap();
  useEffect(() => {
    // Invalidate size immediately, at mid-transition, and post-transition to ensure zero clipping
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 150);
    const t2 = setTimeout(() => map.invalidateSize(), 350);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [map, dependency]);
  return null;
};

const getMapPadding = (arcgisMode, isSidebarCollapsed, compareMode, hasTimeline) => {
  if (compareMode) {
    return {
      padding: [50, 50]
    };
  }
  if (arcgisMode) {
    const leftSidebarWidth = isSidebarCollapsed ? 90 : 288;
    return {
      paddingTopLeft: [leftSidebarWidth + 20, 80],
      paddingBottomRight: [40, 40]
    };
  } else {
    const leftSidebarWidth = isSidebarCollapsed ? 90 : 250;
    const rightPanelWidth = 320;
    const bottomTimelineHeight = hasTimeline ? 210 : 40;
    return {
      paddingTopLeft: [leftSidebarWidth + 280, 80],
      paddingBottomRight: [rightPanelWidth + 20, bottomTimelineHeight]
    };
  }
};

const MapInquiryListener = ({ active, onInquire }) => {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const handleMouseMove = (e) => {
      onInquire(e.latlng);
    };
    map.on('mousemove', handleMouseMove);
    return () => {
      map.off('mousemove', handleMouseMove);
    };
  }, [map, active, onInquire]);
  return null;
};

const IntelligenceWorkspace = () => {
  const navigate = useNavigate();
  const [activeWorkspace, setActiveWorkspace] = useState('overview');
  const [rawResultsData, setResultsData] = useState(null);
  const [geoData, setGeoData] = useState(null);

  const turfAreaHa = useMemo(() => {
    if (!geoData) return null;
    try {
      const areaM2 = turf.area(geoData);
      return Number((areaM2 / 10000).toFixed(2));
    } catch (e) {
      console.error("Turf area calculation error:", e);
      return null;
    }
  }, [geoData]);

  const processedResultsData = useMemo(() => {
    if (!rawResultsData) return null;
    if (!turfAreaHa) return rawResultsData;

    try {
      const adjusted = JSON.parse(JSON.stringify(rawResultsData));
      const origTotal = adjusted.stats?.total_area || 0;
      if (origTotal <= 0) return adjusted;

      const scale = turfAreaHa / origTotal;

      // Adjust overall stats
      if (adjusted.stats) {
        adjusted.stats.total_area = turfAreaHa;
        adjusted.stats.crop_area = Number((adjusted.stats.crop_area * scale).toFixed(2));
        adjusted.stats.non_crop_area = Number(Math.max(0, turfAreaHa - adjusted.stats.crop_area).toFixed(2));
      }

      // Adjust crop_stats
      if (adjusted.crop_stats && adjusted.crop_stats.crops) {
        let totalCropPx = 0;
        Object.keys(adjusted.crop_stats.crops).forEach(key => {
          totalCropPx += adjusted.crop_stats.crops[key].pixels || 0;
        });

        Object.keys(adjusted.crop_stats.crops).forEach(key => {
          const crop = adjusted.crop_stats.crops[key];
          crop.area_ha = Number((crop.area_ha * scale).toFixed(2));
          crop.area_acres = Number((crop.area_ha * 2.47105).toFixed(2));
          if (totalCropPx > 0) {
            crop.percentage = Number(((crop.pixels / totalCropPx) * 100).toFixed(1));
          }
          if (crop.yield_t_ha) {
            crop.est_yield_tonnes = Number((crop.area_ha * crop.yield_t_ha).toFixed(1));
          }
        });
      }

      // Adjust lulc_stats
      if (adjusted.lulc_stats && adjusted.lulc_stats.crops) {
        let totalLulcPx = 0;
        Object.keys(adjusted.lulc_stats.crops).forEach(key => {
          totalLulcPx += adjusted.lulc_stats.crops[key].pixels || 0;
        });

        Object.keys(adjusted.lulc_stats.crops).forEach(key => {
          const crop = adjusted.lulc_stats.crops[key];
          crop.area_ha = Number((crop.area_ha * scale).toFixed(2));
          crop.area_acres = Number((crop.area_ha * 2.47105).toFixed(2));
          if (totalLulcPx > 0) {
            crop.percentage = Number(((crop.pixels / totalLulcPx) * 100).toFixed(2));
          }
        });
      }

      return adjusted;
    } catch (err) {
      console.error("processedResultsData error:", err);
      return rawResultsData;
    }
  }, [rawResultsData, turfAreaHa]);

  const resultsData = processedResultsData;
  const isCroppingIntensity = useMemo(() => {
    return resultsData?.run_type === 'lulc' && resultsData?.crop_stats?.rotation_stats;
  }, [resultsData]);

  const [activeSeasonalOverlay, setActiveSeasonalOverlay] = useState(null);
  const [activeAdminTab, setActiveAdminTab] = useState('farms'); // 'farms', 'villages', 'blocks', 'districts'
  const [showClassification, setShowClassification] = useState(false);
  const [showCropOverlay, setShowCropOverlay] = useState(true);
  const [showLulcOverlay, setShowLulcOverlay] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [analysisInfo, setAnalysisInfo] = useState({ season: "KHARIF", year: "2024", boundaryName: "Target Sector" });

  // Database runs list state
  const [runsList, setRunsList] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  // Satellite image comparison / blender state
  const [satelliteImages, setSatelliteImages] = useState([]);
  const [selectedImgA, setSelectedImgA] = useState(null);
  const [selectedImgB, setSelectedImgB] = useState(null);
  const [compareMode, setCompareMode] = useState(false);
  const [blendRatio, setBlendRatio] = useState(0.5);
  const [isSweeping, setIsSweeping] = useState(false);
  const [showMasks, setShowMasks] = useState(true);

  // ArcGIS / ERDAS mode states
  const [arcgisMode, setArcgisMode] = useState(false);
  const [activeBands, setActiveBands] = useState('natural');
  const [activeBandsA, setActiveBandsA] = useState('natural');
  const [activeBandsB, setActiveBandsB] = useState('natural');
  const [blenderStyle, setBlenderStyle] = useState('swipe');
  const isVerticalSwipe = blenderStyle === 'swipe-vertical';
  const [sliderPercent, setSliderPercent] = useState(50);
  const [sliderPercentY, setSliderPercentY] = useState(50);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [fitTriggerA, setFitTriggerA] = useState(0);
  const [fitTriggerB, setFitTriggerB] = useState(0);
  const [fitTriggerStandard, setFitTriggerStandard] = useState(0);
  const [inquiryActive, setInquiryActive] = useState(false);
  const [inquiryPoint, setInquiryPoint] = useState(null);
  const [metadataModalOpen, setMetadataModalOpen] = useState(false);
  const [weatherModalOpen, setWeatherModalOpen] = useState(false);
  const [selectedImgMetadata, setSelectedImgMetadata] = useState(null);
  const [metadataLoading, setMetadataLoading] = useState(false);

  // Weather Patterns Workspace states
  const [weatherPatternsData, setWeatherPatternsData] = useState(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [selectedWeatherScene, setSelectedWeatherScene] = useState(null);
  const [chartViewMode, setChartViewMode] = useState('season'); // 'season' or 'detail'

  const seasonalUrls = useMemo(() => {
    if (!resultsData?.output_dir) return null;
    const path = resultsData.output_dir;
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const folderName = parts[parts.length - 1];
    const parentPath = parts.slice(0, parts.length - 1).join('/');

    let safeName = folderName;
    let year = "2024";
    if (folderName.includes("_Annual_")) {
      const sp = folderName.split("_Annual_");
      safeName = sp[0];
      year = sp[1];
    }

    return {
      kharif_agri: `http://127.0.0.1:5000/api/agriculture-png?output_dir=${parentPath}/${safeName}_Kharif_${year}`,
      rabi_agri: `http://127.0.0.1:5000/api/agriculture-png?output_dir=${parentPath}/${safeName}_Rabi_${year}`,
      zaid_agri: `http://127.0.0.1:5000/api/agriculture-png?output_dir=${parentPath}/${safeName}_Zaid_${year}`,
      kharif_crop: `http://127.0.0.1:5000/api/classification-png?output_dir=${parentPath}/${safeName}_Kharif_${year}&type=crop`,
      rabi_crop: `http://127.0.0.1:5000/api/classification-png?output_dir=${parentPath}/${safeName}_Rabi_${year}&type=crop`,
      zaid_crop: `http://127.0.0.1:5000/api/classification-png?output_dir=${parentPath}/${safeName}_Zaid_${year}&type=crop`
    };
  }, [resultsData]);

  const fetchWeatherPatterns = async () => {
    setLoadingWeather(true);
    try {
      const config = JSON.parse(localStorage.getItem("analysisConfig") || "{}");
      let outputDir = config.outputFolder || "";
      if (config.boundaryName) {
        const safeName = config.boundaryName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/ /g, '_');
        outputDir += '/' + safeName;
      }
      const season = config.season || 'rabi';
      const resp = await fetch(`http://localhost:5000/api/weather-patterns?output_dir=${encodeURIComponent(outputDir)}&season=${season}`);
      const data = await resp.json();
      if (data.status === "success") {
        setWeatherPatternsData(data);
        setSelectedWeatherScene(null);
        setChartViewMode('season');
      }
    } catch (err) {
      console.error("Error fetching weather patterns:", err);
    }
    setLoadingWeather(false);
  };



  const [activeRibbonTab, setActiveRibbonTab] = useState('imagery');
  const [syncCenter, setSyncCenter] = useState([26.45, 74.64]);
  const [syncZoom, setSyncZoom] = useState(13);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredMap, setHoveredMap] = useState('A');
  const archiveScrollRef = React.useRef(null);

  const [theme, setTheme] = useState("dark");
  const [liveTime, setLiveTime] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const handleArchiveWheel = (e) => {
    if (archiveScrollRef.current) {
      if (e.deltaY !== 0) {
        archiveScrollRef.current.scrollLeft += e.deltaY;
      }
    }
  };

  const [imgStats, setImgStats] = useState(null);

  // Pest detection state
  const [pestData, setPestData] = useState(null);
  const [pestLoading, setPestLoading] = useState(false);

  const runPestDetection = async () => {
    if (!resultsData?.run_id) return;
    setPestLoading(true);
    try {
      const res = await fetch(`http://localhost:5000/api/runs/${resultsData.run_id}/pest-detection`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') {
        setPestData(data);
      } else {
        console.error('[PestDet]', data.message);
      }
    } catch (e) {
      console.error('[PestDet] fetch error:', e);
    } finally {
      setPestLoading(false);
    }
  };

  const fetchImageStats = async (filename) => {
    try {
      const config = JSON.parse(localStorage.getItem("analysisConfig") || "{}");
      let outputDir = config.outputFolder || "";
      if (config.boundaryName) {
        const safeName = config.boundaryName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/ /g, '_');
        outputDir += '/' + safeName;
      }
      const resp = await fetch(`http://127.0.0.1:5000/api/image-stats?filename=${filename}&output_dir=${encodeURIComponent(outputDir)}`);
      const data = await resp.json();
      if (data.status === "success") {
        setImgStats(data);
      }
    } catch (err) {
      console.error("Error fetching image stats:", err);
    }
  };

  const handleBandChange = (mapId, channel, newBand) => {
    const currentCombo = mapId === 'A' ? activeBandsA : activeBandsB;
    const currentR = getBandFromCombo(currentCombo, 'R');
    const currentG = getBandFromCombo(currentCombo, 'G');
    const currentB = getBandFromCombo(currentCombo, 'B');

    let nextR = currentR, nextG = currentG, nextB = currentB;
    if (channel === 'R') nextR = newBand;
    if (channel === 'G') nextG = newBand;
    if (channel === 'B') nextB = newBand;

    const newCombo = makeCustomCombo(nextR, nextG, nextB);
    if (mapId === 'A') {
      setActiveBandsA(newCombo);
      if (!compareMode) {
        setActiveBands(newCombo);
      }
    } else {
      setActiveBandsB(newCombo);
    }
  };

  const handleOpenMetadata = async () => {
    if (!selectedImgA) return;
    setMetadataModalOpen(true);
    setMetadataLoading(true);
    try {
      const config = JSON.parse(localStorage.getItem("analysisConfig") || "{}");
      let outputDir = config.outputFolder || "";
      if (config.boundaryName) {
        const safeName = config.boundaryName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/ /g, '_');
        outputDir += '/' + safeName;
      }
      const resp = await fetch(`http://127.0.0.1:5000/api/image-metadata?filename=${selectedImgA.filename}&output_dir=${encodeURIComponent(outputDir)}`);
      const data = await resp.json();
      if (data.status === "success") {
        setSelectedImgMetadata(data.metadata);
      } else {
        setSelectedImgMetadata(null);
      }
    } catch (err) {
      console.error("Error fetching image metadata:", err);
      setSelectedImgMetadata(null);
    }
    setMetadataLoading(false);
  };

  const handleSliderMouseDown = (e) => {
    e.stopPropagation();
    if (e.cancelable) {
      e.preventDefault();
    }
    setIsDraggingSlider(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingSlider) return;
      const swipeContainer = document.getElementById("swipe-container");
      if (swipeContainer) {
        const rect = swipeContainer.getBoundingClientRect();
        if (blenderStyle === 'swipe-both') {
          const clientX = e.clientX || (e.touches && e.touches[0].clientX);
          const clientY = e.clientY || (e.touches && e.touches[0].clientY);
          if (clientX === undefined || clientY === undefined) return;

          const posX = clientX - rect.left;
          const posY = clientY - rect.top;

          let percentX = (posX / rect.width) * 100;
          let percentY = (posY / rect.height) * 100;

          if (percentX < 0) percentX = 0;
          if (percentX > 100) percentX = 100;
          if (percentY < 0) percentY = 0;
          if (percentY > 100) percentY = 100;

          setSliderPercent(Math.round(percentX));
          setSliderPercentY(Math.round(percentY));
        } else if (blenderStyle === 'swipe-vertical') {
          const clientY = e.clientY || (e.touches && e.touches[0].clientY);
          if (clientY === undefined) return;
          const posY = clientY - rect.top;
          let percent = (posY / rect.height) * 100;
          if (percent < 0) percent = 0;
          if (percent > 100) percent = 100;
          setSliderPercent(Math.round(percent));
        } else {
          const clientX = e.clientX || (e.touches && e.touches[0].clientX);
          if (clientX === undefined) return;
          const posX = clientX - rect.left;
          let percent = (posX / rect.width) * 100;
          if (percent < 0) percent = 0;
          if (percent > 100) percent = 100;
          setSliderPercent(Math.round(percent));
        }
      }
    };
    const handleMouseUp = () => {
      setIsDraggingSlider(false);
    };

    if (isDraggingSlider) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("touchmove", handleMouseMove);
      window.addEventListener("touchend", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleMouseMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [isDraggingSlider, blenderStyle]);

  useEffect(() => {
    if (selectedImgA) {
      fetchImageStats(selectedImgA.filename);
    } else if (satelliteImages.length > 0) {
      fetchImageStats(satelliteImages[0].filename);
    }
  }, [selectedImgA, satelliteImages]);

  useEffect(() => {
    if (arcgisMode) {
      setShowMasks(false);
    } else {
      setShowMasks(true);
    }
  }, [arcgisMode]);





  useEffect(() => {
    const rawGeo = localStorage.getItem("geoData");
    const config = JSON.parse(localStorage.getItem("analysisConfig") || "{}");
    if (rawGeo) setGeoData(JSON.parse(rawGeo));
    if (config) setAnalysisInfo({
      season: config.season?.toUpperCase() || "KHARIF",
      year: config.year || "2024",
      boundaryName: config.boundaryName || "Target Sector"
    });

    fetchFinalResults();
    fetchSatelliteImages();
    fetchWeatherPatterns();

    // Sync theme
    const savedTheme = localStorage.getItem("workspace-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

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

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    localStorage.setItem("workspace-theme", newTheme);
  };

  // Auto-sweep blender logic
  useEffect(() => {
    let interval;
    if (isSweeping) {
      let direction = 1;
      interval = setInterval(() => {
        setBlendRatio(prev => {
          let next = prev + 0.02 * direction;
          if (next >= 1) {
            next = 1;
            direction = -1;
          } else if (next <= 0) {
            next = 0;
            direction = 1;
          }
          return parseFloat(next.toFixed(2));
        });
        setSliderPercent(prev => {
          let next = prev + 2 * direction;
          if (next >= 100) {
            next = 100;
            direction = -1;
          } else if (next <= 0) {
            next = 0;
            direction = 1;
          }
          return next;
        });
      }, 30);
    }
    return () => clearInterval(interval);
  }, [isSweeping]);

  const fetchSatelliteImages = async () => {
    try {
      const config = JSON.parse(localStorage.getItem("analysisConfig") || "{}");
      let outputDir = config.outputFolder || "";
      if (config.boundaryName) {
        const safeName = config.boundaryName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/ /g, '_');
        outputDir += '/' + safeName;
      }
      const season = config.season || 'rabi';
      const resp = await fetch(`http://127.0.0.1:5000/api/satellite-images?output_dir=${encodeURIComponent(outputDir)}&season=${season}`);
      const data = await resp.json();
      if (data.status === "success") {
        setSatelliteImages(data.images);
        if (data.images.length > 0) {
          if (data.images.length > 1) {
            setSelectedImgB(data.images[1]);
          } else {
            setSelectedImgB(data.images[0]);
          }
        }
      }
    } catch (err) { console.error("Error fetching satellite images:", err); }
  };

  const fetchFinalResults = async () => {
    try {
      const config = JSON.parse(localStorage.getItem("analysisConfig") || "{}");
      let outputDir = config.outputFolder || "";
      if (config.boundaryName) {
        const safeName = config.boundaryName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/ /g, '_');
        outputDir += '/' + safeName;
      }
      const resp = await fetch(`http://127.0.0.1:5000/api/results?output_dir=${encodeURIComponent(outputDir)}`);
      const data = await resp.json();
      if (data.status === "success") {
        setResultsData(data);
      }
    } catch (err) { console.error(err); }
  };

  const fetchRunsList = async () => {
    setLoadingRuns(true);
    try {
      const resp = await fetch("http://127.0.0.1:5000/api/runs");
      const data = await resp.json();
      if (data.status === "success") {
        setRunsList(data.runs || []);
      }
    } catch (e) {
      console.error("Error fetching runs:", e);
    }
    setLoadingRuns(false);
  };

  const handleDatabaseTab = () => {
    setActiveWorkspace('database');
    setShowClassification(false);
    fetchRunsList();
  };

  const handleLoadRun = async (runId) => {
    try {
      const resp = await fetch(`http://127.0.0.1:5000/api/runs/${runId}`);
      const data = await resp.json();
      if (data.status === "success") {
        setResultsData(data);

        if (data.aoi_geojson) {
          setGeoData(data.aoi_geojson);
          localStorage.setItem("geoData", JSON.stringify(data.aoi_geojson));
        } else {
          setGeoData(null);
          localStorage.removeItem("geoData");
        }

        setAnalysisInfo({
          season: data.season?.toUpperCase() || "RABI",
          year: data.year?.toString() || "2026",
          boundaryName: data.boundary_name || "Loaded AOI"
        });

        localStorage.setItem("analysisConfig", JSON.stringify({
          season: data.season,
          year: data.year?.toString(),
          boundaryName: data.boundary_name,
          outputFolder: data.output_dir
        }));

        // Go to overview of this loaded run
        setActiveWorkspace('overview');
        fetchSatelliteImages();
        fetchWeatherPatterns();
      }
    } catch (e) {
      console.error("Error loading run:", e);
      alert("Error loading run: " + e.message);
    }
  };

  const handleDeleteRun = async (runId, e) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this run from the database? (Note: actual folders on disk will NOT be deleted).")) {
      return;
    }
    try {
      const resp = await fetch(`http://127.0.0.1:5000/api/runs/${runId}`, {
        method: "DELETE"
      });
      const data = await resp.json();
      if (data.status === "success") {
        setRunsList(prev => prev.filter(r => r.id !== runId));
      }
    } catch (err) {
      console.error("Error deleting run:", err);
      alert("Error deleting run: " + err.message);
    }
  };

  const SidebarButton = ({ icon: Icon, label, active, id, onClick }) => (
    <button
      onClick={() => onClick(id)}
      title={isSidebarCollapsed ? label : undefined}
      className={`flex items-center rounded-xl mx-2 transition-all duration-300 relative group cursor-pointer overflow-hidden
        ${isSidebarCollapsed ? 'justify-center p-2.5 h-10 gap-0' : 'gap-3.5 px-4 py-2.5'}
        ${active
          ? 'text-[var(--accent-color)] bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 shadow-[0_0_12px_var(--accent-glow)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--border-color)]/10 border border-transparent'}`}
      style={{ width: isSidebarCollapsed ? '40px' : 'calc(100% - 16px)', height: '40px' }}
    >
      {active && (
        <div
          className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-r-md bg-[var(--accent-color)] shadow-[0_0_8px_var(--accent-color)]"
        />
      )}
      <Icon size={14} className={active ? 'text-[var(--accent-color)] flex-shrink-0' : 'text-[var(--text-muted)] group-hover:text-[var(--text-main)] transition-colors flex-shrink-0'} />
      <span className={`text-[10px] font-bold font-space uppercase tracking-wider whitespace-nowrap overflow-hidden transition-all duration-300 flex-shrink-0
        ${isSidebarCollapsed ? 'max-w-0 opacity-0 ml-0' : 'max-w-[180px] opacity-100 ml-0.5'}`}>
        {label}
      </span>
    </button>
  );

  const handleClassificationTab = async () => {
    setActiveWorkspace('crop');
    setShowClassification(true);
    if (!resultsData?.crop_stats) {
      setClassifying(true);
      try {
        const config = JSON.parse(localStorage.getItem("analysisConfig") || "{}");
        let outputDir = config.outputFolder || "";
        if (config.boundaryName) {
          const safeName = config.boundaryName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/ /g, '_');
          outputDir += '/' + safeName;
        }
        const season = config.season || 'rabi';
        const resp = await fetch(`http://127.0.0.1:5000/api/reclassify?output_dir=${encodeURIComponent(outputDir)}&season=${season}`);
        const data = await resp.json();
        if (data.status === "success") {
          await fetchFinalResults();
        }
      } catch (e) { console.error("[Classification] Fetch error:", e); }
      setClassifying(false);
    }
  };

  const renderDayWeatherRow = (day, idx) => {
    let Icon = Sun;
    let iconColor = "text-amber-500";
    let desc = "Clear Sky";

    const c = day.weather_code;
    if (c === 0) {
      Icon = Sun;
      iconColor = "text-amber-500";
      desc = "Clear Sky";
    } else if ([1, 2, 3].includes(c)) {
      Icon = Cloud;
      iconColor = "text-slate-400";
      desc = "Partly Cloudy";
    } else if ([45, 48].includes(c)) {
      Icon = Cloud;
      iconColor = "text-slate-500";
      desc = "Foggy";
    } else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(c)) {
      Icon = CloudRain;
      iconColor = "text-sky-400";
      desc = c >= 63 ? "Heavy Rain" : "Rain Showers";
    } else if ([95, 96, 99].includes(c)) {
      Icon = CloudLightning;
      iconColor = "text-indigo-400 animate-pulse";
      desc = "Thunderstorms";
    }

    const dayLabels = ["2 Days Before Scan", "1 Day Before Scan", "Scene Capture Date"];
    const isCaptureDay = idx === 2;

    return (
      <div
        key={`row-day-${day.date}`}
        className={`bg-[var(--bg-primary)]/30 border border-[var(--border-color)]/45 rounded-xl p-2.5 flex flex-col gap-2 text-[9px] font-mono relative overflow-hidden group transition-all duration-300
          ${isCaptureDay ? 'border-[var(--accent-color)]/25 bg-[var(--accent-glow)]/5' : 'border-[var(--border-color)]/30'}`}
      >
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <span className={`text-[7px] uppercase font-bold tracking-wider ${isCaptureDay ? 'text-[var(--accent-color)]' : 'text-[var(--text-muted)]'}`}>
              {dayLabels[idx]}
            </span>
            <span className="text-[9.5px] font-bold text-[var(--text-main)] mt-0.5">
              {day.formatted_date}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[7px] text-[var(--text-muted)] bg-[var(--bg-primary)]/50 px-1.5 py-0.5 rounded uppercase font-semibold">
              {desc}
            </span>
            <Icon size={12} className={`${iconColor}`} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[8px] text-[var(--text-muted)] leading-normal mt-0.5 border-t border-[var(--border-color)]/20 pt-1.5">
          <div className="flex justify-between">
            <span>Temp:</span>
            <span className="font-bold text-[var(--text-main)]">{day.temp_min}°-{day.temp_max}°C</span>
          </div>
          <div className="flex justify-between">
            <span>Rain:</span>
            <span className={`font-bold ${day.precipitation > 0 ? 'text-sky-400' : 'text-[var(--text-main)]'}`}>{day.precipitation} mm</span>
          </div>
          <div className="flex justify-between">
            <span>Humidity:</span>
            <span className="font-bold text-[var(--text-main)]">{day.humidity}%</span>
          </div>
          <div className="flex justify-between">
            <span>Wind:</span>
            <span className="font-bold text-[var(--text-main)]">{day.wind_speed} km/h</span>
          </div>
        </div>
      </div>
    );
  };

  const mapPadding = useMemo(() => {
    return getMapPadding(arcgisMode, isSidebarCollapsed, compareMode, satelliteImages.length > 0);
  }, [arcgisMode, isSidebarCollapsed, compareMode, satelliteImages.length]);
  const currentBands = compareMode ? (hoveredMap === 'B' ? activeBandsB : activeBandsA) : activeBandsA;

  if (arcgisMode) {
    return (
      <div className={`h-screen w-screen bg-[var(--bg-primary)] overflow-hidden flex flex-col relative select-none theme-${theme}`}>
        {/* ── MINIMAL INTEL HEADBAR (Matched to Home Header style) ────── */}
        <header className="h-14 border-b border-[var(--border-color)] bg-[var(--glass-surface)] backdrop-blur-md px-6 flex items-center justify-between z-50 flex-shrink-0 relative">
          <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--border-color)] to-transparent opacity-60" />

          {/* Left: Navigation and Logo & Software Title */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                setArcgisMode(false);
                setSelectedImgA(null);
                setSelectedImgB(null);
              }}
              className="group flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors border border-[var(--border-color)] hover:border-[var(--accent-color)]/30 px-2.5 py-1 rounded-lg bg-[var(--border-color)]/10 cursor-pointer text-[10px] font-mono uppercase tracking-wider font-semibold"
            >
              <ArrowLeft size={11} className="group-hover:-translate-x-0.5 transition-transform" />
              <span>Dashboard</span>
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

        {/* ── IMAGERY BAR (Presets / Blenders) ────────────────────────── */}
        <div className="h-[76px] bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex flex-col justify-center px-6 z-40 flex-shrink-0">
          <div className="flex items-center gap-6 overflow-x-auto py-1">
            {/* Band Combinations Preset Group */}
            <div className="flex flex-col border-r border-[var(--border-color)] pr-6 justify-center gap-1">
              <span className="text-[8px] text-[var(--text-muted)] font-mono uppercase tracking-wider leading-none">Band Presets</span>
              <div className="flex gap-2">
                {[
                  { id: 'natural', name: 'Natural Color', desc: 'R:B4 G:B3 B:B2' },
                  { id: 'false_color', name: 'Infrared Veg', desc: 'R:B8 G:B4 B:B3' },
                  { id: 'swir', name: 'SWIR combo', desc: 'R:B11 G:B8 B:B4' },
                  { id: 'agriculture', name: 'Agri Preset', desc: 'R:B11 G:B8 B:B3' },
                  { id: 'ndvi', name: 'NDVI Index', desc: 'Spectral Ratio' },
                  { id: 'ndwi', name: 'NDWI Index', desc: 'Water Index' },
                ].map(combo => (
                  <button
                    key={combo.id}
                    onClick={() => {
                      if (compareMode) {
                        if (hoveredMap === 'B') {
                          setActiveBandsB(combo.id);
                        } else {
                          setActiveBandsA(combo.id);
                        }
                      } else {
                        setActiveBands(combo.id);
                        setActiveBandsA(combo.id);
                        setActiveBandsB(combo.id);
                      }
                    }}
                    title={combo.desc}
                    className={`px-3 py-1 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-center min-w-[90px]
                      ${currentBands === combo.id
                        ? 'bg-[var(--accent-glow)] border-[var(--accent-color)] text-[var(--accent-color)] shadow-sm'
                        : 'bg-[var(--border-color)]/10 border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--accent-color)]/30 hover:bg-[var(--border-color)]/20'}`}
                  >
                    <span className="text-[9.5px] font-bold leading-tight font-space">{combo.name}</span>
                    <span className="text-[7.5px] opacity-75 font-mono mt-0.5 truncate max-w-[80px]">{combo.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Comparison Mode Group */}
            <div className="flex flex-col justify-center gap-1">
              <span className="text-[8px] text-[var(--text-muted)] font-mono uppercase tracking-wider leading-none">Comparison Mode</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCompareMode(!compareMode)}
                  className={`px-3.5 py-2 rounded-lg border text-[9.5px] font-bold flex items-center gap-2 cursor-pointer transition-all
                    ${compareMode
                      ? 'bg-[var(--accent-glow)] border-[var(--accent-color)] text-[var(--accent-color)]'
                      : 'bg-[var(--border-color)]/10 border-[var(--border-color)] text-[var(--text-muted)] hover:border-[var(--accent-color)]/30 hover:bg-[var(--border-color)]/20'}`}
                >
                  <Sliders size={11} />
                  {compareMode ? 'Blender Active' : 'Enable Image Blender'}
                </button>

                {compareMode && (
                  <div className="flex items-center gap-1 bg-[var(--bg-primary)]/50 border border-[var(--border-color)] p-1 rounded-xl text-[9px] font-mono select-none shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]">
                    {/* Layer A Pill */}
                    <button
                      onClick={() => setHoveredMap('A')}
                      title="Set configuration focus to Layer A"
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-300 cursor-pointer outline-none select-none
                        ${hoveredMap === 'A'
                          ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-400 font-bold shadow-[0_0_10px_rgba(16,185,129,0.15)] scale-105'
                          : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--border-color)]/10'}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${hoveredMap === 'A' ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_#10b981]' : 'bg-slate-600'}`} />
                      <span>Layer A: {selectedImgA?.date || 'None'}</span>
                    </button>

                    <div className="w-[1px] h-3.5 bg-[var(--border-color)]/50 mx-0.5" />

                    {/* Layer B Pill */}
                    <button
                      onClick={() => setHoveredMap('B')}
                      title="Set configuration focus to Layer B"
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-300 cursor-pointer outline-none select-none
                        ${hoveredMap === 'B'
                          ? 'bg-cyan-500/10 border-cyan-500/35 text-cyan-400 font-bold shadow-[0_0_10px_rgba(6,182,212,0.15)] scale-105'
                          : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--border-color)]/10'}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${hoveredMap === 'B' ? 'bg-cyan-400 animate-pulse shadow-[0_0_6px_#06b6d4]' : 'bg-slate-600'}`} />
                      <span>Layer B: {selectedImgB?.date || 'None'}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        o
        {/* ── WORKSPACE VIEWPORT ──────────────────────────────────────── */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* Left Contents Sidebar */}
          <aside className="w-72 bg-[var(--card-bg)] border-r border-[var(--border-color)] flex flex-col flex-shrink-0 select-none">
            <div className="p-3 bg-[var(--border-color)]/10 border-b border-[var(--border-color)] flex items-center justify-between">
              <span className="text-[9px] font-bold text-[var(--text-main)] font-space uppercase tracking-wider">CONTENTS (DRAWING ORDER)</span>
              <span className="text-[8px] font-mono text-[var(--text-muted)]">2D VIEW</span>
            </div>

            {/* Layers List */}
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 scrollbar-hide text-[var(--text-main)]">
              {/* Root View node */}
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-main)] pb-2 border-b border-[var(--border-color)]/60">
                <input type="checkbox" checked={true} readOnly className="w-3 h-3 rounded bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--accent-color)] focus:ring-0 cursor-default" />
                <Globe size={13} className="text-[var(--accent-color)]" />
                <span>Geospatial Raster Stack</span>
              </div>

              {/* List of images */}
              <div className="flex flex-col gap-2 mt-1">
                {satelliteImages.map((img) => {
                  const isA = selectedImgA?.filename === img.filename;
                  const isB = compareMode && selectedImgB?.filename === img.filename;
                  const isActive = isA || isB;

                  return (
                    <div key={img.filename} className="flex flex-col">
                      {/* Image Layer Card */}
                      <div
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", img.filename);
                          setIsDragging(true);
                        }}
                        onDragEnd={() => setIsDragging(false)}
                        onClick={() => {
                          if (compareMode) {
                            if (hoveredMap === 'B') {
                              setSelectedImgB(img);
                            } else {
                              setSelectedImgA(img);
                            }
                          } else {
                            setSelectedImgA(img);
                          }
                        }}
                        className={`p-2.5 rounded-xl border flex flex-col gap-1.5 transition-all duration-300 cursor-grab active:cursor-grabbing relative group
                          ${isA && isB
                            ? 'border-amber-500 bg-amber-500/10 shadow-[0_0_12px_rgba(245,158,11,0.25)] text-[var(--text-main)]'
                            : isA
                              ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.25)] text-[var(--text-main)]'
                              : isB
                                ? 'border-cyan-500 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.25)] text-[var(--text-main)]'
                                : 'bg-[var(--bg-primary)]/45 border-[var(--border-color)] hover:border-[var(--accent-color)]/30 text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              checked={isActive}
                              onChange={(e) => {
                                e.stopPropagation();
                                if (isActive) {
                                  if (isA) setSelectedImgA(null);
                                  if (isB) setSelectedImgB(null);
                                } else {
                                  setSelectedImgA(img);
                                  setCompareMode(false);
                                }
                              }}
                              className="w-3.5 h-3.5 rounded bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--accent-color)] focus:ring-0 cursor-pointer"
                            />
                            <span className={`text-[10px] truncate font-bold font-space ${isA ? 'text-emerald-400 font-extrabold' : isB ? 'text-cyan-400 font-extrabold' : 'text-[var(--text-main)]'}`} title={img.filename}>
                              {img.date}
                            </span>
                          </div>

                          {/* Dedicated selector pill buttons */}
                          <div className="flex items-center gap-1.5 z-10">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isA) {
                                  setSelectedImgA(null);
                                } else {
                                  setSelectedImgA(img);
                                }
                              }}
                              title={isA ? "Deselect Map A" : "Set as Map A"}
                              className={`w-5 h-5 rounded-md text-[9px] font-extrabold flex items-center justify-center border transition-all duration-300 cursor-pointer select-none
                                ${isA
                                  ? 'bg-emerald-500 border-emerald-400 text-slate-950 shadow-[0_0_8px_rgba(16,185,129,0.5)] scale-105'
                                  : 'border-emerald-500/30 text-emerald-500/60 bg-emerald-950/5 hover:bg-emerald-500 hover:text-slate-950 hover:border-emerald-400 opacity-60 hover:opacity-100'}`}
                            >
                              A
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (isB) {
                                  setSelectedImgB(null);
                                } else {
                                  setSelectedImgB(img);
                                  setCompareMode(true);
                                }
                              }}
                              title={isB ? "Deselect Map B" : "Set as Map B"}
                              className={`w-5 h-5 rounded-md text-[9px] font-extrabold flex items-center justify-center border transition-all duration-300 cursor-pointer select-none
                                ${isB
                                  ? 'bg-cyan-500 border-cyan-400 text-slate-950 shadow-[0_0_8px_rgba(6,182,212,0.5)] scale-105'
                                  : 'border-cyan-500/30 text-cyan-500/60 bg-cyan-950/5 hover:bg-cyan-500 hover:text-slate-950 hover:border-cyan-400 opacity-60 hover:opacity-100'}`}
                            >
                              B
                            </button>
                          </div>
                        </div>

                        {/* Band details line */}
                        <div className="flex items-center justify-between text-[7.5px] font-mono text-[var(--text-muted)] border-t border-[var(--border-color)]/40 pt-1">
                          <span>bands: {isActive ? (isA ? activeBandsA : activeBandsB).toUpperCase() : 'NATURAL'}</span>
                          <span>SENTINEL-2 10M</span>
                        </div>
                      </div>

                      {/* Nest band selector dropdowns directly underneath if this image is selected */}
                      {isActive && (
                        <div className="ml-5 mt-1 mb-2 pl-3 border-l border-[var(--border-color)] flex flex-col gap-1.5 bg-[var(--bg-primary)]/20 p-2 rounded-lg border border-[var(--border-color)]/40">
                          {/* Red Channel */}
                          <div className="flex items-center gap-2 text-[9.5px] justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded bg-red-500 border border-red-700 shadow-[0_0_4px_rgba(239,68,68,0.4)]" />
                              <span className="text-[var(--text-muted)]">Red:</span>
                            </div>
                            <select
                              value={getBandFromCombo(isA ? activeBandsA : activeBandsB, 'R')}
                              onChange={(e) => handleBandChange(isA ? 'A' : 'B', 'R', parseInt(e.target.value))}
                              className="bg-[var(--bg-primary)]/80 border border-[var(--border-color)] text-[var(--text-main)] text-[9px] rounded px-1 py-0.5 focus:border-[var(--accent-color)] outline-none w-26 cursor-pointer font-sans"
                            >
                              <option value={1}>Band 4 (Red)</option>
                              <option value={2}>Band 3 (Green)</option>
                              <option value={3}>Band 2 (Blue)</option>
                              <option value={4}>Band 8 (NIR)</option>
                              <option value={5}>Band 11 (SWIR 1)</option>
                              <option value={6}>Band 1 (Coastal Aerosol)</option>
                              <option value={7}>Band 5 (Red Edge 1)</option>
                              <option value={8}>Band 6 (Red Edge 2)</option>
                              <option value={9}>Band 7 (Red Edge 3)</option>
                              <option value={10}>Band 8A (Narrow NIR)</option>
                              <option value={11}>Band 9 (Water Vapour)</option>
                              <option value={12}>Band 12 (SWIR 2)</option>
                            </select>
                          </div>

                          {/* Green Channel */}
                          <div className="flex items-center gap-2 text-[9.5px] justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded bg-green-500 border border-green-700 shadow-[0_0_4px_rgba(34,197,94,0.4)]" />
                              <span className="text-[var(--text-muted)]">Green:</span>
                            </div>
                            <select
                              value={getBandFromCombo(isA ? activeBandsA : activeBandsB, 'G')}
                              onChange={(e) => handleBandChange(isA ? 'A' : 'B', 'G', parseInt(e.target.value))}
                              className="bg-[var(--bg-primary)]/80 border border-[var(--border-color)] text-[var(--text-main)] text-[9px] rounded px-1 py-0.5 focus:border-[var(--accent-color)] outline-none w-26 cursor-pointer font-sans"
                            >
                              <option value={1}>Band 4 (Red)</option>
                              <option value={2}>Band 3 (Green)</option>
                              <option value={3}>Band 2 (Blue)</option>
                              <option value={4}>Band 8 (NIR)</option>
                              <option value={5}>Band 11 (SWIR 1)</option>
                              <option value={6}>Band 1 (Coastal Aerosol)</option>
                              <option value={7}>Band 5 (Red Edge 1)</option>
                              <option value={8}>Band 6 (Red Edge 2)</option>
                              <option value={9}>Band 7 (Red Edge 3)</option>
                              <option value={10}>Band 8A (Narrow NIR)</option>
                              <option value={11}>Band 9 (Water Vapour)</option>
                              <option value={12}>Band 12 (SWIR 2)</option>
                            </select>
                          </div>

                          {/* Blue Channel */}
                          <div className="flex items-center gap-2 text-[9.5px] justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded bg-blue-500 border border-blue-700 shadow-[0_0_4px_rgba(59,130,246,0.4)]" />
                              <span className="text-[var(--text-muted)]">Blue:</span>
                            </div>
                            <select
                              value={getBandFromCombo(isA ? activeBandsA : activeBandsB, 'B')}
                              onChange={(e) => handleBandChange(isA ? 'A' : 'B', 'B', parseInt(e.target.value))}
                              className="bg-[var(--bg-primary)]/80 border border-[var(--border-color)] text-[var(--text-main)] text-[9px] rounded px-1 py-0.5 focus:border-[var(--accent-color)] outline-none w-26 cursor-pointer font-sans"
                            >
                              <option value={1}>Band 4 (Red)</option>
                              <option value={2}>Band 3 (Green)</option>
                              <option value={3}>Band 2 (Blue)</option>
                              <option value={4}>Band 8 (NIR)</option>
                              <option value={5}>Band 11 (SWIR 1)</option>
                              <option value={6}>Band 1 (Coastal Aerosol)</option>
                              <option value={7}>Band 5 (Red Edge 1)</option>
                              <option value={8}>Band 6 (Red Edge 2)</option>
                              <option value={9}>Band 7 (Red Edge 3)</option>
                              <option value={10}>Band 8A (Narrow NIR)</option>
                              <option value={11}>Band 9 (Water Vapour)</option>
                              <option value={12}>Band 12 (SWIR 2)</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Overlays Section */}
              <div className="flex flex-col gap-1.5 mt-3 pt-2.5 border-t border-[var(--border-color)]/60">
                <div className="flex items-center gap-2 text-[10.5px] font-semibold text-[var(--text-main)]">
                  <input type="checkbox" checked={showMasks} onChange={() => setShowMasks(!showMasks)} className="w-3 h-3 rounded bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--accent-color)] focus:ring-0 cursor-pointer" />
                  <span>Vector & Raster Overlays</span>
                </div>

                <div className="ml-4 flex flex-col gap-1.5">
                  {resultsData?.run_type === 'combined' ? (
                    <>
                      <div className="flex items-center gap-2 text-[9.5px] text-[var(--text-muted)] hover:text-[var(--text-main)]">
                        <input
                          type="checkbox"
                          checked={showMasks && showCropOverlay}
                          onChange={() => {
                            setShowMasks(true);
                            setShowCropOverlay(!showCropOverlay);
                          }}
                          className="w-3 h-3 rounded bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--accent-color)] focus:ring-0 cursor-pointer"
                        />
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                        <span>Crop Classification Map</span>
                      </div>
                      <div className="flex items-center gap-2 text-[9.5px] text-[var(--text-muted)] hover:text-[var(--text-main)]">
                        <input
                          type="checkbox"
                          checked={showMasks && showLulcOverlay}
                          onChange={() => {
                            setShowMasks(true);
                            setShowLulcOverlay(!showLulcOverlay);
                          }}
                          className="w-3 h-3 rounded bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--accent-color)] focus:ring-0 cursor-pointer"
                        />
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>LULC Classification Map</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-[9.5px] text-[var(--text-muted)] hover:text-[var(--text-main)]">
                        <input type="checkbox" checked={showMasks && !showClassification} onChange={() => { setShowMasks(true); setShowClassification(false); }} className="w-3 h-3 rounded bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--accent-color)] focus:ring-0 cursor-pointer" />
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{resultsData?.run_type === 'lulc' ? 'Refined Cropland (LULC)' : 'Agri Extraction Mask'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[9.5px] text-[var(--text-muted)] hover:text-[var(--text-main)]">
                        <input type="checkbox" checked={showMasks && showClassification} onChange={() => { setShowMasks(true); handleClassificationTab(); }} className="w-3 h-3 rounded bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--accent-color)] focus:ring-0 cursor-pointer" />
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                        <span>{resultsData?.run_type === 'lulc' ? 'LULC Map' : 'Crop Classification'}</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-2 text-[9.5px] text-[var(--text-muted)]">
                    <input type="checkbox" checked={!!geoData} readOnly className="w-3 h-3 rounded bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--accent-color)] focus:ring-0 cursor-default" />
                    <span className="w-1.5 h-1.5 rounded border border-yellow-500 border-dashed" />
                    <span>AOI boundary area</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-[var(--border-color)]/5 border-t border-[var(--border-color)] text-[8px] text-[var(--text-muted)] font-mono flex flex-col gap-0.5">
              <span>* Click layer card to set as active</span>
              <span>* Custom channel bands stretch screen colors</span>
            </div>
          </aside>

          {/* Right Map Viewport */}
          <div
            id="swipe-container"
            className="flex-1 relative bg-[var(--bg-primary)] overflow-hidden"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const filename = e.dataTransfer.getData("text/plain");
              const img = satelliteImages.find(i => i.filename === filename);
              if (img) {
                const rect = e.currentTarget.getBoundingClientRect();
                const dropX = e.clientX - rect.left;
                if (dropX > rect.width / 2) {
                  setSelectedImgB(img);
                  setCompareMode(true);
                } else {
                  setSelectedImgA(img);
                }
              }
            }}
          >
            {/* FLOATING TOP-LEFT VIEWPORT TOOLBAR (WITH LABELS) */}
            <div className="absolute top-3 left-3 z-[1000] bg-[var(--card-bg)]/90 backdrop-blur-md border border-[var(--border-color)] rounded-xl p-1.5 shadow-2xl flex items-center gap-1 select-none pointer-events-auto">
              <button
                onClick={() => {
                  setFitTriggerA(prev => prev + 1);
                  setFitTriggerB(prev => prev + 1);
                  setFitTriggerStandard(prev => prev + 1);
                }}
                title="Fit Study Area to Frame"
                className="px-2 py-1.5 hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded-lg transition-all cursor-pointer flex items-center gap-1.5 border-0 outline-none text-[9px] font-bold font-space uppercase tracking-wider"
              >
                <Maximize size={12} />
                <span>Fit Frame</span>
              </button>

              <button
                onClick={() => {
                  if (resultsData?.composite_bounds) {
                    const [[lat1, lon1], [lat2, lon2]] = resultsData.composite_bounds;
                    setSyncCenter([(lat1 + lat2) / 2, (lon1 + lon2) / 2]);
                    setSyncZoom(13);
                  } else if (geoData) {
                    const geoJsonLayer = L.geoJSON(geoData);
                    if (geoJsonLayer.getBounds().isValid()) {
                      const center = geoJsonLayer.getBounds().getCenter();
                      setSyncCenter([center.lat, center.lng]);
                      setSyncZoom(13);
                    }
                  } else {
                    setSyncCenter([26.45, 74.64]);
                    setSyncZoom(13);
                  }
                }}
                title="Reset view to default center"
                className="px-2 py-1.5 hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded-lg transition-all cursor-pointer flex items-center gap-1.5 border-0 outline-none text-[9px] font-bold font-space uppercase tracking-wider"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>

              <button
                onClick={() => setSyncZoom(prev => Math.min(18, prev + 1))}
                title="Zoom In"
                className="px-2 py-1.5 hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded-lg transition-all cursor-pointer flex items-center gap-1.5 border-0 outline-none text-[9px] font-bold font-space uppercase tracking-wider"
              >
                <ZoomIn size={12} />
                <span>Zoom In</span>
              </button>

              <button
                onClick={() => setSyncZoom(prev => Math.max(2, prev - 1))}
                title="Zoom Out"
                className="px-2 py-1.5 hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded-lg transition-all cursor-pointer flex items-center gap-1.5 border-0 outline-none text-[9px] font-bold font-space uppercase tracking-wider"
              >
                <ZoomOut size={12} />
                <span>Zoom Out</span>
              </button>

              <button
                onClick={() => {
                  setInquiryActive(!inquiryActive);
                  if (inquiryActive) setInquiryPoint(null);
                }}
                title="Inquire Coordinates & Info"
                className={`px-2 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 border text-[9px] font-bold font-space uppercase tracking-wider ${inquiryActive
                  ? 'bg-[var(--accent-glow)] border-[var(--accent-color)] text-[var(--accent-color)]'
                  : 'hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] border-transparent text-[var(--text-muted)]'
                  }`}
              >
                <Crosshair size={12} />
                <span>Inquire</span>
              </button>

              <button
                onClick={handleOpenMetadata}
                title="View Image Header Metadata"
                className="px-2 py-1.5 hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded-lg transition-all cursor-pointer flex items-center gap-1.5 border-0 outline-none text-[9px] font-bold font-space uppercase tracking-wider"
              >
                <FileText size={12} />
                <span>Metadata</span>
              </button>

              <button
                onClick={() => setWeatherModalOpen(true)}
                disabled={!selectedImgA}
                title="View Preceding 3-Day Weather Info"
                className={`px-2 py-1.5 rounded-lg transition-all flex items-center gap-1.5 border text-[9px] font-bold font-space uppercase tracking-wider
                  ${!selectedImgA
                    ? 'opacity-35 cursor-not-allowed border-transparent text-[var(--text-muted)]/50'
                    : 'hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] border-transparent text-[var(--text-muted)] cursor-pointer'
                  }`}
              >
                <CloudRain size={12} />
                <span>Weather Info</span>
              </button>

              <div className="w-[1px] h-4 bg-[var(--border-color)] mx-1.5" />

              <button
                onClick={() => setCompareMode(!compareMode)}
                title="Toggle Image Blender"
                className={`px-2 py-1.5 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 border text-[9px] font-bold font-space uppercase tracking-wider ${compareMode
                  ? 'bg-[var(--accent-glow)] border-[var(--accent-color)] text-[var(--accent-color)]'
                  : 'hover:bg-[var(--border-color)] hover:text-[var(--accent-color)] border-transparent text-[var(--text-muted)]'
                  }`}
              >
                <Sliders size={12} />
                <span>Compare</span>
              </button>

              {compareMode && (
                <div className="flex items-center gap-0.5 ml-1 bg-[var(--border-color)]/20 border border-[var(--border-color)] p-0.5 rounded">
                  <button
                    onClick={() => setBlenderStyle('swipe')}
                    title="Horizontal Swipe Blender Mode"
                    className={`p-1 rounded cursor-pointer transition-all ${blenderStyle === 'swipe'
                      ? 'bg-[var(--accent-color)] text-[var(--bg-primary)] shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                  >
                    <ArrowLeftRight size={12} />
                  </button>
                  <button
                    onClick={() => setBlenderStyle('swipe-vertical')}
                    title="Vertical Swipe Blender Mode"
                    className={`p-1 rounded cursor-pointer transition-all ${blenderStyle === 'swipe-vertical'
                      ? 'bg-[var(--accent-color)] text-[var(--bg-primary)] shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                  >
                    <ArrowLeftRight size={12} className="rotate-90" />
                  </button>
                  <button
                    onClick={() => setBlenderStyle('swipe-both')}
                    title="2D Cross Swipe Mode (Both Horizontal & Vertical)"
                    className={`p-1 rounded cursor-pointer transition-all ${blenderStyle === 'swipe-both'
                      ? 'bg-[var(--accent-color)] text-[var(--bg-primary)] shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                  >
                    <Maximize size={12} />
                  </button>
                  <button
                    onClick={() => setBlenderStyle('split')}
                    title="Split Map Mode"
                    className={`p-1 rounded cursor-pointer transition-all ${blenderStyle === 'split'
                      ? 'bg-[var(--accent-color)] text-[var(--bg-primary)] shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                  >
                    <Layout size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Drag drop hint indicator */}
            {isDragging && (
              <div className="absolute inset-0 bg-[var(--accent-glow)]/10 border-2 border-dashed border-[var(--accent-color)]/70 z-[2000] pointer-events-none flex items-center justify-center">
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] px-5 py-3 rounded-xl flex flex-col items-center gap-1.5 shadow-2xl">
                  <Globe className="text-[var(--accent-color)] animate-spin" size={24} />
                  <span className="text-xs font-bold text-[var(--text-main)]">Drop Here to Load Satellite Layer</span>
                </div>
              </div>
            )}

            {/* Coordinate Inquiry Overlay */}
            {inquiryActive && inquiryPoint && (
              <div className="absolute bottom-3 right-3 z-[1000] bg-[var(--card-bg)] border border-[var(--accent-color)]/30 rounded-xl p-3 font-mono text-[9px] shadow-2xl flex flex-col gap-1 text-[var(--text-main)] min-w-[170px] hover:border-[var(--accent-color)] transition-colors">
                <div className="flex justify-between items-center text-[var(--accent-color)] font-bold border-b border-[var(--border-color)]/60 pb-1 mb-1">
                  <span>COORDINATE INQUIRE</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-color)] animate-ping" />
                </div>
                <div className="flex justify-between"><span className="text-[var(--text-muted)]">LATITUDE:</span><span className="font-semibold">{inquiryPoint.lat.toFixed(6)}° N</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-muted)]">LONGITUDE:</span><span className="font-semibold">{inquiryPoint.lng.toFixed(6)}° E</span></div>
                <div className="flex justify-between"><span className="text-[var(--text-muted)]">ZOOM:</span><span>{syncZoom}</span></div>
                {selectedImgA && <div className="flex justify-between"><span className="text-[var(--text-muted)]">ACTIVE:</span><span className="truncate max-w-[90px]">{selectedImgA.date}</span></div>}
              </div>
            )}

            {!compareMode ? (
              // ── SINGLE MAP WORKSPACE ──
              <div className="w-full h-full" onMouseEnter={() => setHoveredMap('A')}>
                <MapContainer
                  center={syncCenter}
                  zoom={syncZoom}
                  className="h-full w-full"
                  zoomControl={false}
                  dragging={!isDraggingSlider}
                  scrollWheelZoom={true}
                  doubleClickZoom={true}
                  attributionControl={false}
                  style={{ height: '100%', width: '100%', cursor: inquiryActive ? 'crosshair' : '' }}
                >
                  <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                  <LeafletResizeHandler dependency={`${compareMode}-${blenderStyle}-${isSidebarCollapsed}-${arcgisMode}`} />
                  {geoData && <FitBounds data={geoData} padding={mapPadding} />}
                  <SyncView center={syncCenter} zoom={syncZoom} />
                  <MapController fitTrigger={fitTriggerA} bounds={resultsData?.composite_bounds} geoData={geoData} padding={mapPadding} />
                  <MapInquiryListener active={inquiryActive} onInquire={(latlng) => setInquiryPoint(latlng)} />
                  <SyncListener onSync={(c, z) => {
                    setSyncCenter(c);
                    setSyncZoom(z);
                  }} active={hoveredMap === 'A'} />

                  {/* Satellite Layer A */}
                  {selectedImgA && resultsData?.composite_bounds && (
                    <ImageOverlay
                      key={`${selectedImgA.filename}-${activeBandsA}`}
                      url={`${selectedImgA.url}&bands=${activeBandsA}`}
                      bounds={resultsData.composite_bounds}
                      opacity={1}
                      zIndex={15}
                    />
                  )}

                  {/* Classification Masks */}
                  {showMasks && resultsData?.agriculture_url && resultsData?.composite_bounds && (
                    activeWorkspace === 'overview' ||
                    (resultsData?.run_type !== 'combined' && (activeWorkspace === 'crop' || activeWorkspace === 'acre') && !showClassification)
                  ) && (
                      <ImageOverlay url={resultsData.agriculture_url} bounds={resultsData.composite_bounds} opacity={0.85} zIndex={20} />
                    )}

                  {/* Crop classification layer */}
                  {showMasks && (
                    resultsData?.run_type === 'combined'
                      ? (showCropOverlay && (activeWorkspace === 'crop' || activeWorkspace === 'acre'))
                      : ((activeWorkspace === 'crop' || activeWorkspace === 'acre') && resultsData?.run_type !== 'lulc' && showClassification)
                  ) && resultsData?.classification_url && resultsData?.composite_bounds && (
                      <ImageOverlay url={resultsData.classification_url} bounds={resultsData.composite_bounds} opacity={0.85} zIndex={20} />
                    )}

                  {/* LULC classification layer */}
                  {showMasks && (
                    resultsData?.run_type === 'combined'
                      ? (showLulcOverlay && activeWorkspace === 'lulc')
                      : ((activeWorkspace === 'crop' || activeWorkspace === 'acre') && resultsData?.run_type === 'lulc' && showClassification)
                  ) && resultsData?.lulc_classification_url && resultsData?.composite_bounds && (
                      <ImageOverlay url={resultsData.lulc_classification_url} bounds={resultsData.composite_bounds} opacity={0.85} zIndex={21} />
                    )}

                  {/* Vector Boundaries */}
                  {geoData && (
                    <GeoJSON data={geoData} style={() => ({ color: "#fbbf24", weight: 2, fillOpacity: 0, dashArray: "4 6", interactive: false })} />
                  )}
                </MapContainer>
              </div>
            ) : blenderStyle === 'split' ? (
              // ── SPLIT COMPARE MAP WORKSPACE ──
              <div className="w-full h-full flex divide-x-2 divide-[var(--border-color)] z-20">
                {/* Left Map: Layer A */}
                <div
                  className="flex-1 h-full relative"
                  onMouseEnter={() => setHoveredMap('A')}
                >
                  {/* Left Label */}
                  <div className={`absolute top-14 left-3 bg-[var(--card-bg)]/90 backdrop-blur border px-2.5 py-1 rounded text-[9.5px] font-bold text-[var(--accent-color)] z-[1000] flex flex-col gap-0.5 transition-all
                    ${hoveredMap === 'A'
                      ? 'border-[var(--accent-color)] shadow-[0_0_10px_var(--accent-glow)] scale-105'
                      : 'border-[var(--border-color)]'}`}>
                    <span>LAYER A (BASE)</span>
                    <span className="text-[8px] text-[var(--text-muted)] font-normal">{selectedImgA?.date}</span>
                  </div>

                  <MapContainer
                    center={syncCenter}
                    zoom={syncZoom}
                    className="h-full w-full"
                    zoomControl={false}
                    dragging={!isDraggingSlider}
                    scrollWheelZoom={true}
                    doubleClickZoom={true}
                    attributionControl={false}
                    style={{ height: '100%', width: '100%', cursor: inquiryActive ? 'crosshair' : '' }}
                  >
                    <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                    <LeafletResizeHandler dependency={`${compareMode}-${blenderStyle}-${isSidebarCollapsed}-${arcgisMode}`} />
                    <SyncView center={syncCenter} zoom={syncZoom} />
                    <MapController fitTrigger={fitTriggerA} bounds={resultsData?.composite_bounds} geoData={geoData} padding={mapPadding} />
                    <MapInquiryListener active={inquiryActive && hoveredMap === 'A'} onInquire={(latlng) => setInquiryPoint(latlng)} />
                    <SyncListener onSync={(c, z) => {
                      setSyncCenter(c);
                      setSyncZoom(z);
                    }} active={hoveredMap === 'A'} />

                    {/* Overlay A */}
                    {selectedImgA && resultsData?.composite_bounds && (
                      <ImageOverlay
                        key={`${selectedImgA.filename}-${activeBandsA}`}
                        url={`${selectedImgA.url}&bands=${activeBandsA}`}
                        bounds={resultsData.composite_bounds}
                        opacity={1}
                        zIndex={15}
                      />
                    )}

                    {/* Vector boundary */}
                    {geoData && (
                      <GeoJSON data={geoData} style={() => ({ color: "#fbbf24", weight: 1.5, fillOpacity: 0, dashArray: "3 5", interactive: false })} />
                    )}
                  </MapContainer>
                </div>

                {/* Right Map: Layer B */}
                <div
                  className="flex-1 h-full relative"
                  onMouseEnter={() => setHoveredMap('B')}
                >
                  {/* Right Label */}
                  <div className={`absolute top-14 left-3 bg-[var(--card-bg)]/90 backdrop-blur border px-2.5 py-1 rounded text-[9.5px] font-bold text-blue-500 z-[1000] flex flex-col gap-0.5 transition-all
                    ${hoveredMap === 'B'
                      ? 'border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)] scale-105'
                      : 'border-[var(--border-color)]'}`}>
                    <span>LAYER B (OVERLAY)</span>
                    <span className="text-[8px] text-[var(--text-muted)] font-normal">{selectedImgB?.date}</span>
                  </div>

                  <MapContainer
                    center={syncCenter}
                    zoom={syncZoom}
                    className="h-full w-full"
                    zoomControl={false}
                    dragging={!isDraggingSlider}
                    scrollWheelZoom={true}
                    doubleClickZoom={true}
                    attributionControl={false}
                    style={{ height: '100%', width: '100%', cursor: inquiryActive ? 'crosshair' : '' }}
                  >
                    <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                    <LeafletResizeHandler dependency={`${compareMode}-${blenderStyle}-${isSidebarCollapsed}-${arcgisMode}`} />
                    <SyncView center={syncCenter} zoom={syncZoom} />
                    <MapController fitTrigger={fitTriggerB} bounds={resultsData?.composite_bounds} geoData={geoData} padding={mapPadding} />
                    <MapInquiryListener active={inquiryActive && hoveredMap === 'B'} onInquire={(latlng) => setInquiryPoint(latlng)} />
                    <SyncListener onSync={(c, z) => {
                      setSyncCenter(c);
                      setSyncZoom(z);
                    }} active={hoveredMap === 'B'} />

                    {/* Overlay B */}
                    {selectedImgB && resultsData?.composite_bounds && (
                      <ImageOverlay
                        key={`${selectedImgB.filename}-${activeBandsB}`}
                        url={`${selectedImgB.url}&bands=${activeBandsB}`}
                        bounds={resultsData.composite_bounds}
                        opacity={1}
                        zIndex={15}
                      />
                    )}

                    {/* Vector boundary */}
                    {geoData && (
                      <GeoJSON data={geoData} style={() => ({ color: "#fbbf24", weight: 1.5, fillOpacity: 0, dashArray: "3 5", interactive: false })} />
                    )}
                  </MapContainer>
                </div>
              </div>
            ) : (
              // ── SWIPE BLENDER COMPARISON WORKSPACE ──
              <div className="w-full h-full relative z-20 select-none">
                {/* Bottom Map: Layer A (Base) */}
                <div className="absolute inset-0 w-full h-full z-10" onMouseEnter={() => setHoveredMap('A')}>
                  <MapContainer
                    center={syncCenter}
                    zoom={syncZoom}
                    className="h-full w-full"
                    zoomControl={false}
                    dragging={!isDraggingSlider}
                    scrollWheelZoom={true}
                    doubleClickZoom={true}
                    attributionControl={false}
                    style={{ height: '100%', width: '100%', cursor: inquiryActive ? 'crosshair' : '' }}
                  >
                    <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                    <LeafletResizeHandler dependency={`${compareMode}-${blenderStyle}-${isSidebarCollapsed}-${arcgisMode}`} />
                    <SyncView center={syncCenter} zoom={syncZoom} />
                    <MapController fitTrigger={fitTriggerA} bounds={resultsData?.composite_bounds} geoData={geoData} padding={mapPadding} />
                    <MapInquiryListener active={inquiryActive && hoveredMap === 'A'} onInquire={(latlng) => setInquiryPoint(latlng)} />
                    <SyncListener onSync={(c, z) => {
                      setSyncCenter(c);
                      setSyncZoom(z);
                    }} active={hoveredMap === 'A'} />

                    {/* Overlay A */}
                    {selectedImgA && resultsData?.composite_bounds && (
                      <ImageOverlay
                        key={`${selectedImgA.filename}-${activeBandsA}`}
                        url={`${selectedImgA.url}&bands=${activeBandsA}`}
                        bounds={resultsData.composite_bounds}
                        opacity={1}
                        zIndex={15}
                      />
                    )}

                    {/* Vector boundary */}
                    {geoData && (
                      <GeoJSON data={geoData} style={() => ({ color: "#fbbf24", weight: 1.5, fillOpacity: 0, dashArray: "3 5", interactive: false })} />
                    )}
                  </MapContainer>
                </div>

                {/* Top Map: Layer B (Overlay) clipped */}
                <div
                  className="absolute inset-0 w-full h-full z-20 transition-[clip-path] duration-75"
                  style={{
                    clipPath: blenderStyle === 'swipe-both'
                      ? `inset(${sliderPercentY}% 0 0 ${sliderPercent}%)`
                      : isVerticalSwipe
                        ? `inset(${sliderPercent}% 0 0 0)`
                        : `inset(0 0 0 ${sliderPercent}%)`
                  }}
                  onMouseEnter={() => setHoveredMap('B')}
                >
                  {/* Label for B */}
                  <div className="absolute top-3 right-3 bg-[var(--card-bg)]/90 backdrop-blur border border-[var(--border-color)] px-2.5 py-1 rounded text-[9.5px] font-bold text-blue-500 z-[1000] flex flex-col gap-0.5 select-none">
                    <span>LAYER B (SWIPE OVERLAY)</span>
                    <span className="text-[8px] text-[var(--text-muted)] font-normal">{selectedImgB?.date}</span>
                  </div>

                  <MapContainer
                    center={syncCenter}
                    zoom={syncZoom}
                    className="h-full w-full"
                    zoomControl={false}
                    dragging={!isDraggingSlider}
                    scrollWheelZoom={true}
                    doubleClickZoom={true}
                    attributionControl={false}
                    style={{ height: '100%', width: '100%', cursor: inquiryActive ? 'crosshair' : '' }}
                  >
                    <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                    <LeafletResizeHandler dependency={`${compareMode}-${blenderStyle}-${isSidebarCollapsed}-${arcgisMode}`} />
                    <SyncView center={syncCenter} zoom={syncZoom} />
                    <MapController fitTrigger={fitTriggerB} bounds={resultsData?.composite_bounds} geoData={geoData} padding={mapPadding} />
                    <MapInquiryListener active={inquiryActive && hoveredMap === 'B'} onInquire={(latlng) => setInquiryPoint(latlng)} />
                    <SyncListener onSync={(c, z) => {
                      setSyncCenter(c);
                      setSyncZoom(z);
                    }} active={hoveredMap === 'B'} />

                    {/* Overlay B */}
                    {selectedImgB && resultsData?.composite_bounds && (
                      <ImageOverlay
                        key={`${selectedImgB.filename}-${activeBandsB}`}
                        url={`${selectedImgB.url}&bands=${activeBandsB}`}
                        bounds={resultsData.composite_bounds}
                        opacity={1}
                        zIndex={15}
                      />
                    )}

                    {/* Vector boundary */}
                    {geoData && (
                      <GeoJSON data={geoData} style={() => ({ color: "#fbbf24", weight: 1.5, fillOpacity: 0, dashArray: "3 5", interactive: false })} />
                    )}
                  </MapContainer>
                </div>

                {/* Swipe slider divider bar (for 1D Swipe) */}
                {(blenderStyle === 'swipe' || blenderStyle === 'swipe-vertical') && (
                  <div
                    className={`absolute bg-[var(--accent-color)] shadow-[0_0_10px_var(--accent-glow)] z-30 select-none
                      ${isVerticalSwipe
                        ? 'left-0 right-0 h-[3px] cursor-ns-resize'
                        : 'top-0 bottom-0 w-[3px] cursor-ew-resize'}`}
                    style={isVerticalSwipe ? { top: `${sliderPercent}%` } : { left: `${sliderPercent}%` }}
                    onMouseDown={handleSliderMouseDown}
                    onTouchStart={handleSliderMouseDown}
                  >
                    <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[var(--card-bg)] border-2 border-[var(--accent-color)] shadow-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-[var(--accent-color)] z-30
                      ${isVerticalSwipe ? 'cursor-ns-resize' : 'cursor-ew-resize'}`}>
                      <ArrowLeftRight size={12} className={`stroke-[2.5px] ${isVerticalSwipe ? 'rotate-90' : ''}`} />
                    </div>
                  </div>
                )}

                {/* 2D Swipe divider lines and crosshair handle */}
                {blenderStyle === 'swipe-both' && (
                  <>
                    <div
                      className="absolute top-0 bottom-0 w-[2px] bg-[var(--accent-color)] shadow-[0_0_8px_var(--accent-glow)] pointer-events-none z-30"
                      style={{ left: `${sliderPercent}%` }}
                    />
                    <div
                      className="absolute left-0 right-0 h-[2px] bg-[var(--accent-color)] shadow-[0_0_8px_var(--accent-glow)] pointer-events-none z-30"
                      style={{ top: `${sliderPercentY}%` }}
                    />
                    <div
                      className="absolute w-8 h-8 rounded-full bg-[var(--card-bg)] border-2 border-[var(--accent-color)] shadow-2xl flex items-center justify-center cursor-move hover:scale-105 active:scale-95 transition-all text-[var(--accent-color)] z-30 -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${sliderPercent}%`, top: `${sliderPercentY}%` }}
                      onMouseDown={handleSliderMouseDown}
                      onTouchStart={handleSliderMouseDown}
                    >
                      <Crosshair size={13} className="animate-pulse" />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Image Metadata Modal */}
            <AnimatePresence>
              {metadataModalOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[3000] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 pointer-events-auto"
                  onClick={() => setMetadataModalOpen(false)}
                >
                  <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 20, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    onClick={e => e.stopPropagation()}
                    className="bg-[var(--card-bg)] border border-[var(--border-color)] w-full max-w-xl rounded-xl shadow-2xl overflow-hidden flex flex-col font-sans text-[var(--text-main)]"
                  >
                    <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)] bg-[var(--border-color)]/20">
                      <div className="flex items-center gap-2">
                        <FileText size={15} className="text-[var(--accent-color)]" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-main)] font-space">
                          ERDAS Dataset Metadata Info
                        </h3>
                      </div>
                      <button
                        onClick={() => setMetadataModalOpen(false)}
                        className="p-1 hover:bg-[var(--border-color)]/30 text-[var(--text-muted)] hover:text-[var(--text-main)] rounded transition-all cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="p-5 overflow-y-auto max-h-[70vh] space-y-4">
                      {metadataLoading ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-3">
                          <div className="w-8 h-8 border-2 border-[var(--accent-color)] border-t-transparent rounded-full animate-spin" />
                          <span className="text-[10px] text-[var(--accent-color)] animate-pulse font-mono font-bold">Reading TIFF headers...</span>
                        </div>
                      ) : selectedImgMetadata ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3 text-[10.5px]">
                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg p-2.5 flex flex-col gap-0.5">
                              <span className="text-[8.5px] text-[var(--text-muted)] font-semibold uppercase font-mono">Raster Width</span>
                              <span className="font-mono text-[var(--text-main)] font-bold">{selectedImgMetadata.width} px</span>
                            </div>
                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg p-2.5 flex flex-col gap-0.5">
                              <span className="text-[8.5px] text-[var(--text-muted)] font-semibold uppercase font-mono">Raster Height</span>
                              <span className="font-mono text-[var(--text-main)] font-bold">{selectedImgMetadata.height} px</span>
                            </div>
                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg p-2.5 flex flex-col gap-0.5">
                              <span className="text-[8.5px] text-[var(--text-muted)] font-semibold uppercase font-mono">Bands Count</span>
                              <span className="font-mono text-[var(--text-main)] font-bold">{selectedImgMetadata.count} channels</span>
                            </div>
                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg p-2.5 flex flex-col gap-0.5">
                              <span className="text-[8.5px] text-[var(--text-muted)] font-semibold uppercase font-mono">Resolution</span>
                              <span className="font-mono text-[var(--text-main)] font-bold">
                                {selectedImgMetadata.pixel_size[0]}m x {selectedImgMetadata.pixel_size[1]}m
                              </span>
                            </div>
                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg p-2.5 flex flex-col gap-0.5">
                              <span className="text-[8.5px] text-[var(--text-muted)] font-semibold uppercase font-mono">Data Type</span>
                              <span className="font-mono text-[var(--text-main)] font-bold">{selectedImgMetadata.dtype}</span>
                            </div>
                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg p-2.5 flex flex-col gap-0.5">
                              <span className="text-[8.5px] text-[var(--text-muted)] font-semibold uppercase font-mono">Driver Format</span>
                              <span className="font-mono text-[var(--text-main)] font-bold">{selectedImgMetadata.driver}</span>
                            </div>
                          </div>

                          <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg p-3 flex flex-col gap-1.5 text-[10.5px]">
                            <span className="text-[8.5px] text-[var(--text-muted)] font-semibold uppercase font-mono">Coordinate Reference System (CRS)</span>
                            <span className="font-mono text-[var(--text-main)] select-text break-words bg-black/20 p-2 rounded border border-[var(--border-color)]/60">
                              {selectedImgMetadata.crs}
                            </span>
                          </div>

                          <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg p-3 flex flex-col gap-1.5 text-[10.5px]">
                            <span className="text-[8.5px] text-[var(--text-muted)] font-semibold uppercase font-mono">Dataset bounds</span>
                            <div className="grid grid-cols-2 gap-2 font-mono text-[9.5px] text-[var(--text-main)] bg-black/20 p-2 rounded border border-[var(--border-color)]/60">
                              <div>Left / West: {selectedImgMetadata.bounds.left}</div>
                              <div>Right / East: {selectedImgMetadata.bounds.right}</div>
                              <div>Bottom / South: {selectedImgMetadata.bounds.bottom}</div>
                              <div>Top / North: {selectedImgMetadata.bounds.top}</div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-6 text-[var(--text-muted)] text-xs font-semibold">
                          Failed to load metadata. Check python server endpoint.
                        </div>
                      )}
                    </div>
                    <div className="px-5 py-3 border-t border-[var(--border-color)] bg-[var(--border-color)]/25 flex justify-end">
                      <button
                        onClick={() => setMetadataModalOpen(false)}
                        className="h-8 bg-[var(--border-color)] hover:brightness-110 text-[var(--text-main)] text-[10px] font-bold px-4 rounded-lg cursor-pointer"
                      >
                        Close Specifications
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Preceding Weather Info Right Side Panel */}
            <AnimatePresence>
              {weatherModalOpen && (
                <motion.div
                  initial={{ opacity: 0, x: 50 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 50 }}
                  transition={{ duration: 0.3 }}
                  className="absolute top-3 right-3 w-[300px] bottom-3 z-[1000] glass-panel rounded-xl p-4 shadow-2xl flex flex-col pointer-events-auto border border-[var(--border-color)] text-[var(--text-main)] overflow-hidden"
                >
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--border-color)]/60 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      <CloudRain size={13} className="text-[var(--accent-color)]" />
                      <span className="text-xs font-bold uppercase tracking-wider font-space">Weather Info</span>
                    </div>
                    <button
                      onClick={() => setWeatherModalOpen(false)}
                      className="p-1 hover:bg-[var(--border-color)]/30 text-[var(--text-muted)] hover:text-[var(--text-main)] rounded transition-all cursor-pointer border-0 bg-transparent flex items-center justify-center outline-none"
                      title="Close Weather Panel"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="space-y-3 flex-1 overflow-y-auto scrollbar-hide pr-0.5">
                    {(() => {
                      const sceneA = weatherPatternsData?.scenes_weather?.find(
                        s => s.filename === selectedImgA?.filename || s.date === selectedImgA?.date
                      );
                      const sceneB = compareMode ? weatherPatternsData?.scenes_weather?.find(
                        s => s.filename === selectedImgB?.filename || s.date === selectedImgB?.date
                      ) : null;

                      if (!compareMode) {
                        if (!sceneA) {
                          return (
                            <div className="text-center py-12 text-[var(--text-muted)] text-xs font-semibold flex flex-col items-center gap-2">
                              <Cloud size={24} className="opacity-45" />
                              <span>No weather details found for this date.</span>
                            </div>
                          );
                        }
                        return (
                          <div className="flex flex-col gap-2.5">
                            <div className="flex items-center justify-between bg-[var(--bg-primary)]/40 border border-[var(--border-color)]/40 p-2.5 rounded-xl text-[10px] font-mono">
                              <span className="text-[var(--text-muted)]">Selected Date:</span>
                              <span className="font-bold text-[var(--accent-color)]">{selectedImgA?.date}</span>
                            </div>
                            {sceneA.weather_window.map((day, idx) => renderDayWeatherRow(day, idx))}
                          </div>
                        );
                      } else {
                        return (
                          <div className="flex flex-col gap-4">
                            {/* Layer A Weather */}
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center justify-between border-b border-[var(--border-color)]/30 pb-1.5 flex-shrink-0">
                                <span className="text-[9.5px] font-bold text-emerald-400 uppercase tracking-wider font-space">
                                  Layer A Weather
                                </span>
                                <span className="text-[8.5px] font-mono text-[var(--text-muted)] font-bold">
                                  {selectedImgA ? selectedImgA.date : "None Selected"}
                                </span>
                              </div>
                              {sceneA ? (
                                <div className="flex flex-col gap-2">
                                  {sceneA.weather_window.map((day, idx) => renderDayWeatherRow(day, idx))}
                                </div>
                              ) : (
                                <span className="text-[9px] font-mono text-[var(--text-muted)] italic">
                                  No weather details available.
                                </span>
                              )}
                            </div>

                            <div className="h-[1px] bg-gradient-to-r from-[var(--border-color)]/50 to-transparent my-1" />

                            {/* Layer B Weather */}
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center justify-between border-b border-[var(--border-color)]/30 pb-1.5 flex-shrink-0">
                                <span className="text-[9.5px] font-bold text-cyan-400 uppercase tracking-wider font-space">
                                  Layer B Weather
                                </span>
                                <span className="text-[8.5px] font-mono text-[var(--text-muted)] font-bold">
                                  {selectedImgB ? selectedImgB.date : "None Selected"}
                                </span>
                              </div>
                              {sceneB ? (
                                <div className="flex flex-col gap-2">
                                  {sceneB.weather_window.map((day, idx) => renderDayWeatherRow(day, idx))}
                                </div>
                              ) : (
                                <span className="text-[9px] font-mono text-[var(--text-muted)] italic">
                                  Select Layer B image to compare.
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      }
                    })()}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── PREMIUM INTELLIGENT FOOTER ────────────────────────────────── */}
        <footer className="h-7 border-t border-[var(--border-color)] bg-[var(--glass-surface)] backdrop-blur px-6 flex items-center justify-between text-[8.5px] font-mono text-[var(--text-muted)] tracking-wider z-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[var(--text-main)]">RS-AIMS v2.0</span>
          </div>
          <div>
            <span className="text-[var(--text-main)] font-semibold">{liveTime}</span>
          </div>
        </footer>
      </div>
    );
  }

  // ── STANDARD MODE LAYOUT (Dashboard View) ───────────────────────
  return (
    <div className={`h-screen w-screen bg-[var(--bg-primary)] overflow-hidden flex flex-col relative select-none theme-${theme}`}>
      {/* ── TOP HEADER BAR (Matched to Home Screen Header) ────────────────── */}
      <header className="h-14 border-b border-[var(--border-color)] bg-[var(--glass-surface)] backdrop-blur-md px-6 flex items-center justify-between z-50 flex-shrink-0 relative">
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

        {/* Right Header Panel */}
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

      {/* ── CONTENT (Sidebar + Map Viewport) ────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">

        {/* Dynamic Map Background */}
        <div className="absolute inset-0 z-0">
          <MapContainer
            center={syncCenter}
            zoom={syncZoom}
            className="h-full w-full"
            zoomControl={false}
            dragging={!isDraggingSlider}
            scrollWheelZoom={true}
            doubleClickZoom={true}
            attributionControl={false}
            style={{ height: '100%', width: '100%', cursor: inquiryActive ? 'crosshair' : '' }}
          >
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
            <LeafletResizeHandler dependency={`${compareMode}-${blenderStyle}-${isSidebarCollapsed}-${arcgisMode}`} />
            {geoData && <FitBounds data={geoData} padding={mapPadding} />}
            <SyncView center={syncCenter} zoom={syncZoom} />
            <MapController fitTrigger={fitTriggerStandard} bounds={resultsData?.composite_bounds} geoData={geoData} padding={mapPadding} />
            <MapInquiryListener active={inquiryActive} onInquire={(latlng) => setInquiryPoint(latlng)} />
            <SyncListener onSync={(c, z) => {
              setSyncCenter(c);
              setSyncZoom(z);
            }} active={!arcgisMode} />

            {/* Raw satellite image overlays */}
            {!compareMode && selectedImgA && resultsData?.composite_bounds && activeWorkspace !== 'monitoring' && activeWorkspace !== 'moisture' && activeWorkspace !== 'carbon' && activeWorkspace !== 'methane' && (
              <ImageOverlay
                key={`main-single-${selectedImgA.filename}`}
                url={selectedImgA.url}
                bounds={resultsData.composite_bounds}
                opacity={1}
                zIndex={15}
              />
            )}

            {compareMode && selectedImgA && resultsData?.composite_bounds && activeWorkspace !== 'monitoring' && activeWorkspace !== 'moisture' && activeWorkspace !== 'carbon' && activeWorkspace !== 'methane' && (
              <ImageOverlay
                key={`main-compareA-${selectedImgA.filename}`}
                url={selectedImgA.url}
                bounds={resultsData.composite_bounds}
                opacity={1 - blendRatio}
                zIndex={15}
              />
            )}
            {compareMode && selectedImgB && resultsData?.composite_bounds && activeWorkspace !== 'monitoring' && activeWorkspace !== 'moisture' && activeWorkspace !== 'carbon' && activeWorkspace !== 'methane' && (
              <ImageOverlay
                key={`main-compareB-${selectedImgB.filename}`}
                url={selectedImgB.url}
                bounds={resultsData.composite_bounds}
                opacity={blendRatio}
                zIndex={16}
              />
            )}

            {/* NDVI Overlay for Crop Monitoring */}
            {activeWorkspace === 'monitoring' && resultsData?.composite_bounds && (selectedImgA || resultsData?.ndvi_url || satelliteImages.length > 0) && (
              <ImageOverlay
                key={selectedImgA ? `main-ndvi-${selectedImgA.filename}` : 'main-ndvi-composite'}
                url={selectedImgA
                  ? `${selectedImgA.url}&bands=ndvi`
                  : resultsData.ndvi_url || `${satelliteImages[0]?.url}&bands=ndvi`
                }
                bounds={resultsData.composite_bounds}
                opacity={1}
                zIndex={15}
              />
            )}

            {/* NDWI Overlay for Soil Moisture */}
            {activeWorkspace === 'moisture' && resultsData?.composite_bounds && (selectedImgA || resultsData?.ndwi_url || satelliteImages.length > 0) && (
              <ImageOverlay
                key={selectedImgA ? `main-ndwi-${selectedImgA.filename}` : 'main-ndwi-composite'}
                url={selectedImgA
                  ? `${selectedImgA.url}&bands=ndwi`
                  : resultsData.ndwi_url || `${satelliteImages[0]?.url}&bands=ndwi`
                }
                bounds={resultsData.composite_bounds}
                opacity={1}
                zIndex={15}
              />
            )}

            {/* Soil Carbon Overlay */}
            {activeWorkspace === 'carbon' && resultsData?.composite_bounds && resultsData?.carbon_url && (
              <ImageOverlay
                key="main-carbon"
                url={resultsData.carbon_url}
                bounds={resultsData.composite_bounds}
                opacity={0.85}
                zIndex={15}
              />
            )}

            {/* Methane Emissions Overlay */}
            {activeWorkspace === 'methane' && resultsData?.composite_bounds && resultsData?.methane_url && (
              <ImageOverlay
                key="main-methane"
                url={resultsData.methane_url}
                bounds={resultsData.composite_bounds}
                opacity={0.85}
                zIndex={15}
              />
            )}

            {/* Agriculture detection layer */}
            {showMasks && resultsData?.agriculture_url && resultsData?.composite_bounds && (
              activeWorkspace === 'overview' ||
              (resultsData?.run_type !== 'combined' && (activeWorkspace === 'crop' || activeWorkspace === 'acre') && !showClassification)
            ) && (
                <ImageOverlay url={resultsData.agriculture_url} bounds={resultsData.composite_bounds} opacity={1} zIndex={20} />
              )}

            {/* Crop classification layer */}
            {showMasks && (
              resultsData?.run_type === 'combined'
                ? (showCropOverlay && (activeWorkspace === 'crop' || activeWorkspace === 'acre'))
                : ((activeWorkspace === 'crop' || activeWorkspace === 'acre') && resultsData?.run_type !== 'lulc' && showClassification)
            ) && resultsData?.classification_url && resultsData?.composite_bounds && (
                <ImageOverlay url={resultsData.classification_url} bounds={resultsData.composite_bounds} opacity={0.85} zIndex={20} />
              )}

            {/* LULC classification layer */}
            {showMasks && (
              resultsData?.run_type === 'combined'
                ? (showLulcOverlay && activeWorkspace === 'lulc')
                : ((activeWorkspace === 'crop' || activeWorkspace === 'acre') && resultsData?.run_type === 'lulc' && showClassification)
            ) && resultsData?.lulc_classification_url && resultsData?.composite_bounds && (
                <ImageOverlay url={resultsData.lulc_classification_url} bounds={resultsData.composite_bounds} opacity={0.85} zIndex={21} />
              )}

            {/* Crop Rotation Overlay */}
            {showMasks && activeWorkspace === 'rotation' && resultsData?.rotation_url && resultsData?.composite_bounds && (
              <ImageOverlay url={resultsData.rotation_url} bounds={resultsData.composite_bounds} opacity={0.85} zIndex={21} />
            )}

            {/* Seasonal Map Overlay */}
            {showMasks && activeSeasonalOverlay && seasonalUrls?.[activeSeasonalOverlay] && resultsData?.composite_bounds && (
              <ImageOverlay url={seasonalUrls[activeSeasonalOverlay]} bounds={resultsData.composite_bounds} opacity={0.85} zIndex={22} />
            )}

            {/* Vector Layers */}
            {geoData && activeWorkspace !== 'monitoring' && activeWorkspace !== 'moisture' && activeWorkspace !== 'carbon' && activeWorkspace !== 'methane' && (
              <GeoJSON data={geoData} style={() => ({ color: "#fbbf24", weight: 2.5, fillOpacity: 0, dashArray: "4 6", interactive: false })} />
            )}
            {resultsData?.geojson &&
              activeWorkspace !== 'monitoring' &&
              activeWorkspace !== 'moisture' &&
              activeWorkspace !== 'carbon' &&
              activeWorkspace !== 'methane' &&
              activeWorkspace !== 'lulc' &&
              activeWorkspace !== 'pest' && (
                <GeoJSON data={resultsData.geojson} style={() => ({ color: "#16a34a", weight: 2, fillOpacity: 0, fillColor: "#16a34a" })} />
              )}

            {/* Pest Risk Overlay */}
            {activeWorkspace === 'pest' && pestData && resultsData?.composite_bounds && (
              <ImageOverlay
                key={`pest-risk-${resultsData.run_id}`}
                url={`http://localhost:5000/api/runs/${resultsData.run_id}/pest-risk-map`}
                bounds={resultsData.composite_bounds}
                opacity={0.82}
                zIndex={22}
              />
            )}
          </MapContainer>

          {theme === "dark" && (
            <div className="absolute inset-0 pointer-events-none z-[5] bg-black/10" />
          )}
        </div>

        {/* Floating Left Navigation Sidebar */}
        <aside className={`${isSidebarCollapsed ? 'w-[76px]' : 'w-[250px]'} flex-none h-full flex flex-col py-4 pl-4 z-[1000] relative transition-all duration-300`}>
          <div className="flex-1 glass-panel flex flex-col overflow-hidden rounded-2xl">
            {/* Logo area */}
            {isSidebarCollapsed ? (
              <div className="p-4 border-b border-[var(--border-color)] flex items-center justify-center bg-[var(--border-color)]/5 h-[58px]">
                <LogoIcon />
              </div>
            ) : (
              <div className="p-4 border-b border-[var(--border-color)] flex flex-col gap-1 bg-[var(--border-color)]/5 h-[58px]">
                <span className="text-[9.5px] font-bold text-[var(--text-main)] font-space uppercase tracking-wider">WORKSPACE MENU</span>
                <p className="text-[8.5px] font-mono text-[var(--text-muted)] leading-relaxed">
                  SELECT MODULE FOR ANALYSIS
                </p>
              </div>
            )}

            {/* Navigation buttons */}
            <nav className="flex-1 py-4 flex flex-col gap-1.5 overflow-y-auto scrollbar-hide">
              {isCroppingIntensity ? (
                <>
                  <SidebarButton icon={Layout} label="Intensity Overview" id="overview" active={activeWorkspace === 'overview'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={PieChart} label="Cropping Intensity" id="crop" active={activeWorkspace === 'crop'} onClick={handleClassificationTab} />
                  <SidebarButton icon={ArrowLeftRight} label="Crop Rotation" id="rotation" active={activeWorkspace === 'rotation'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={Target} label="Admin Statistics" id="admin_stats" active={activeWorkspace === 'admin_stats'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={Cloud} label="Weather Patterns" id="weather" active={activeWorkspace === 'weather'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={Database} label="Historical Runs" id="database" active={activeWorkspace === 'database'} onClick={handleDatabaseTab} />
                </>
              ) : (
                <>
                  <SidebarButton icon={Layout} label={resultsData?.run_type === 'lulc' ? "LULC Overview" : "Land use"} id="overview" active={activeWorkspace === 'overview'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={PieChart} label={resultsData?.run_type === 'lulc' ? "LULC Classification" : "Crop Classification"} id="crop" active={activeWorkspace === 'crop'} onClick={handleClassificationTab} />
                  {resultsData?.run_type === 'combined' && (
                    <SidebarButton icon={Target} label="LULC Classification" id="lulc" active={activeWorkspace === 'lulc'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(true); }} />
                  )}
                  <SidebarButton icon={Activity} label={resultsData?.run_type === 'lulc' ? "Land Cover Acreage" : "Acreage Tracking"} id="acre" active={activeWorkspace === 'acre'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={Sprout} label={resultsData?.run_type === 'lulc' ? "Vegetation Indices (NDVI)" : "Crop Monitoring (NDVI)"} id="monitoring" active={activeWorkspace === 'monitoring'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={Droplet} label={resultsData?.run_type === 'lulc' ? "Moisture & Water (NDWI)" : "Soil Moisture (NDWI)"} id="moisture" active={activeWorkspace === 'moisture'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={Leaf} label="Soil Carbon" id="carbon" active={activeWorkspace === 'carbon'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={Wind} label="Methane Emissions" id="methane" active={activeWorkspace === 'methane'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={Cloud} label="Weather Patterns" id="weather" active={activeWorkspace === 'weather'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                  <SidebarButton icon={Database} label="Historical Runs" id="database" active={activeWorkspace === 'database'} onClick={handleDatabaseTab} />
                  <SidebarButton icon={AlertTriangle} label="Pest Risk" id="pest" active={activeWorkspace === 'pest'} onClick={(id) => { setActiveWorkspace(id); setShowClassification(false); }} />
                </>
              )}
            </nav>

            {/* Collapse toggle action */}
            <div className="p-2 border-t border-[var(--border-color)]/60 flex justify-center bg-[var(--border-color)]/5">
              <button
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="w-8 h-8 rounded-lg hover:bg-[var(--border-color)]/10 text-[var(--text-muted)] hover:text-[var(--text-main)] flex items-center justify-center transition-all cursor-pointer"
                title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
              >
                {isSidebarCollapsed ? <ChevronRight size={13} /> : <ChevronRight size={13} className="rotate-180" />}
              </button>
            </div>

            {/* Exit button */}
            <div className={`p-4 border-t border-[var(--border-color)] flex ${isSidebarCollapsed ? 'justify-center' : ''}`}>
              {isSidebarCollapsed ? (
                <button
                  onClick={() => navigate("/")}
                  title="Exit Workspace"
                  className="w-10 h-10 flex items-center justify-center text-[var(--text-muted)] hover:text-red-500 hover:bg-red-950/10 rounded-xl transition-all border border-transparent hover:border-red-900/35 cursor-pointer"
                >
                  <ArrowLeft size={13} />
                </button>
              ) : (
                <button
                  onClick={() => navigate("/")}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-[var(--text-muted)] hover:text-red-500 hover:bg-red-950/10 rounded-xl transition-all border border-transparent hover:border-red-900/35 cursor-pointer font-bold font-space uppercase tracking-wider text-[10px]"
                >
                  <ArrowLeft size={13} />
                  <span>Exit Workspace</span>
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* Main Area */}
        <main className="flex-1 h-full relative flex flex-col pt-4 pr-4 pb-4 pl-4 z-[900] pointer-events-none">
          {/* Active stats details cards (Project details row) */}
          <div className="flex items-center gap-3 mb-4 pointer-events-auto z-10 flex-wrap">
            {/* Project Name Card */}
            <div className="bg-[var(--glass-surface)] backdrop-blur border border-[var(--border-color)] px-3.5 py-1.5 rounded-xl flex items-center gap-2 shadow-md">
              <Target size={13} className="text-[var(--accent-color)]" />
              <div className="flex flex-col">
                <span className="text-[8px] text-[var(--text-muted)] font-mono uppercase leading-none mb-0.5">Project Name</span>
                <span className="text-[11px] font-bold text-[var(--text-main)] leading-none">{analysisInfo.boundaryName}</span>
              </div>
            </div>

            {/* Period Card */}
            <div className="bg-[var(--glass-surface)] backdrop-blur border border-[var(--border-color)] px-3.5 py-1.5 rounded-xl flex items-center gap-2 shadow-md">
              <Calendar size={13} className="text-blue-500" />
              <div className="flex flex-col">
                <span className="text-[8px] text-[var(--text-muted)] font-mono uppercase leading-none mb-0.5">Period</span>
                <span className="text-[11px] font-bold text-[var(--text-main)] leading-none">{analysisInfo.season} {analysisInfo.year}</span>
              </div>
            </div>

            {/* Raster Res Card */}
            <div className="bg-[var(--glass-surface)] backdrop-blur border border-[var(--border-color)] px-3.5 py-1.5 rounded-xl flex items-center gap-2 shadow-md">
              <Leaf size={13} className="text-emerald-500" />
              <div className="flex flex-col">
                <span className="text-[8px] text-[var(--text-muted)] font-mono uppercase leading-none mb-0.5">Raster Res</span>
                <span className="text-[11px] font-bold text-[var(--text-main)] leading-none">10M</span>
              </div>
            </div>

            {/* Map Zoom & Frame Controls */}
            <div className="bg-[var(--glass-surface)] backdrop-blur border border-[var(--border-color)] px-3 py-1.5 rounded-xl flex items-center gap-1 shadow-md pointer-events-auto">
              <span className="text-[8px] text-[var(--text-muted)] font-mono uppercase px-2 select-none border-r border-[var(--border-color)]/40 mr-1">Map Zoom</span>
              <button
                onClick={() => setSyncZoom(prev => Math.min(18, prev + 1))}
                title="Zoom In"
                className="w-7 h-7 hover:bg-[var(--border-color)]/20 hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded-lg transition-all cursor-pointer flex items-center justify-center border-0 outline-none bg-transparent"
              >
                <ZoomIn size={13} />
              </button>
              <button
                onClick={() => setSyncZoom(prev => Math.max(2, prev - 1))}
                title="Zoom Out"
                className="w-7 h-7 hover:bg-[var(--border-color)]/20 hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded-lg transition-all cursor-pointer flex items-center justify-center border-0 outline-none bg-transparent"
              >
                <ZoomOut size={13} />
              </button>
              <div className="w-[1px] h-4 bg-[var(--border-color)]/40 mx-1" />
              <button
                onClick={() => setFitTriggerStandard(prev => prev + 1)}
                title="Fit Study Area to Frame"
                className="w-7 h-7 hover:bg-[var(--border-color)]/20 hover:text-[var(--accent-color)] text-[var(--text-muted)] rounded-lg transition-all cursor-pointer flex items-center justify-center border-0 outline-none bg-transparent"
              >
                <Maximize size={13} />
              </button>
            </div>
          </div>

          <div className="flex-1 relative pointer-events-none">

            {/* Map Legend */}
            {activeWorkspace !== 'weather' && (
              <div className={`absolute left-4 pointer-events-auto transition-all duration-300 z-30
                ${satelliteImages.length > 0 ? 'bottom-[220px]' : 'bottom-4'}`}>
                <div className="bg-[var(--glass-surface)] backdrop-blur border border-[var(--border-color)] rounded-xl px-4 py-3 flex flex-col gap-2 shadow-lg min-w-[155px]">
                  <span className="text-[9.5px] font-bold text-[var(--text-main)] font-space uppercase tracking-wider mb-0.5 border-b border-[var(--border-color)]/60 pb-1">Legend</span>
                  {activeWorkspace === 'monitoring' ? (
                    <>
                      {/* NDVI Legend */}
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#1a9850] border border-green-800" />
                        <span className="text-[10px] text-[var(--text-main)]">Dense Canopy (&gt; 0.6)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#a6d96a] border border-green-400" />
                        <span className="text-[10px] text-[var(--text-main)]">Moderate Veg (0.5 - 0.6)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#fee08b] border border-amber-400/80" />
                        <span className="text-[10px] text-[var(--text-main)]">Light Veg / Sparse (0.4 - 0.5)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#fdae61] border border-orange-400" />
                        <span className="text-[10px] text-[var(--text-main)]">Barren Soil / Sparse (0.3 - 0.4)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#d73027] border border-red-700" />
                        <span className="text-[10px] text-[var(--text-main)]">Stressed / Rock (0.1 - 0.3)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#3c5a78] border border-slate-600/70" />
                        <span className="text-[10px] text-[var(--text-main)]">Water / Shadow (&lt; 0.1)</span>
                      </div>
                    </>
                  ) : activeWorkspace === 'moisture' ? (
                    <>
                      {/* NDWI Legend */}
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#08306b] border border-[#051a3a]" />
                        <span className="text-[10px] text-[var(--text-main)]">Water / High Wetness (&gt; 0.33)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#1f78b4] border border-[#144d73]" />
                        <span className="text-[10px] text-[var(--text-main)]">Moderate Moisture (0.08 to 0.33)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#a6cce3] border border-[#7ba2bd]" />
                        <span className="text-[10px] text-[var(--text-main)]">Transitional Moist (-0.02 to 0.08)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#96dc5a] border border-[#78b344]" />
                        <span className="text-[10px] text-[var(--text-main)]">Mild Dry Deficit (-0.10 to -0.02)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#228b22] border border-[#165c16]" />
                        <span className="text-[10px] text-[var(--text-main)]">Dry Soil / Vegetation (&lt; -0.10)</span>
                      </div>
                    </>
                  ) : activeWorkspace === 'carbon' ? (
                    <>
                      {/* Soil Carbon Legend */}
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#23190f] border border-[#1b120a]" />
                        <span className="text-[10px] text-[var(--text-main)]">High Carbon (&gt; 1.2%)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#5a3719] border border-[#3e250f]" />
                        <span className="text-[10px] text-[var(--text-main)]">Moderate Carbon (0.8% - 1.2%)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#8b5a32] border border-[#6b4221]" />
                        <span className="text-[10px] text-[var(--text-main)]">Light Carbon (0.5% - 0.8%)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#cdab7c] border border-[#b29064]" />
                        <span className="text-[10px] text-[var(--text-main)]">Low Carbon (0.2% - 0.5%)</span>
                      </div>
                    </>
                  ) : activeWorkspace === 'methane' ? (
                    <>
                      {/* Methane Legend */}
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#eb321e] border border-[#c82416]" />
                        <span className="text-[10px] text-[var(--text-main)]">Hotspot Plume (&gt; 1900 ppb)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#f5961e] border border-[#cf7d15]" />
                        <span className="text-[10px] text-[var(--text-main)]">Moderately Elevated (1850-1900 ppb)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#3cb4d2] border border-[#2b97b2]" />
                        <span className="text-[10px] text-[var(--text-main)]">Background Level (1800-1850 ppb)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-[#283296] border border-[#1b226e]" />
                        <span className="text-[10px] text-[var(--text-main)]">Clean Air (&lt; 1800 ppb)</span>
                      </div>
                    </>
                  ) : activeWorkspace === 'pest' ? (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#22c55e' }} />
                        <span className="text-[10px] text-[var(--text-main)]">Healthy</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#eab308' }} />
                        <span className="text-[10px] text-[var(--text-main)]">Low Stress</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#f97316' }} />
                        <span className="text-[10px] text-[var(--text-main)]">Medium Risk</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#ef4444' }} />
                        <span className="text-[10px] text-[var(--text-main)]">High Risk</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#b91c1c' }} />
                        <span className="text-[10px] text-[var(--text-main)]">Severe Risk</span>
                      </div>
                    </>
                  ) : activeWorkspace === 'rotation' && resultsData?.crop_stats?.rotation_stats ? (
                    <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1 scrollbar-hide">
                      {Object.entries(resultsData.crop_stats.rotation_stats).map(([name, info]) => (
                        <div key={name} className="flex items-center gap-2">
                          <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: info.color_hex, opacity: 0.9 }} />
                          <span className="text-[10px] text-[var(--text-main)] truncate max-w-[130px]">{name}</span>
                        </div>
                      ))}
                    </div>
                  ) : activeWorkspace === 'lulc' && resultsData?.lulc_stats?.crops ? (
                    <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1 scrollbar-hide">
                      {Object.entries(resultsData.lulc_stats.crops)
                        .sort(([nameA, infoA], [nameB, infoB]) => {
                          if (nameA === 'Other') return 1;
                          if (nameB === 'Other') return -1;
                          return (infoB.area_ha || 0) - (infoA.area_ha || 0);
                        })
                        .map(([name, info]) => (
                          <div key={name} className="flex items-center gap-2">
                            <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: info.color_hex, opacity: 0.9 }} />
                            <span className="text-[10px] text-[var(--text-main)]">{name}</span>
                          </div>
                        ))}
                    </div>
                  ) : activeWorkspace === 'crop' && resultsData?.crop_stats?.crops ? (
                    <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-1 scrollbar-hide">
                      {Object.entries(resultsData.crop_stats.crops)
                        .sort(([nameA, infoA], [nameB, infoB]) => {
                          if (nameA === 'Other') return 1;
                          if (nameB === 'Other') return -1;
                          return (infoB.area_ha || 0) - (infoA.area_ha || 0);
                        })
                        .map(([name, info]) => (
                          <div key={name} className="flex items-center gap-2">
                            <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: info.color_hex, opacity: 0.9 }} />
                            <span className="text-[10px] text-[var(--text-main)]">{name}</span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <>
                      {/* Standard Legend */}
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-emerald-500 opacity-80 border border-emerald-600 shadow-[0_0_4px_rgba(16,185,129,0.3)]" />
                        <span className="text-[10px] text-[var(--text-main)]">Agricultural Land</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-transparent border border-dashed border-amber-500" />
                        <span className="text-[10px] text-[var(--text-main)]">AOI Boundary</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3.5 h-3.5 rounded-sm bg-transparent border border-green-600" />
                        <span className="text-[10px] text-[var(--text-main)]">Parcel Boundary</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
            {/* Right Intelligence Panel */}
            <div className={`absolute top-0 right-0 w-[300px] flex flex-col gap-3 pointer-events-auto z-20 transition-all duration-300
              ${satelliteImages.length > 0 ? 'bottom-[220px]' : 'bottom-0'}`}>
              <AnimatePresence mode="wait">
                {weatherModalOpen ? (
                  <motion.div
                    key="weather-info-panel"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.3 }}
                    className="glass-panel rounded-2xl p-5 shadow-2xl flex flex-col max-h-full overflow-hidden border border-[var(--border-color)] text-[var(--text-main)]"
                  >
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--border-color)]/60 flex-shrink-0">
                      <div className="flex items-center gap-2">
                        <CloudRain size={13} className="text-[var(--accent-color)]" />
                        <span className="text-xs font-bold uppercase tracking-wider font-space">Weather Info</span>
                      </div>
                      <button
                        onClick={() => setWeatherModalOpen(false)}
                        className="p-1 hover:bg-[var(--border-color)]/30 text-[var(--text-muted)] hover:text-[var(--text-main)] rounded transition-all cursor-pointer border-0 bg-transparent flex items-center justify-center outline-none"
                        title="Close Weather Panel"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    <div className="space-y-3 flex-1 overflow-y-auto scrollbar-hide pr-0.5">
                      {(() => {
                        const sceneA = weatherPatternsData?.scenes_weather?.find(
                          s => s.filename === selectedImgA?.filename || s.date === selectedImgA?.date
                        );
                        if (!sceneA) {
                          return (
                            <div className="text-center py-12 text-[var(--text-muted)] text-xs font-semibold flex flex-col items-center gap-2">
                              <Cloud size={24} className="opacity-45" />
                              <span>No weather details found for this date.</span>
                            </div>
                          );
                        }
                        return (
                          <div className="flex flex-col gap-2.5">
                            <div className="flex items-center justify-between bg-[var(--bg-primary)]/40 border border-[var(--border-color)]/40 p-2.5 rounded-xl text-[10px] font-mono">
                              <span className="text-[var(--text-muted)]">Selected Date:</span>
                              <span className="font-bold text-[var(--accent-color)]">{selectedImgA?.date}</span>
                            </div>
                            {sceneA.weather_window.map((day, idx) => renderDayWeatherRow(day, idx))}
                          </div>
                        );
                      })()}
                    </div>
                  </motion.div>
                ) : resultsData && (activeWorkspace !== 'weather' || compareMode) && (
                  <motion.div
                    key={activeWorkspace}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    className="glass-panel rounded-2xl p-5 shadow-2xl flex flex-col max-h-full overflow-hidden"
                  >
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--border-color)]/60 flex-shrink-0">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-main)] flex items-center gap-2 font-space">
                        <Cpu size={13} className="text-[var(--accent-color)]" />
                        {activeWorkspace === 'overview' ? (isCroppingIntensity ? 'Intensity Overview' : (resultsData?.run_type === 'lulc' ? 'LULC Overview' : 'Land Intelligence')) :
                          activeWorkspace === 'crop' ? (isCroppingIntensity ? 'Cropping Intensity' : (resultsData?.run_type === 'lulc' ? 'LULC Classification' : 'Crop Classification')) :
                            activeWorkspace === 'lulc' ? 'LULC Classification' :
                              activeWorkspace === 'acre' ? (resultsData?.run_type === 'lulc' ? 'LULC Acreage Tracking' : 'Acreage Tracking') :
                                activeWorkspace === 'monitoring' ? (resultsData?.run_type === 'lulc' ? 'Vegetation Indices' : 'Crop Monitoring') :
                                  activeWorkspace === 'moisture' ? (resultsData?.run_type === 'lulc' ? 'Moisture & Water Indices' : 'Soil Moisture') :
                                    activeWorkspace === 'carbon' ? 'Soil Organic Carbon' :
                                      activeWorkspace === 'methane' ? 'Methane Emissions' :
                                        activeWorkspace === 'pest' ? 'Pest Risk Detection' :
                                          activeWorkspace === 'weather' ? 'Weather Patterns' :
                                            activeWorkspace === 'database' ? 'Historical Runs' :
                                              activeWorkspace === 'rotation' ? 'Crop Rotation' :
                                                activeWorkspace === 'admin_stats' ? 'Administrative Statistics' :
                                                  'Field Productivity'}
                      </h3>
                    </div>

                    <div className="space-y-4 flex-1 overflow-y-auto scrollbar-hide pr-0.5">
                      {compareMode ? (
                        (() => {
                          const sceneA = weatherPatternsData?.scenes_weather?.find(
                            s => s.filename === selectedImgA?.filename || s.date === selectedImgA?.date
                          );
                          const sceneB = weatherPatternsData?.scenes_weather?.find(
                            s => s.filename === selectedImgB?.filename || s.date === selectedImgB?.date
                          );

                          return (
                            <div className="flex flex-col gap-4">
                              {/* Layer A Weather */}
                              <div className="flex flex-col gap-2.5">
                                <div className="flex items-center justify-between border-b border-[var(--border-color)]/30 pb-1.5 flex-shrink-0">
                                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider font-space">
                                    Layer A Preceding Weather
                                  </span>
                                  <span className="text-[8.5px] font-mono text-[var(--text-muted)] font-bold">
                                    {selectedImgA ? selectedImgA.date : "None Selected"}
                                  </span>
                                </div>
                                {sceneA ? (
                                  <div className="flex flex-col gap-2">
                                    {sceneA.weather_window.map((day, idx) => renderDayWeatherRow(day, idx))}
                                  </div>
                                ) : (
                                  <span className="text-[9px] font-mono text-[var(--text-muted)] italic">
                                    No weather details available.
                                  </span>
                                )}
                              </div>

                              <div className="h-[1px] bg-gradient-to-r from-[var(--border-color)]/50 to-transparent my-1" />

                              {/* Layer B Weather */}
                              <div className="flex flex-col gap-2.5">
                                <div className="flex items-center justify-between border-b border-[var(--border-color)]/30 pb-1.5 flex-shrink-0">
                                  <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider font-space">
                                    Layer B Preceding Weather
                                  </span>
                                  <span className="text-[8.5px] font-mono text-[var(--text-muted)] font-bold">
                                    {selectedImgB ? selectedImgB.date : "None Selected"}
                                  </span>
                                </div>
                                {sceneB ? (
                                  <div className="flex flex-col gap-2">
                                    {sceneB.weather_window.map((day, idx) => renderDayWeatherRow(day, idx))}
                                  </div>
                                ) : (
                                  <span className="text-[9px] font-mono text-[var(--text-muted)] italic">
                                    Select Layer B image from timeline to compare.
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })()
                      ) : activeWorkspace === 'pest' ? (
                        <div className="flex flex-col gap-3">
                          {/* Run / Re-run button */}
                          <button
                            onClick={runPestDetection}
                            disabled={pestLoading || !resultsData?.run_id}
                            className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${pestLoading
                              ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30 cursor-wait'
                              : 'bg-[var(--accent-glow)] border border-[var(--accent-color)]/40 text-[var(--accent-color)] hover:bg-[var(--accent-color)]/20 cursor-pointer'
                              }`}
                          >
                            <AlertTriangle size={12} />
                            {pestLoading ? 'Analysing...' : pestData ? 'Re-run Detection' : 'Run Pest Detection'}
                          </button>

                          {pestData ? (
                            <>
                              {/* Health score card */}
                              <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3.5 flex flex-col gap-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Field Health Score</span>
                                  <span className="text-[11px] font-mono text-[var(--text-muted)]">{pestData.source_image}</span>
                                </div>
                                <div className="flex items-end gap-1">
                                  <span className={`text-[28px] font-extrabold leading-none ${pestData.stats.health_score >= 75 ? 'text-green-400' :
                                    pestData.stats.health_score >= 50 ? 'text-yellow-400' :
                                      pestData.stats.health_score >= 25 ? 'text-orange-400' : 'text-red-400'
                                    }`}>{pestData.stats.health_score}</span>
                                  <span className="text-[13px] text-[var(--text-muted)] mb-1">/100</span>
                                </div>
                                <div className="h-1.5 w-full bg-[var(--bg-primary)] rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-700 ${pestData.stats.health_score >= 75 ? 'bg-green-500' :
                                      pestData.stats.health_score >= 50 ? 'bg-yellow-500' :
                                        pestData.stats.health_score >= 25 ? 'bg-orange-500' : 'bg-red-500'
                                      }`}
                                    style={{ width: `${pestData.stats.health_score}%` }}
                                  />
                                </div>
                                <div className="flex justify-between text-[9px] text-[var(--text-muted)] font-mono">
                                  <span>Total Ag: {pestData.stats.total_agri_ha} ha</span>
                                  <span className="font-bold text-[var(--accent-color)]">{pestData.stats.dominant_label}</span>
                                </div>
                              </div>

                              {/* Recommended action */}
                              <div className={`rounded-xl px-3.5 py-2.5 border ${pestData.stats.dominant_risk <= 2 ? 'bg-green-500/10 border-green-500/30' :
                                pestData.stats.dominant_risk === 3 ? 'bg-yellow-500/10 border-yellow-500/30' :
                                  pestData.stats.dominant_risk === 4 ? 'bg-orange-500/10 border-orange-500/30' :
                                    'bg-red-500/10 border-red-500/30'
                                }`}>
                                <div className="text-[8px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Recommended Action</div>
                                <div className={`text-[11px] font-bold ${pestData.stats.dominant_risk <= 2 ? 'text-green-400' :
                                  pestData.stats.dominant_risk === 3 ? 'text-yellow-400' :
                                    pestData.stats.dominant_risk === 4 ? 'text-orange-400' : 'text-red-400'
                                  }`}>{pestData.stats.dominant_action}</div>
                              </div>

                              {/* Per-level breakdown */}
                              <div className="flex flex-col gap-1.5">
                                <div className="text-[8px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Risk Breakdown</div>
                                {Object.entries(pestData.stats.levels)
                                  .filter(([, v]) => v.area_ha > 0)
                                  .sort(([a], [b]) => Number(b) - Number(a))
                                  .map(([level, info]) => (
                                    <div key={level} className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-1.5">
                                      <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: info.color_hex, boxShadow: `0 0 6px ${info.color_hex}60` }} />
                                          <span className="text-[10px] font-bold text-[var(--text-main)] uppercase tracking-wide">{info.label}</span>
                                        </div>
                                        <span className="text-[10px] font-mono text-[var(--accent-color)] font-bold">{info.percentage}%</span>
                                      </div>
                                      <div className="h-[1px] bg-[var(--border-color)]/40" />
                                      <div className="grid grid-cols-2 gap-2 text-center font-mono">
                                        <div>
                                          <div className="text-[7px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Area</div>
                                          <div className="text-[11px] font-bold text-[var(--text-main)]">{info.area_ha} <span className="text-[8px] text-[var(--text-muted)]">ha</span></div>
                                        </div>
                                        <div>
                                          <div className="text-[7px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Acres</div>
                                          <div className="text-[11px] font-bold text-[var(--text-main)]">{info.area_acres}</div>
                                        </div>
                                      </div>
                                      {Number(level) >= 3 && (
                                        <div className="text-[9px] text-[var(--text-muted)] italic mt-0.5">{info.action}</div>
                                      )}
                                    </div>
                                  ))}
                              </div>
                            </>
                          ) : (
                            <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
                              <AlertTriangle size={32} className="text-orange-400 opacity-60" />
                              <div className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                                Click <strong className="text-[var(--text-main)]">Run Pest Detection</strong> to analyse crop stress using Sentinel-2 Red Edge bands (NDRE, PSRI, NDWI).
                              </div>
                              <div className="text-[9px] text-[var(--text-muted)] font-mono opacity-70">No training labels required</div>
                            </div>
                          )}
                        </div>
                      ) : activeWorkspace === 'overview' ? (
                        <>
                          {isCroppingIntensity ? (
                            <div className="flex flex-col gap-3">
                              <span className="block text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-wider mb-1">Cropping Intensity Summary</span>
                              {['Fallow Cropland', 'Single Crop', 'Double Crop', 'Triple Crop'].map((cname) => {
                                const info = resultsData?.crop_stats?.crops?.[cname];
                                if (!info) return null;
                                return (
                                  <div key={cname} className="flex flex-col gap-1">
                                    <div className="flex justify-between items-center text-[10.5px]">
                                      <div className="flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: info.color_hex }} />
                                        <span className="font-semibold text-[var(--text-main)]">{cname}</span>
                                      </div>
                                      <span className="font-bold text-[var(--accent-color)]">{info.area_ha} ha ({info.percentage}%)</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-[var(--bg-primary)]/80 rounded-full overflow-hidden">
                                      <div className="h-full rounded-full" style={{ backgroundColor: info.color_hex, width: `${info.percentage}%` }} />
                                    </div>
                                  </div>
                                );
                              })}

                              <div className="mt-2 pt-3 border-t border-[var(--border-color)]/60 flex flex-col gap-2">
                                <span className="block text-[9.5px] text-[var(--text-main)] font-space uppercase tracking-wider leading-none mb-1">Overlay Seasonal Inputs</span>
                                <div className="grid grid-cols-1 gap-1.5 text-[9px] font-mono text-[var(--text-muted)]">
                                  {[
                                    { id: 'kharif_agri', label: 'Kharif Agriculture Mask' },
                                    { id: 'rabi_agri', label: 'Rabi Agriculture Mask' },
                                    { id: 'zaid_agri', label: 'Zaid Agriculture Mask' },
                                    { id: 'kharif_crop', label: 'Kharif Crop Classification' },
                                    { id: 'rabi_crop', label: 'Rabi Crop Classification' },
                                    { id: 'zaid_crop', label: 'Zaid Crop Classification' },
                                  ].map((layer) => {
                                    const isChecked = activeSeasonalOverlay === layer.id;
                                    return (
                                      <label key={layer.id} className="flex items-center gap-2 cursor-pointer hover:text-[var(--text-main)] transition-colors select-none">
                                        <input
                                          type="checkbox"
                                          checked={isChecked}
                                          onChange={() => setActiveSeasonalOverlay(isChecked ? null : layer.id)}
                                          className="w-3.5 h-3.5 rounded bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--accent-color)] focus:ring-0 cursor-pointer"
                                        />
                                        <span>{layer.label}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-end">
                                  <span className="text-xs text-[var(--text-muted)]">Agriculture Area</span>
                                  <span className="text-xl font-light text-[var(--accent-color)]">{resultsData.stats.crop_area} <span className="text-xs text-[var(--text-muted)]">{resultsData.stats.unit}</span></span>
                                </div>
                                <div className="h-1.5 w-full bg-[var(--bg-primary)]/80 rounded-full overflow-hidden">
                                  <motion.div initial={{ width: 0 }} animate={{ width: `${(resultsData.stats.crop_area / resultsData.stats.total_area) * 100}%` }} className="h-full bg-[var(--accent-color)] rounded-full" />
                                </div>
                              </div>

                              <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-end">
                                  <span className="text-[10px] text-[var(--text-muted)]">Non-Agriculture Area</span>
                                  <span className="text-xl font-light text-[var(--text-muted)]">{resultsData.stats.non_crop_area} <span className="text-xs text-[var(--text-muted)]">{resultsData.stats.unit}</span></span>
                                </div>
                                <div className="h-1.5 w-full bg-[var(--bg-primary)]/80 rounded-full overflow-hidden">
                                  <motion.div initial={{ width: 0 }} animate={{ width: `${(resultsData.stats.non_crop_area / resultsData.stats.total_area) * 100}%` }} className="h-full bg-slate-500 rounded-full" />
                                </div>
                              </div>

                              <div className="flex items-center gap-3 pt-3 mt-1 border-t border-[var(--border-color)]/60">
                                <div className="flex-1 bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-lg p-3">
                                  <span className="block text-[10px] text-[var(--text-muted)] mb-1 font-mono uppercase tracking-wider">Total AOI Area</span>
                                  <span className="text-sm font-bold text-[var(--text-main)]">{resultsData.stats.total_area} {resultsData.stats.unit}</span>
                                </div>
                                <div className="flex-1 bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 rounded-lg p-3">
                                  <span className="block text-[10px] text-[var(--accent-color)] mb-1 font-mono uppercase tracking-wider">{resultsData?.run_type === 'lulc' ? "Cropland Ratio" : "Active Crop Ratio"}</span>
                                  <span className="text-sm font-bold text-[var(--text-main)]">{((resultsData.stats.crop_area / resultsData.stats.total_area) * 100).toFixed(1)}%</span>
                                </div>
                              </div>
                            </>
                          )}
                        </>
                      ) : activeWorkspace === 'crop' ? (
                        <>
                          {classifying ? (
                            <div className="flex flex-col items-center gap-3 py-6">
                              <div className="w-7 h-7 border-2 border-[var(--accent-color)] border-t-transparent rounded-full animate-spin" />
                              <span className="text-[10px] text-[var(--accent-color)] animate-pulse font-mono font-bold">Running Classification...</span>
                            </div>
                          ) : resultsData.crop_stats?.crops ? (
                            <div className="flex flex-col gap-3">
                              {Object.entries(resultsData.crop_stats.crops)
                                .sort(([nameA, infoA], [nameB, infoB]) => {
                                  if (nameA === 'Other') return 1;
                                  if (nameB === 'Other') return -1;
                                  return (infoB.area_ha || 0) - (infoA.area_ha || 0);
                                })
                                .map(([cropName, info]) => (
                                  <div key={cropName} className="flex flex-col gap-1.5">
                                    <div className="flex justify-between items-center">
                                      <div className="flex items-center gap-2">
                                        <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: info.color_hex }} />
                                        <span className="text-xs text-[var(--text-main)] font-semibold">{cropName}</span>
                                      </div>
                                      <div className="flex items-center gap-2.5">
                                        <span className="text-xs text-[var(--text-muted)]">{info.area_ha} ha</span>
                                        {info.est_yield_tonnes !== undefined && info.est_yield_tonnes !== null && info.est_yield_tonnes > 0 && (
                                          <span className="text-[11px] font-mono text-emerald-400 font-bold bg-emerald-950/20 px-1.5 py-0.5 rounded border border-emerald-900/30">
                                            {info.est_yield_tonnes.toFixed(1)} T
                                          </span>
                                        )}
                                        <span className="text-xs font-bold text-[var(--accent-color)] w-12 text-right">{info.percentage}%</span>
                                      </div>
                                    </div>
                                    <div className="h-1.5 w-full bg-[var(--bg-primary)]/80 rounded-full overflow-hidden">
                                      <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${info.percentage}%` }}
                                        transition={{ duration: 0.8, ease: "easeOut" }}
                                        className="h-full rounded-full"
                                        style={{ backgroundColor: info.color_hex }}
                                      />
                                    </div>
                                  </div>
                                ))}
                              <div className="mt-1 pt-3 border-t border-[var(--border-color)]/60 grid grid-cols-2 gap-2">
                                <div className="bg-[var(--border-color)]/10 border border-[var(--border-color)] p-2.5 rounded-lg flex flex-col gap-1">
                                  <span className="text-[9px] text-[var(--text-muted)] font-mono uppercase">Season</span>
                                  <span className="text-xs font-bold text-[var(--text-main)] uppercase">{resultsData.crop_stats.season}</span>
                                </div>
                                {resultsData?.run_type === 'lulc' ? (
                                  <div className="bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 p-2.5 rounded-lg flex flex-col gap-1">
                                    <span className="text-[9px] text-[var(--accent-color)] font-mono uppercase">Total Classes</span>
                                    <span className="text-xs font-bold text-[var(--text-main)]">
                                      {Object.keys(resultsData.crop_stats.crops).length} Classes
                                    </span>
                                  </div>
                                ) : (
                                  <div className="bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 p-2.5 rounded-lg flex flex-col gap-1">
                                    <span className="text-[9px] text-[var(--accent-color)] font-mono uppercase">Est. Yield</span>
                                    <span className="text-xs font-bold text-[var(--text-main)]">
                                      {Object.values(resultsData.crop_stats.crops).reduce((s, c) => s + (c.est_yield_tonnes || 0), 0).toFixed(0)} T
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-[10px] text-[var(--text-muted)] text-center py-4 font-mono">
                              No classification data found
                            </div>
                          )}
                        </>
                      ) : activeWorkspace === 'rotation' ? (
                        <>
                          {resultsData.crop_stats?.rotation_stats ? (
                            <div className="flex flex-col gap-3">
                              <span className="block text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-wider mb-1">Crop Rotation Patterns</span>
                              <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto pr-1 scrollbar-hide">
                                {Object.entries(resultsData.crop_stats.rotation_stats).map(([pattern, info]) => (
                                  <div key={pattern} className="bg-[var(--bg-primary)]/30 border border-[var(--border-color)]/30 p-2.5 rounded-xl flex flex-col gap-1.5">
                                    <div className="flex justify-between items-center">
                                      <span className="text-[10.5px] font-bold text-[var(--text-main)] truncate max-w-[170px]" title={pattern}>{pattern}</span>
                                      <span className="text-[10px] font-mono text-[var(--accent-color)] font-bold">{info.percentage}%</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-[var(--bg-primary)]/80 rounded-full overflow-hidden">
                                      <div className="h-full rounded-full" style={{ backgroundColor: info.color_hex, width: `${info.percentage}%` }} />
                                    </div>
                                    <div className="flex justify-between text-[8px] text-[var(--text-muted)] font-mono">
                                      <span>Area: {info.area_ha} ha</span>
                                      <span>Acres: {info.area_acres}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="text-[10px] text-[var(--text-muted)] text-center py-4 font-mono">
                              No crop rotation statistics found
                            </div>
                          )}
                        </>
                      ) : activeWorkspace === 'admin_stats' ? (
                        <div className="flex flex-col gap-3">
                          {/* Tab buttons to toggle between levels */}
                          <div className="flex items-center gap-1 bg-[var(--bg-primary)]/50 border border-[var(--border-color)] p-1 rounded-xl text-[9.5px] font-mono select-none">
                            {['farms', 'villages', 'blocks', 'districts'].map((tab) => (
                              <button
                                key={tab}
                                onClick={() => setActiveAdminTab(tab)}
                                className={`flex-1 py-1 rounded-lg border text-center transition-all cursor-pointer outline-none capitalize
                                  ${activeAdminTab === tab
                                    ? 'bg-[var(--accent-glow)] border-[var(--accent-color)]/30 text-[var(--accent-color)] font-bold shadow-sm'
                                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}
                              >
                                {tab}
                              </button>
                            ))}
                          </div>

                          <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto pr-1 scrollbar-hide text-[var(--text-main)]">
                            {activeAdminTab === 'farms' && resultsData.crop_stats?.farm_stats && (
                              <div className="flex flex-col gap-2">
                                {resultsData.crop_stats.farm_stats.map((farm) => (
                                  <div key={farm.farm_id} className="bg-[var(--bg-primary)]/30 border border-[var(--border-color)]/30 p-2.5 rounded-xl flex flex-col gap-1 text-[8.5px] font-mono">
                                    <div className="flex justify-between items-center text-[10px] font-bold text-[var(--text-main)] border-b border-[var(--border-color)]/20 pb-1 mb-1">
                                      <span>{farm.farm_id}</span>
                                      <span className="text-[8px] text-[var(--text-muted)] font-normal">{farm.owner}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Location:</span>
                                      <span className="text-[var(--text-muted)]">{farm.village}, {farm.block}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Total Area:</span>
                                      <span className="font-bold">{farm.area_ha} ha / {farm.area_acres} ac</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Cropping Intensity:</span>
                                      <span className="text-amber-500 font-bold">{farm.intensity}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Crop Rotation:</span>
                                      <span className="text-cyan-400 font-bold">{farm.rotation}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {activeAdminTab === 'villages' && resultsData.crop_stats?.village_stats && (
                              <div className="flex flex-col gap-2">
                                {Object.entries(resultsData.crop_stats.village_stats).map(([name, v]) => (
                                  <div key={name} className="bg-[var(--bg-primary)]/30 border border-[var(--border-color)]/30 p-2.5 rounded-xl flex flex-col gap-1 text-[8.5px] font-mono">
                                    <div className="text-[10px] font-bold text-[var(--text-main)] border-b border-[var(--border-color)]/20 pb-1 mb-1">Village: {name}</div>
                                    <div className="flex justify-between font-bold">
                                      <span>Total Cultivated:</span>
                                      <span>{v.total_area_ha} ha</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1 border-t border-[var(--border-color)]/10 pt-1 text-[var(--text-muted)]">
                                      <div className="flex justify-between"><span>Single:</span><span className="text-yellow-400 font-bold">{v.single_crop_ha} ha</span></div>
                                      <div className="flex justify-between"><span>Double:</span><span className="text-orange-400 font-bold">{v.double_crop_ha} ha</span></div>
                                      <div className="flex justify-between"><span>Triple:</span><span className="text-green-500 font-bold">{v.triple_crop_ha} ha</span></div>
                                      <div className="flex justify-between"><span>Fallow:</span><span className="text-amber-500 font-bold">{v.fallow_ha} ha</span></div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {activeAdminTab === 'blocks' && resultsData.crop_stats?.block_stats && (
                              <div className="flex flex-col gap-2">
                                {Object.entries(resultsData.crop_stats.block_stats).map(([name, b]) => (
                                  <div key={name} className="bg-[var(--bg-primary)]/30 border border-[var(--border-color)]/30 p-2.5 rounded-xl flex flex-col gap-1 text-[8.5px] font-mono">
                                    <div className="text-[10px] font-bold text-[var(--text-main)] border-b border-[var(--border-color)]/20 pb-1 mb-1">Block: {name}</div>
                                    <div className="flex justify-between font-bold">
                                      <span>Total Cultivated:</span>
                                      <span>{b.total_area_ha} ha</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1 border-t border-[var(--border-color)]/10 pt-1 text-[var(--text-muted)]">
                                      <div className="flex justify-between"><span>Single:</span><span className="text-yellow-400 font-bold">{b.single_crop_ha} ha</span></div>
                                      <div className="flex justify-between"><span>Double:</span><span className="text-orange-400 font-bold">{b.double_crop_ha} ha</span></div>
                                      <div className="flex justify-between"><span>Triple:</span><span className="text-green-500 font-bold">{b.triple_crop_ha} ha</span></div>
                                      <div className="flex justify-between"><span>Fallow:</span><span className="text-amber-500 font-bold">{b.fallow_ha} ha</span></div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {activeAdminTab === 'districts' && resultsData.crop_stats?.district_stats && (
                              <div className="flex flex-col gap-2">
                                {Object.entries(resultsData.crop_stats.district_stats).map(([name, d]) => (
                                  <div key={name} className="bg-[var(--bg-primary)]/30 border border-[var(--border-color)]/30 p-2.5 rounded-xl flex flex-col gap-1 text-[8.5px] font-mono">
                                    <div className="text-[10px] font-bold text-[var(--text-main)] border-b border-[var(--border-color)]/20 pb-1 mb-1">District: {name}</div>
                                    <div className="flex justify-between font-bold">
                                      <span>Total Cultivated:</span>
                                      <span>{d.total_area_ha} ha</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1 border-t border-[var(--border-color)]/10 pt-1 text-[var(--text-muted)]">
                                      <div className="flex justify-between"><span>Single:</span><span className="text-yellow-400 font-bold">{d.single_crop_ha} ha</span></div>
                                      <div className="flex justify-between"><span>Double:</span><span className="text-orange-400 font-bold">{d.double_crop_ha} ha</span></div>
                                      <div className="flex justify-between"><span>Triple:</span><span className="text-green-500 font-bold">{d.triple_crop_ha} ha</span></div>
                                      <div className="flex justify-between"><span>Fallow:</span><span className="text-amber-500 font-bold">{d.fallow_ha} ha</span></div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : activeWorkspace === 'lulc' ? (
                        <>
                          {resultsData.lulc_stats?.crops ? (
                            <div className="flex flex-col gap-3">
                              {Object.entries(resultsData.lulc_stats.crops)
                                .sort(([nameA, infoA], [nameB, infoB]) => {
                                  if (nameA === 'Other') return 1;
                                  if (nameB === 'Other') return -1;
                                  return (infoB.area_ha || 0) - (infoA.area_ha || 0);
                                })
                                .map(([className, info]) => (
                                  <div key={className} className="flex flex-col gap-1.5">
                                    <div className="flex justify-between items-center">
                                      <div className="flex items-center gap-2">
                                        <div className="w-3.5 h-3.5 rounded-sm flex-shrink-0" style={{ backgroundColor: info.color_hex }} />
                                        <span className="text-xs text-[var(--text-main)] font-semibold">{className}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs text-[var(--text-muted)]">{info.area_ha} ha</span>
                                        <span className="text-xs font-bold text-[var(--accent-color)] w-12 text-right">{info.percentage}%</span>
                                      </div>
                                    </div>
                                    <div className="h-1.5 w-full bg-[var(--bg-primary)]/80 rounded-full overflow-hidden">
                                      <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${info.percentage}%` }}
                                        transition={{ duration: 0.8, ease: "easeOut" }}
                                        className="h-full rounded-full"
                                        style={{ backgroundColor: info.color_hex }}
                                      />
                                    </div>
                                  </div>
                                ))}
                              <div className="mt-1 pt-3 border-t border-[var(--border-color)]/60 grid grid-cols-2 gap-2">
                                <div className="bg-[var(--border-color)]/10 border border-[var(--border-color)] p-2.5 rounded-lg flex flex-col gap-1">
                                  <span className="text-[9px] text-[var(--text-muted)] font-mono uppercase">Type</span>
                                  <span className="text-xs font-bold text-[var(--text-main)] uppercase">LULC</span>
                                </div>
                                <div className="bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 p-2.5 rounded-lg flex flex-col gap-1">
                                  <span className="text-[9px] text-[var(--accent-color)] font-mono uppercase">Total Classes</span>
                                  <span className="text-xs font-bold text-[var(--text-main)]">
                                    {Object.keys(resultsData.lulc_stats.crops).length} Classes
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-[10px] text-[var(--text-muted)] text-center py-4 font-mono">
                              No LULC classification data found
                            </div>
                          )}
                        </>
                      ) : activeWorkspace === 'monitoring' ? (
                        <>
                          <div className="flex flex-col gap-4">
                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                              <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">Vegetation Index (NDVI)</span>
                              <div className="flex justify-between items-end">
                                <span className="text-xl font-light text-[var(--accent-color)] font-space">
                                  {imgStats
                                    ? imgStats.ndvi_avg.toFixed(3)
                                    : (resultsData?.ndvi_stats?.mean !== undefined ? resultsData.ndvi_stats.mean.toFixed(3) : "0.329")}
                                  <span className="text-xs text-[var(--text-muted)] ml-1">Avg NDVI</span>
                                </span>
                                <span className={`text-[10px] font-extrabold uppercase ${(imgStats ? imgStats.ndvi_avg : (resultsData?.ndvi_stats?.mean !== undefined ? resultsData.ndvi_stats.mean : 0.329)) >= 0.5
                                  ? "text-[var(--accent-color)]"
                                  : (imgStats ? imgStats.ndvi_avg : (resultsData?.ndvi_stats?.mean !== undefined ? resultsData.ndvi_stats.mean : 0.329)) >= 0.25
                                    ? "text-amber-500"
                                    : "text-rose-500"
                                  }`}>
                                  {(imgStats ? imgStats.ndvi_avg : (resultsData?.ndvi_stats?.mean !== undefined ? resultsData.ndvi_stats.mean : 0.329)) >= 0.5
                                    ? "Excellent"
                                    : (imgStats ? imgStats.ndvi_avg : (resultsData?.ndvi_stats?.mean !== undefined ? resultsData.ndvi_stats.mean : 0.329)) >= 0.25
                                      ? "Moderate"
                                      : "Stressed"}
                                </span>
                              </div>
                              <div className="h-1.5 w-full bg-[var(--bg-primary)]/80 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${(imgStats ? imgStats.ndvi_avg : (resultsData?.ndvi_stats?.mean !== undefined ? resultsData.ndvi_stats.mean : 0.329)) >= 0.5
                                    ? "bg-emerald-500"
                                    : (imgStats ? imgStats.ndvi_avg : (resultsData?.ndvi_stats?.mean !== undefined ? resultsData.ndvi_stats.mean : 0.329)) >= 0.25
                                      ? "bg-amber-500"
                                      : "bg-rose-500"
                                    }`}
                                  style={{ width: `${(imgStats ? imgStats.ndvi_avg : (resultsData?.ndvi_stats?.mean !== undefined ? resultsData.ndvi_stats.mean : 0.329)) * 100}%` }}
                                />
                              </div>
                            </div>

                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                              <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">NDVI Range</span>
                              <div className="grid grid-cols-2 gap-2 text-center font-mono">
                                <div className="p-2 bg-[var(--bg-primary)]/60 border border-[var(--border-color)]/60 rounded-lg">
                                  <span className="text-[8px] text-[var(--text-muted)] block uppercase font-bold">Min NDVI</span>
                                  <span className="text-xs font-bold text-[var(--text-main)] block mt-0.5">
                                    {imgStats?.ndvi_min !== undefined
                                      ? imgStats.ndvi_min.toFixed(3)
                                      : (resultsData?.ndvi_stats?.min !== undefined ? resultsData.ndvi_stats.min.toFixed(3) : "-0.218")}
                                  </span>
                                </div>
                                <div className="p-2 bg-[var(--bg-primary)]/60 border border-[var(--border-color)]/60 rounded-lg">
                                  <span className="text-[8px] text-[var(--text-muted)] block uppercase font-bold">Max NDVI</span>
                                  <span className="text-xs font-bold text-[var(--accent-color)] block mt-0.5">
                                    {imgStats?.ndvi_max !== undefined
                                      ? imgStats.ndvi_max.toFixed(3)
                                      : (resultsData?.ndvi_stats?.max !== undefined ? resultsData.ndvi_stats.max.toFixed(3) : "0.814")}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : activeWorkspace === 'moisture' ? (
                        <>
                          <div className="flex flex-col gap-4">
                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                              <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">Avg Soil Moisture (VWC)</span>
                              <div className="flex justify-between items-end">
                                <span className="text-xl font-light text-blue-500 font-space">
                                  {imgStats
                                    ? imgStats.vwc_avg.toFixed(1)
                                    : (resultsData?.ndwi_stats?.vwc !== undefined ? resultsData.ndwi_stats.vwc.toFixed(1) : "25.0")}%
                                  <span className="text-xs text-[var(--text-muted)] ml-1">VWC</span>
                                </span>
                                <span className={`text-[10px] font-extrabold uppercase ${(imgStats ? imgStats.vwc_avg : (resultsData?.ndwi_stats?.vwc !== undefined ? resultsData.ndwi_stats.vwc : 25.0)) >= 30.0
                                  ? "text-blue-500"
                                  : (imgStats ? imgStats.vwc_avg : (resultsData?.ndwi_stats?.vwc !== undefined ? resultsData.ndwi_stats.vwc : 25.0)) >= 20.0
                                    ? "text-teal-500"
                                    : "text-rose-500"
                                  }`}>
                                  {(imgStats ? imgStats.vwc_avg : (resultsData?.ndwi_stats?.vwc !== undefined ? resultsData.ndwi_stats.vwc : 25.0)) >= 30.0
                                    ? "Optimal"
                                    : (imgStats ? imgStats.vwc_avg : (resultsData?.ndwi_stats?.vwc !== undefined ? resultsData.ndwi_stats.vwc : 25.0)) >= 20.0
                                      ? "Adequate"
                                      : "Dry Deficit"}
                                </span>
                              </div>
                              <div className="h-1.5 w-full bg-[var(--bg-primary)]/80 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${(imgStats ? imgStats.vwc_avg : (resultsData?.ndwi_stats?.vwc !== undefined ? resultsData.ndwi_stats.vwc : 25.0)) >= 30.0
                                    ? "bg-blue-500"
                                    : (imgStats ? imgStats.vwc_avg : (resultsData?.ndwi_stats?.vwc !== undefined ? resultsData.ndwi_stats.vwc : 25.0)) >= 20.0
                                      ? "bg-teal-500"
                                      : "bg-rose-500"
                                    }`}
                                  style={{
                                    width: `${((imgStats ? imgStats.vwc_avg : (resultsData?.ndwi_stats?.vwc !== undefined ? resultsData.ndwi_stats.vwc : 25.0)) - 10.0) / 40.0 * 100}%`
                                  }}
                                />
                              </div>
                            </div>

                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                              <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">Water Index (NDWI)</span>
                              <div className="flex justify-between items-end">
                                <span className="text-xl font-light text-cyan-400 font-space">
                                  {imgStats
                                    ? imgStats.ndwi_avg.toFixed(3)
                                    : (resultsData?.ndwi_stats?.mean !== undefined ? resultsData.ndwi_stats.mean.toFixed(3) : "-0.395")}
                                  <span className="text-xs text-[var(--text-muted)] ml-1">Avg NDWI</span>
                                </span>
                              </div>
                            </div>

                            <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                              <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">NDWI Range</span>
                              <div className="grid grid-cols-2 gap-2 text-center font-mono">
                                <div className="p-2 bg-[var(--bg-primary)]/60 border border-[var(--border-color)]/60 rounded-lg">
                                  <span className="text-[8px] text-[var(--text-muted)] block uppercase font-bold">Min NDWI</span>
                                  <span className="text-xs font-bold text-[var(--text-main)] block mt-0.5">
                                    {imgStats?.ndwi_min !== undefined
                                      ? imgStats.ndwi_min.toFixed(3)
                                      : (resultsData?.ndwi_stats?.min !== undefined ? resultsData.ndwi_stats.min.toFixed(3) : "-0.719")}
                                  </span>
                                </div>
                                <div className="p-2 bg-[var(--bg-primary)]/60 border border-[var(--border-color)]/60 rounded-lg">
                                  <span className="text-[8px] text-[var(--text-muted)] block uppercase font-bold">Max NDWI</span>
                                  <span className="text-xs font-bold text-cyan-400 block mt-0.5">
                                    {imgStats?.ndwi_max !== undefined
                                      ? imgStats.ndwi_max.toFixed(3)
                                      : (resultsData?.ndwi_stats?.max !== undefined ? resultsData.ndwi_stats.max.toFixed(3) : "0.385")}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : activeWorkspace === 'acre' ? (
                        <>
                          <div className="flex flex-col gap-3">
                            {(resultsData.crop_stats?.crops || resultsData.lulc_stats?.crops) ? (
                              <>
                                {(() => {
                                  const cropData = resultsData.crop_stats?.crops || {};
                                  const items = Object.entries(cropData).map(([name, info]) => ({
                                    name,
                                    info,
                                    type: 'crop'
                                  }));

                                  return items
                                    .sort((a, b) => {
                                      if (a.name === 'Other') return 1;
                                      if (b.name === 'Other') return -1;
                                      return (b.info.area_ha || 0) - (a.info.area_ha || 0);
                                    })
                                    .filter(({ info }) => (info.area_ha || 0) > 0)
                                    .map(({ name, info }) => (
                                      <div key={name} className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] hover:border-[var(--accent-color)]/30 rounded-xl p-3.5 flex flex-col gap-2.5 transition-all duration-300 shadow-sm group">
                                        {/* Header */}
                                        <div className="flex justify-between items-center">
                                          <div className="flex items-center gap-2">
                                            <span className="w-3 h-3 rounded-full flex-shrink-0 animate-pulse" style={{ backgroundColor: info.color_hex, boxShadow: `0 0 8px ${info.color_hex}40` }} />
                                            <span className="text-[11px] font-bold text-[var(--text-main)] font-space tracking-wide uppercase">{name}</span>
                                          </div>
                                          <div className="flex items-center gap-1 bg-[var(--accent-glow)] border border-[var(--accent-color)]/25 px-2 py-0.5 rounded-lg">
                                            <span className="text-[12px] font-extrabold text-[var(--accent-color)] font-mono">{(info.est_yield_tonnes || 0).toFixed(1)}</span>
                                            <span className="text-[9px] text-[var(--accent-color)] font-mono uppercase opacity-80">T</span>
                                          </div>
                                        </div>

                                        {/* Divider */}
                                        <div className="h-[1px] bg-gradient-to-r from-[var(--border-color)]/50 to-transparent" />

                                        {/* 3 Columns Metrics */}
                                        <div className="grid grid-cols-3 divide-x divide-[var(--border-color)]/30 text-center font-mono">
                                          {/* Area Column */}
                                          <div className="flex flex-col justify-center px-1">
                                            <span className="text-[8px] text-[var(--text-muted)] uppercase tracking-wider mb-1 font-bold">Area</span>
                                            <div className="flex items-baseline justify-center">
                                              <span className="text-[12px] font-bold text-[var(--text-main)] leading-none">{info.area_ha.toFixed(2)}</span>
                                              <span className="text-[8px] text-[var(--text-muted)] ml-0.5">ha</span>
                                            </div>
                                          </div>

                                          {/* Acres Column */}
                                          <div className="flex flex-col justify-center px-1">
                                            <span className="text-[8px] text-[var(--text-muted)] uppercase tracking-wider mb-1 font-bold">Acres</span>
                                            <span className="text-[12px] font-bold text-[var(--text-main)] leading-none">{(info.area_ha * 2.471).toFixed(1)}</span>
                                          </div>

                                          {/* Yield/Ha Column */}
                                          <div className="flex flex-col justify-center px-1">
                                            <span className="text-[8px] text-[var(--accent-color)] uppercase tracking-wider mb-1 font-bold">Yield / Ha</span>
                                            <div className="flex items-baseline justify-center">
                                              <span className="text-[12px] font-extrabold text-[var(--accent-color)] leading-none">{(info.yield_t_ha || 0).toFixed(3)}</span>
                                              <span className="text-[8px] text-[var(--accent-color)] ml-0.5 font-bold">T</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ));
                                })()}
                                <div className="pt-3 border-t border-[var(--border-color)]/60 flex flex-col gap-2">
                                  {resultsData?.run_type === 'combined' ? (
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="col-span-2 bg-[var(--bg-primary)]/50 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-1.5">
                                        <span className="block text-[8px] text-[var(--text-muted)] font-mono uppercase tracking-wider font-bold">LULC Area</span>
                                        <div className="flex items-baseline">
                                          <span className="text-[14px] font-bold text-[var(--text-main)] leading-none">{resultsData.stats.total_area}</span>
                                          <span className="text-[9px] text-[var(--text-muted)] ml-1">ha</span>
                                        </div>
                                      </div>
                                      <div className="bg-[var(--bg-primary)]/50 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-1.5">
                                        <span className="block text-[8px] text-[var(--text-muted)] font-mono uppercase tracking-wider font-bold">Cropland</span>
                                        <div className="flex items-baseline">
                                          <span className="text-[14px] font-bold text-[var(--text-main)] leading-none">{resultsData.stats.crop_area}</span>
                                          <span className="text-[9px] text-[var(--text-muted)] ml-1">ha</span>
                                        </div>
                                      </div>
                                      <div className="bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 rounded-xl p-3 flex flex-col gap-1.5 shadow-[0_0_12px_var(--accent-glow)]/10">
                                        <span className="block text-[8px] text-[var(--accent-color)] font-mono uppercase tracking-wider font-bold">Est. Yield</span>
                                        <div className="flex items-baseline">
                                          <span className="text-[14px] font-extrabold text-[var(--text-main)] leading-none">
                                            {Object.values(resultsData.crop_stats?.crops || {}).reduce((s, c) => s + (c.est_yield_tonnes || 0), 0).toFixed(0)}
                                          </span>
                                          <span className="text-[9px] text-[var(--accent-color)] ml-1 font-bold">T</span>
                                        </div>
                                      </div>
                                    </div>
                                  ) : resultsData?.run_type === 'lulc' ? (
                                    <div className="grid grid-cols-2 gap-2.5">
                                      <div className="bg-[var(--bg-primary)]/50 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-1.5">
                                        <span className="block text-[8px] text-[var(--text-muted)] font-mono uppercase tracking-wider font-bold">Total LULC Area</span>
                                        <div className="flex items-baseline">
                                          <span className="text-[15px] font-bold text-[var(--text-main)] leading-none">{resultsData.stats.total_area}</span>
                                          <span className="text-[10px] text-[var(--text-muted)] ml-1">ha</span>
                                        </div>
                                      </div>
                                      <div className="bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 rounded-xl p-3 flex flex-col gap-1.5 shadow-[0_0_12px_var(--accent-glow)]/10">
                                        <span className="block text-[8px] text-[var(--accent-color)] font-mono uppercase tracking-wider font-bold">Total Cropland</span>
                                        <div className="flex items-baseline">
                                          <span className="text-[15px] font-extrabold text-[var(--text-main)] leading-none">{resultsData.stats.crop_area}</span>
                                          <span className="text-[10px] text-[var(--accent-color)] ml-1 font-bold">ha</span>
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="grid grid-cols-2 gap-2.5">
                                      <div className="bg-[var(--bg-primary)]/50 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-1.5">
                                        <span className="block text-[8px] text-[var(--text-muted)] font-mono uppercase tracking-wider font-bold">Total Crop Area</span>
                                        <div className="flex items-baseline">
                                          <span className="text-[15px] font-bold text-[var(--text-main)] leading-none">{resultsData.stats.crop_area}</span>
                                          <span className="text-[10px] text-[var(--text-muted)] ml-1">ha</span>
                                        </div>
                                      </div>
                                      <div className="bg-[var(--accent-glow)] border border-[var(--accent-color)]/30 rounded-xl p-3 flex flex-col gap-1.5 shadow-[0_0_12px_var(--accent-glow)]/10">
                                        <span className="block text-[8px] text-[var(--accent-color)] font-mono uppercase tracking-wider font-bold">Est. Total Yield</span>
                                        <div className="flex items-baseline">
                                          <span className="text-[15px] font-extrabold text-[var(--text-main)] leading-none">
                                            {Object.values(resultsData.crop_stats.crops).reduce((s, c) => s + (c.est_yield_tonnes || 0), 0).toFixed(0)}
                                          </span>
                                          <span className="text-[10px] text-[var(--accent-color)] ml-1 font-bold">T</span>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </>
                            ) : (
                              <div className="text-[10px] text-[var(--text-muted)] text-center py-4 font-mono">
                                Run classification to view yield details
                              </div>
                            )}
                          </div>
                        </>
                      ) : activeWorkspace === 'carbon' ? (
                        <>
                          {resultsData.carbon_stats ? (
                            <div className="flex flex-col gap-4 text-[var(--text-main)]">
                              {/* Carbon Stock Card */}
                              <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                                <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">Total Carbon Sequestered</span>
                                <div className="flex justify-between items-end">
                                  <span className="text-xl font-light text-emerald-500 font-space">
                                    {resultsData.carbon_stats.total_carbon_stock_tonnes.toLocaleString()}
                                    <span className="text-xs text-[var(--text-muted)] ml-1">Tonnes C</span>
                                  </span>
                                </div>
                              </div>

                              {/* CO2 Equivalent Card */}
                              <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                                <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">CO2 Equivalent Offset</span>
                                <div className="flex justify-between items-end">
                                  <span className="text-xl font-light text-blue-400 font-space">
                                    {resultsData.carbon_stats.co2_equivalent_tonnes.toLocaleString()}
                                    <span className="text-xs text-[var(--text-muted)] ml-1">t CO2e</span>
                                  </span>
                                </div>
                              </div>

                              {/* Average SOC % Card */}
                              <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                                <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">Average SOC Concentration</span>
                                <div className="flex justify-between items-end">
                                  <span className="text-xl font-light text-[var(--accent-color)] font-space">
                                    {resultsData.carbon_stats.average_soc_percent.toFixed(3)}%
                                    <span className="text-xs text-[var(--text-muted)] ml-1">SOC</span>
                                  </span>
                                </div>
                              </div>

                              {/* Crop breakdown list */}
                              <div className="flex flex-col gap-2 mt-2">
                                <span className="text-[9.5px] font-bold text-[var(--text-main)] font-space uppercase tracking-wider mb-1">Carbon Storage by Crop</span>
                                <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-0.5 scrollbar-hide">
                                  {Object.entries(resultsData.crop_stats?.crops || resultsData.lulc_stats?.crops || {})
                                    .sort((a, b) => b[1].carbon_stock_tonnes - a[1].carbon_stock_tonnes)
                                    .filter(([_, info]) => (info.area_ha || 0) > 0)
                                    .map(([cropName, info]) => (
                                      <div key={`carbon-breakdown-${cropName}`} className="flex items-center justify-between text-[10px] bg-[var(--bg-primary)]/20 border border-[var(--border-color)]/30 rounded-lg p-2 font-mono">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: info.color_hex }} />
                                          <span className="text-[var(--text-main)] truncate">{cropName}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[var(--text-muted)]">{(info.soc_percent * 100).toFixed(1)}% SOC</span>
                                          <span className="font-bold text-emerald-400">{(info.carbon_stock_tonnes || 0).toLocaleString()} T</span>
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-[10px] text-[var(--text-muted)] text-center py-4 font-mono">
                              No carbon data available
                            </div>
                          )}
                        </>
                      ) : activeWorkspace === 'methane' ? (
                        <>
                          {resultsData.methane_stats ? (
                            <div className="flex flex-col gap-4 text-[var(--text-main)]">
                              {/* Methane Emissions Card */}
                              <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                                <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">Total Methane Released</span>
                                <div className="flex justify-between items-end">
                                  <span className="text-xl font-light text-rose-400 font-space">
                                    {resultsData.methane_stats.total_methane_emissions_kg.toLocaleString()}
                                    <span className="text-xs text-[var(--text-muted)] ml-1">kg CH4</span>
                                  </span>
                                </div>
                              </div>

                              {/* CO2 Equivalent Card */}
                              <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                                <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">CO2 Equivalent GWP-28</span>
                                <div className="flex justify-between items-end">
                                  <span className="text-xl font-light text-amber-500 font-space">
                                    {resultsData.methane_stats.co2_equivalent_tonnes.toLocaleString()}
                                    <span className="text-xs text-[var(--text-muted)] ml-1">t CO2e</span>
                                  </span>
                                </div>
                              </div>

                              {/* Average Concentration Card */}
                              <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-3 flex flex-col gap-3">
                                <span className="text-[9px] text-[var(--text-muted)] uppercase font-mono tracking-wider">Avg Sentinel-5P Mixing Ratio</span>
                                <div className="flex justify-between items-end">
                                  <span className="text-xl font-light text-cyan-400 font-space">
                                    {resultsData.methane_stats.average_concentration_ppb.toFixed(1)}
                                    <span className="text-xs text-[var(--text-muted)] ml-1">ppb</span>
                                  </span>
                                </div>
                              </div>

                              {/* Crop breakdown list */}
                              <div className="flex flex-col gap-2 mt-2">
                                <span className="text-[9.5px] font-bold text-[var(--text-main)] font-space uppercase tracking-wider mb-1">Methane footprint by crop</span>
                                <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-0.5 scrollbar-hide">
                                  {Object.entries(resultsData.crop_stats?.crops || resultsData.lulc_stats?.crops || {})
                                    .sort((a, b) => b[1].methane_emissions_kg - a[1].methane_emissions_kg)
                                    .filter(([_, info]) => (info.area_ha || 0) > 0)
                                    .map(([cropName, info]) => (
                                      <div key={`methane-breakdown-${cropName}`} className="flex items-center justify-between text-[10px] bg-[var(--bg-primary)]/20 border border-[var(--border-color)]/30 rounded-lg p-2 font-mono">
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: info.color_hex }} />
                                          <span className="text-[var(--text-main)] truncate">{cropName}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[var(--text-muted)]">{info.area_ha} ha</span>
                                          <span className="font-bold text-rose-400">{(info.methane_emissions_kg || 0).toLocaleString()} kg</span>
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-[10px] text-[var(--text-muted)] text-center py-4 font-mono">
                              No methane data available
                            </div>
                          )}
                        </>
                      ) : (
                        // Database runs manager workspace
                        <div className="flex flex-col gap-3 max-h-[62vh] overflow-y-auto pr-1 scrollbar-hide">
                          {loadingRuns ? (
                            <div className="flex flex-col items-center gap-3 py-10">
                              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                              <span className="text-[10px] text-emerald-400 font-mono">Loading Database...</span>
                            </div>
                          ) : runsList.length === 0 ? (
                            <div className="text-center text-[10px] text-[var(--text-muted)] py-10 font-mono leading-relaxed border border-dashed border-[var(--border-color)] rounded-xl p-4 bg-[var(--card-bg)]/20">
                              No runs found in SQLite database.<br />Runs are auto-saved here when analysis completes successfully.
                            </div>
                          ) : (
                            runsList.map((run) => (
                              <div
                                key={run.id}
                                className="bg-[var(--card-bg)] hover:bg-[var(--border-color)]/20 border border-[var(--border-color)] hover:border-[var(--accent-color)]/30 rounded-xl p-4 flex flex-col gap-3 transition-all duration-300 shadow-md group relative text-[var(--text-main)]"
                              >
                                <div className="flex justify-between items-start gap-2">
                                  <div className="min-w-0 flex-1">
                                    <h4 className="text-xs font-bold text-[var(--text-main)] truncate pr-6 font-space uppercase tracking-wider" title={run.boundary_name}>
                                      {run.boundary_name}
                                    </h4>
                                    <div className="flex items-center gap-1.5 mt-1.5">
                                      <span className="text-[8px] font-mono bg-[var(--accent-glow)] border border-[var(--accent-color)]/20 text-[var(--accent-color)] px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                                        {run.season}
                                      </span>
                                      <span className="text-[8px] font-mono bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-muted)] px-2 py-0.5 rounded font-medium">
                                        {run.year}
                                      </span>
                                    </div>
                                  </div>

                                  <button
                                    onClick={(e) => handleDeleteRun(run.id, e)}
                                    className="absolute top-4 right-4 text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 p-1.5 rounded transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
                                    title="Delete from database"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>

                                <div className="grid grid-cols-2 gap-3 text-[10px] font-mono text-[var(--text-muted)] border-t border-[var(--border-color)]/60 pt-3">
                                  <div>
                                    <span className="text-[var(--text-muted)] opacity-70 block text-[7.5px] font-bold uppercase leading-none mb-1">Agri Area</span>
                                    <span className="text-[var(--text-main)] font-semibold">{run.crop_area} ha</span>
                                  </div>
                                  <div>
                                    <span className="text-[var(--text-muted)] opacity-70 block text-[7.5px] font-bold uppercase leading-none mb-1">Ratio</span>
                                    <span className="text-[var(--accent-color)] font-bold">
                                      {run.total_area > 0 ? ((run.crop_area / run.total_area) * 100).toFixed(1) : 0}%
                                    </span>
                                  </div>
                                </div>

                                <div className="text-[8.5px] font-mono text-[var(--text-muted)] opacity-80 flex flex-col gap-1 border-t border-[var(--border-color)]/60 pt-3">
                                  <div className="truncate block" title={run.output_dir}>
                                    <span className="text-[var(--text-muted)] font-bold">PATH:</span> .../{run.output_dir.replace(/\\/g, "/").split("/").pop()}
                                  </div>
                                  <div className="flex justify-between items-center text-[8px] text-[var(--text-muted)] opacity-70 mt-0.5">
                                    <span>ID: {run.id}</span>
                                    <span>{new Date(run.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                                  </div>
                                </div>

                                <button
                                  onClick={() => handleLoadRun(run.id)}
                                  className="w-full h-8 mt-1 bg-[var(--accent-color)] hover:brightness-110 border border-[var(--accent-color)]/40 text-black font-bold text-[9.5px] font-space uppercase rounded-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md hover:shadow-lg hover:shadow-[var(--accent-color)]/20 active:scale-[0.98]"
                                >
                                  <Database size={11} />
                                  Load Analysis Run
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {/* Integrated 3-Day Weather Details for Single Image Selection */}
                      {!compareMode && selectedImgA && (() => {
                        const sceneA = weatherPatternsData?.scenes_weather?.find(
                          s => s.filename === selectedImgA?.filename || s.date === selectedImgA?.date
                        );
                        if (!sceneA) return null;
                        return (
                          <div className="flex flex-col gap-2 pt-3 mt-3 border-t border-[var(--border-color)]/60">
                            <span className="text-[10.5px] font-bold text-[var(--text-main)] uppercase tracking-wider font-space">
                              Preceding 3-Day Weather
                            </span>
                            <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-0.5 scrollbar-hide">
                              {sceneA.weather_window.map((day, idx) => renderDayWeatherRow(day, idx))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Weather Patterns Workspace Dashboard */}
            {activeWorkspace === 'weather' && (
              <div className={`absolute left-4 right-4 top-4 ${satelliteImages.length > 0 ? 'bottom-[220px]' : 'bottom-4'} flex flex-col gap-4 pointer-events-auto z-20 overflow-hidden`}>

                {loadingWeather ? (
                  <div className="flex-1 glass-panel rounded-2xl flex flex-col items-center justify-center gap-4 bg-[var(--glass-surface)] border border-[var(--border-color)] shadow-xl">
                    <div className="w-8 h-8 border-2 border-[var(--accent-color)] border-t-transparent rounded-full animate-spin" />
                    <span className="text-[10px] text-[var(--accent-color)] font-mono font-bold animate-pulse">
                      Analyzing Seasonal Weather Data...
                    </span>
                  </div>
                ) : weatherPatternsData ? (
                  <div className="flex-1 w-full flex flex-col gap-4 min-h-0 min-w-0">

                    {/* Season-wide Trend Chart */}
                    <div className="flex-1 glass-panel rounded-2xl p-4 flex flex-col shadow-xl bg-[var(--glass-surface)] border border-[var(--border-color)] overflow-hidden min-h-0">
                      <div className="flex items-center justify-between mb-3 flex-shrink-0 flex-wrap gap-2">
                        <div className="flex items-center gap-3 flex-wrap font-mono">
                          <span className="text-[10px] font-bold text-[var(--text-main)] font-space uppercase tracking-wider">
                            Weather Trends
                          </span>
                        </div>
                        <span className="text-[8.5px] font-mono text-[var(--text-muted)] uppercase">
                          Season-wide trend analysis
                        </span>
                      </div>

                      <div className="flex-1 min-h-0 w-full text-xs font-mono">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            key="season-wide-trend-chart"
                            data={weatherPatternsData.daily_trends}
                            margin={{ top: 10, right: 5, left: -20, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(16, 185, 129, 0.04)" />
                            <XAxis
                              dataKey="formatted_date"
                              stroke="var(--text-muted)"
                              tickLine={false}
                              axisLine={{ stroke: 'rgba(16, 185, 129, 0.1)' }}
                              tick={{ fill: 'var(--text-muted)', fontSize: 8 }}
                            />
                            <YAxis
                              yAxisId="temp"
                              stroke="#f87171"
                              tickLine={false}
                              axisLine={{ stroke: 'rgba(248, 113, 113, 0.15)' }}
                              tick={{ fill: '#f87171', fontSize: 8 }}
                              domain={['auto', 'auto']}
                            />
                            <YAxis
                              yAxisId="rain"
                              orientation="right"
                              stroke="#38bdf8"
                              tickLine={false}
                              axisLine={{ stroke: 'rgba(56, 189, 248, 0.15)' }}
                              tick={{ fill: '#38bdf8', fontSize: 8 }}
                            />
                            <ChartTooltip
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  return (
                                    <div className="glass-panel rounded-xl p-3 border border-[var(--border-color)]/70 shadow-2xl bg-[var(--card-bg)] text-[10px] font-mono flex flex-col gap-1">
                                      <span className="font-bold text-[var(--text-main)] border-b border-[var(--border-color)]/50 pb-1 mb-1 font-space">
                                        {data.formatted_date}
                                      </span>
                                      <span className="text-[#f87171]">Max Temp: {data.temp_max}°C</span>
                                      <span className="text-[#60a5fa]">Min Temp: {data.temp_min}°C</span>
                                      <span className="text-[#38bdf8]">Rainfall: {data.precipitation} mm</span>
                                      <span className="text-teal-400">Humidity: {data.humidity}%</span>
                                      <span className="text-amber-500">Wind Speed: {data.wind_speed} km/h</span>
                                      {data.has_scene && (
                                        <span className="text-[var(--accent-color)] font-bold mt-1 uppercase flex items-center gap-1">
                                          ● Sentinel-2 Capture Day
                                        </span>
                                      )}
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Bar
                              yAxisId="rain"
                              name="Rainfall (mm)"
                              dataKey="precipitation"
                              fill="#38bdf8"
                              opacity={0.35}
                              radius={[2, 2, 0, 0]}
                              barSize={5}
                            />
                            <Line
                              yAxisId="temp"
                              name="Max Temp (°C)"
                              type="monotone"
                              dataKey="temp_max"
                              stroke="#f87171"
                              strokeWidth={2}
                              dot={false}
                            />
                            <Line
                              yAxisId="temp"
                              name="Min Temp (°C)"
                              type="monotone"
                              dataKey="temp_min"
                              stroke="#60a5fa"
                              strokeWidth={1.5}
                              dot={false}
                            />
                            {weatherPatternsData.daily_trends
                              .filter(d => d.has_scene)
                              .map((sceneDay) => {
                                const matchingScene = weatherPatternsData.scenes_weather.find(
                                  s => s.iso_date === sceneDay.date
                                );
                                return (
                                  <ReferenceDot
                                    key={`ref-dot-${sceneDay.date}`}
                                    yAxisId="temp"
                                    x={sceneDay.formatted_date}
                                    y={sceneDay.temp_max}
                                    r={5}
                                    fill="var(--accent-color)"
                                    stroke="#ffffff"
                                    strokeWidth={1.5}
                                    className="cursor-pointer transition-transform hover:scale-125"
                                    style={{ filter: "drop-shadow(0 0 6px var(--accent-color))" }}
                                    onClick={() => {
                                      if (matchingScene) {
                                        const img = satelliteImages.find(i => i.date === matchingScene.date);
                                        if (img) {
                                          setSelectedImgA(img);
                                          setCompareMode(false);
                                          setArcgisMode(true);
                                          setFitTriggerA(prev => prev + 1);
                                          setFitTriggerB(prev => prev + 1);
                                        }
                                      }
                                    }}
                                  />
                                );
                              })}
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="flex-1 glass-panel rounded-2xl flex items-center justify-center text-xs text-[var(--text-muted)] font-mono bg-[var(--glass-surface)] border border-[var(--border-color)]">
                    No weather patterns loaded for this run.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Timeline Strip Overlay */}
          {satelliteImages.length > 0 && (
            <div className="absolute bottom-4 left-4 right-4 h-[195px] bg-[var(--glass-surface)] backdrop-blur-xl border border-[var(--border-color)] rounded-2xl p-4 shadow-2xl pointer-events-auto z-30 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[9.5px] font-bold tracking-wider font-space text-[var(--text-main)] uppercase">SATELLITE SCENES ARCHIVE</span>
                  <span className="bg-[var(--bg-primary)] border border-[var(--border-color)] text-[7.5px] text-[var(--text-muted)] px-1.5 py-0.25 rounded-full font-mono font-bold">
                    {satelliteImages.length} TILES
                  </span>
                </div>
              </div>

              {/* Scrolling row */}
              <div
                ref={archiveScrollRef}
                onWheel={handleArchiveWheel}
                className="flex-1 flex gap-3 overflow-x-auto pb-1 scrollbar-hide"
              >
                {satelliteImages.map((img) => {
                  const isA = selectedImgA?.filename === img.filename;
                  const isB = compareMode && selectedImgB?.filename === img.filename;

                  return (
                    <div
                      key={img.filename}
                      onClick={() => {
                        if (compareMode) {
                          if (hoveredMap === 'B') {
                            setSelectedImgB(img);
                          } else {
                            setSelectedImgA(img);
                          }
                        } else {
                          setSelectedImgA(img);
                          setCompareMode(false);
                        }
                        setArcgisMode(true);
                        setFitTriggerA(prev => prev + 1);
                        setFitTriggerB(prev => prev + 1);
                      }}
                      className={`flex-shrink-0 w-[130px] bg-[var(--bg-primary)]/40 border rounded-xl p-2 flex flex-col gap-1.5 transition-all duration-300 cursor-pointer relative group overflow-hidden
                          ${isA && isB
                          ? 'border-amber-500 bg-amber-500/10 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                          : isA
                            ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                            : isB
                              ? 'border-cyan-500 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                              : 'border-[var(--border-color)] hover:border-[var(--accent-color)]/30 hover:bg-[var(--border-color)]/10'}`}
                    >
                      {/* Image preview */}
                      <div className="h-[88px] w-full rounded-lg bg-black border border-[var(--border-color)]/60 overflow-hidden relative flex-shrink-0">
                        {/* Map indicator badge overlay */}
                        <div className="absolute top-1 left-1 flex gap-1.5 z-10 pointer-events-none">
                          {isA && (
                            <span className="w-4 h-4 rounded bg-emerald-500 text-slate-950 font-extrabold text-[8.5px] flex items-center justify-center border border-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]">
                              A
                            </span>
                          )}
                          {isB && (
                            <span className="w-4 h-4 rounded bg-cyan-500 text-slate-950 font-extrabold text-[8.5px] flex items-center justify-center border border-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.5)]">
                              B
                            </span>
                          )}
                        </div>

                        <img
                          src={`${img.url}&mask=false`}
                          alt={img.date}
                          className="w-full h-full object-contain p-1 opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                        <div className="hidden absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-950 items-center justify-center">
                          <span className="text-[8px] text-[var(--text-muted)] uppercase font-mono">{img.month}</span>
                        </div>
                        {/* Eye overlay for interaction feedback */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                          <Eye size={16} className="text-white drop-shadow-[0_0_4px_rgba(0,0,0,0.5)]" />
                        </div>
                      </div>

                      {/* Label */}
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-bold text-[var(--text-main)] truncate leading-none">{img.date}</span>
                        <span className="text-[7.5px] text-[var(--text-muted)] font-mono tracking-wider uppercase leading-none mt-0.5">{img.month} SCAN</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── PREMIUM INTELLIGENT FOOTER ────────────────────────────────── */}
      <footer className="h-7 border-t border-[var(--border-color)] bg-[var(--glass-surface)] backdrop-blur px-6 flex items-center justify-between text-[8.5px] font-mono text-[var(--text-muted)] tracking-wider z-50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[var(--text-main)]">RS-AIMS v2.0</span>
        </div>
        <div>
          <span className="text-[var(--text-main)] font-semibold">{liveTime}</span>
        </div>
      </footer>
    </div>
  );
};

export default IntelligenceWorkspace;