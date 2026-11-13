"""
pest_detection.py — RS-AIMS Crop Stress & Pest Risk Detection Engine
======================================================================
Uses Sentinel-2 Red Edge + SWIR bands already present in the downloaded .tif
files to compute multi-index stress scores without any training labels.

Band order in .tif (set by download_imagery.py):
  Band 1 = B4  (Red,      665 nm)
  Band 2 = B3  (Green,    560 nm)
  Band 3 = B2  (Blue,     490 nm)
  Band 4 = B8  (NIR,      842 nm)
  Band 5 = B11 (SWIR-1,  1610 nm)
  Band 6 = B1  (Coastal)
  Band 7 = B5  (RedEdge1, 705 nm)  ← key for NDRE / CIre
  Band 8 = B6  (RedEdge2, 740 nm)
  Band 9 = B7  (RedEdge3, 783 nm)
  Band 10= B8A (Narrow NIR, 865nm) ← key for NDRE
  Band 11= B9  (Water vapour)
  Band 12= B12 (SWIR-2)

Risk Levels:
  0  = No Data / Non-agricultural
  1  = Healthy      (NDRE > 0.35)
  2  = Low Stress   (0.25–0.35)
  3  = Medium Risk  (0.15–0.25)
  4  = High Risk    (0.05–0.15)
  5  = Severe Risk  (NDRE ≤ 0.05 AND PSRI elevated)
"""

import os
import glob
import numpy as np
import rasterio
from rasterio.enums import Resampling
from PIL import Image
import warnings
warnings.filterwarnings("ignore")


# ─── Risk level definitions ───────────────────────────────────────────────────
RISK_LEVELS = {
    0: {"label": "No Data",      "color": (0,   0,   0,   0),   "action": ""},
    1: {"label": "Healthy",      "color": (34,  197, 94,  200),  "action": "No action needed"},
    2: {"label": "Low Stress",   "color": (234, 179, 8,   200),  "action": "Monitor field weekly"},
    3: {"label": "Medium Risk",  "color": (249, 115, 22,  210),  "action": "Scout field in-person"},
    4: {"label": "High Risk",    "color": (239, 68,  68,  220),  "action": "Apply targeted treatment"},
    5: {"label": "Severe Risk",  "color": (185, 28,  28,  240),  "action": "Immediate intervention required"},
}

# ─── Safe normalized difference helper ────────────────────────────────────────
def _safe_nd(a, b):
    """Normalized difference: (a - b) / (a + b), avoids division by zero."""
    denom = a + b
    nd = np.where(np.abs(denom) > 1e-6, (a - b) / denom, 0.0)
    return nd.astype(np.float32)


def _load_bands(tif_path):
    """
    Load all 12 Sentinel-2 bands from a .tif into float32 arrays.
    Returns dict of band arrays normalized to 0–1 reflectance (divide by 10000).
    Returns None if file cannot be opened.
    """
    try:
        with rasterio.open(tif_path) as src:
            count = src.count
            if count < 10:
                return None  # not a full Sentinel-2 tif

            def _read(b):
                arr = src.read(b).astype(np.float32)
                arr = np.where(arr < 0, 0.0, arr)
                return arr / 10000.0  # DN → reflectance

            return {
                "B4":  _read(1),   # Red
                "B3":  _read(2),   # Green
                "B2":  _read(3),   # Blue
                "B8":  _read(4),   # NIR
                "B11": _read(5),   # SWIR-1
                "B5":  _read(7),   # RedEdge1
                "B6":  _read(8),   # RedEdge2
                "B7":  _read(9),   # RedEdge3
                "B8A": _read(10),  # Narrow NIR
                "meta": src.meta.copy(),
                "transform": src.transform,
                "crs": src.crs,
            }
    except Exception as e:
        print(f"  [PestDet] Could not load {tif_path}: {e}")
        return None


def compute_indices(bands):
    """
    Compute stress indices from band dict.
    Returns dict of 2D float32 arrays clipped to [-1, 1] or [0, 1].
    """
    B4  = bands["B4"]
    B3  = bands["B3"]
    B2  = bands["B2"]
    B8  = bands["B8"]
    B11 = bands["B11"]
    B5  = bands["B5"]
    B6  = bands["B6"]
    B7  = bands["B7"]
    B8A = bands["B8A"]

    # ── 1. NDRE — Normalized Difference Red Edge ───────────────────────────
    # (B8A - B5) / (B8A + B5): chlorophyll content, early stress indicator
    ndre = _safe_nd(B8A, B5)
    ndre = np.clip(ndre, -1.0, 1.0)

    # ── 2. NDVI — standard greenness baseline ─────────────────────────────
    ndvi = _safe_nd(B8, B4)
    ndvi = np.clip(ndvi, -1.0, 1.0)

    # ── 3. CIre — Red Edge Chlorophyll Index ──────────────────────────────
    # (B7 / B5) - 1: linear with chlorophyll, 0 = fully stressed
    denom_cire = np.where(B5 > 1e-6, B5, 1e-6)
    cire = (B7 / denom_cire) - 1.0
    cire = np.clip(cire, 0.0, 5.0) / 5.0   # normalize to 0–1

    # ── 4. PSRI — Plant Senescence Reflectance Index ──────────────────────
    # (B4 - B2) / B6: high PSRI = carotenoid dominance = senescence / pest
    denom_psri = np.where(np.abs(B6) > 1e-6, B6, 1e-6)
    psri = (B4 - B2) / denom_psri
    psri = np.clip(psri, -1.0, 1.0)

    # ── 5. NDWI plant water — (B8A - B11) / (B8A + B11) ──────────────────
    # low NDWI = water stress (sucking pests, drought)
    ndwi_plant = _safe_nd(B8A, B11)
    ndwi_plant = np.clip(ndwi_plant, -1.0, 1.0)

    # ── 6. MCARI — Modified Chlorophyll Absorption Reflectance Index ──────
    # [(B5-B4) - 0.2*(B5-B3)] * (B5/B4)
    denom_b4 = np.where(B4 > 1e-6, B4, 1e-6)
    mcari = ((B5 - B4) - 0.2 * (B5 - B3)) * (B5 / denom_b4)
    mcari = np.clip(mcari, -1.0, 2.0)
    mcari = (mcari + 1.0) / 3.0   # normalize to ~0–1

    return {
        "ndre":      ndre,
        "ndvi":      ndvi,
        "cire":      cire,
        "psri":      psri,
        "ndwi_plant": ndwi_plant,
        "mcari":     mcari,
    }


def compute_risk_map(indices, agri_mask=None):
    """
    Relative (z-score) stress detection.

    Instead of absolute NDRE thresholds, this compares each pixel to the
    FIELD'S OWN median NDRE. Pixels significantly below the field average are
    flagged as stressed — automatically adapting to any growth stage, season,
    or crop type.

    z = (field_median_NDRE - pixel_NDRE) / field_std_NDRE

    Thresholds (in standard deviations below mean):
      Healthy    : z < 0.75
      Low Stress : 0.75 – 1.25
      Medium Risk: 1.25 – 2.0
      High Risk  : 2.0  – 2.75
      Severe Risk: z >= 2.75

    A 30% blend with a weak absolute floor prevents the entire field from
    being labelled Healthy when all crops are severely stressed.
    """
    ndre      = indices["ndre"]
    psri      = indices["psri"]
    ndwi      = indices["ndwi_plant"] 
    ndvi      = indices["ndvi"]

    # Build validity mask (pixels with some vegetation)
    valid = ndvi > 0.08
    if agri_mask is not None:
        valid = valid & agri_mask.astype(bool)

    # ── 1. Relative NDRE z-score ─────────────────────────────────────────────
    valid_ndre = ndre[valid]
    if valid_ndre.size > 10:
        field_mean = float(np.nanmedian(valid_ndre))   # median is more robust than mean
        field_std  = float(np.nanstd(valid_ndre))
        # Minimum std-dev guard: avoid division by near-zero in uniform fields
        field_std  = max(field_std, 0.03)
    else:
        field_mean = 0.30
        field_std  = 0.08

    print(f"  [PestDet] Field NDRE median={field_mean:.3f}  std={field_std:.3f}", flush=True)

    # z > 0 means pixel is BELOW the field mean (stressed direction)
    z_ndre = (field_mean - ndre) / field_std
    z_ndre = np.clip(z_ndre, -2.0, 6.0).astype(np.float32)

    # ── 2. Absolute floor component (30% weight) ─────────────────────────────
    # Ensures severely stressed absolute values still get flagged
    # even if the entire field is uniformly stressed.
    abs_stress = np.clip((0.35 - ndre) / 0.35, 0.0, 1.0)  # 0 @ ndre=0.35+
    abs_z_equiv = abs_stress * 3.5   # scale to same z range (max ≈3.5 std devs)

    # ── 3. Combined score (70% relative + 30% absolute) ──────────────────────
    combined_z = 0.70 * z_ndre + 0.30 * abs_z_equiv

    # PSRI boost: adds up to +0.5 z-units for senescence signs
    psri_boost = np.clip((psri + 0.10) / 0.40, 0.0, 1.0) * 0.5
    combined_z = combined_z + psri_boost

    combined_z = np.clip(combined_z, -2.0, 6.0).astype(np.float32)

    # ── 4. Classify ───────────────────────────────────────────────────────────
    risk = np.zeros_like(combined_z, dtype=np.uint8)
    risk[valid & (combined_z < 0.75)]                           = 1  # Healthy
    risk[valid & (combined_z >= 0.75) & (combined_z < 1.25)]    = 2  # Low Stress
    risk[valid & (combined_z >= 1.25) & (combined_z < 2.00)]    = 3  # Medium Risk
    risk[valid & (combined_z >= 2.00) & (combined_z < 2.75)]    = 4  # High Risk
    risk[valid & (combined_z >= 2.75)]                           = 5  # Severe Risk

    score_map = np.where(valid, combined_z * 20.0, 0.0).astype(np.float32)
    score_map = np.clip(score_map, 0.0, 100.0).astype(np.float32)
    return risk, score_map


def risk_to_rgba_png(risk_map):
    """Convert integer risk map to RGBA PNG bytes."""
    h, w = risk_map.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for level, info in RISK_LEVELS.items():
        mask = risk_map == level
        rgba[mask] = info["color"]
    img = Image.fromarray(rgba, "RGBA")

    # Slight upscale for visibility on map
    target_w = min(w * 2, 2048)
    target_h = min(h * 2, 2048)
    img = img.resize((target_w, target_h), Image.NEAREST)

    import io
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    buf.seek(0)
    return buf.read()


def compute_risk_stats(risk_map, pixel_area_ha=0.01):
    """
    Return per-level area stats and dominant risk.

    pixel_area_ha: area of one pixel in hectares.
      At 10m resolution: (10×10)m² = 100 m² = 0.01 ha
    """
    stats = {}
    total_agri = int(np.sum(risk_map > 0))
    total_ha = round(total_agri * pixel_area_ha, 2)

    for level, info in RISK_LEVELS.items():
        if level == 0:
            continue
        count = int(np.sum(risk_map == level))
        area_ha = round(count * pixel_area_ha, 2)
        pct = round((count / total_agri * 100) if total_agri > 0 else 0.0, 1)
        stats[level] = {
            "label":     info["label"],
            "action":    info["action"],
            "pixels":    count,
            "area_ha":   area_ha,
            "area_acres": round(area_ha * 2.471, 2),
            "percentage": pct,
            "color_hex": "#{:02x}{:02x}{:02x}".format(*info["color"][:3]),
        }

    # Dominant level (excluding Healthy)
    stressed_levels = {k: v for k, v in stats.items() if k > 1}
    dominant = max(stressed_levels, key=lambda k: stressed_levels[k]["pixels"]) if stressed_levels else 1

    # Overall field health score (100 = fully healthy, weighted across levels)
    # Level 1=Healthy(100), 2=Low(75), 3=Medium(45), 4=High(15), 5=Severe(0)
    LEVEL_HEALTH = {1: 100.0, 2: 75.0, 3: 45.0, 4: 15.0, 5: 0.0}
    if total_agri > 0:
        weighted_sum = sum(
            LEVEL_HEALTH.get(lv, 0.0) * stats.get(lv, {}).get("pixels", 0)
            for lv in range(1, 6)
        )
        health_score = round(weighted_sum / total_agri, 1)
    else:
        health_score = 0.0

    return {
        "levels":       stats,
        "total_agri_ha": total_ha,
        "dominant_risk": dominant,
        "dominant_label": RISK_LEVELS[dominant]["label"],
        "dominant_action": RISK_LEVELS[dominant]["action"],
        "health_score":  health_score,
        "pixel_area_ha": pixel_area_ha,
    }


def run_pest_detection(output_dir, agri_mask_path=None):
    """
    Main entry point. Scans output_dir for Sentinel-2 .tif files,
    picks the most recent one, computes risk map, and saves outputs.

    Saves:
      output_dir/pest_risk_map.tif   — GeoTIFF of risk levels (0–5)
      output_dir/pest_risk_map.png   — RGBA overlay PNG

    Returns dict with stats and file paths, or raises on failure.
    """
    output_dir = os.path.normpath(output_dir)

    # ── Find .tif files (skip derived products) ───────────────────────────
    all_tifs = sorted(glob.glob(os.path.join(output_dir, "*.tif")))
    sentinel_tifs = [
        t for t in all_tifs
        if not any(skip in os.path.basename(t) for skip in [
            "Final_Agri", "NDVI", "NDWI", "Crop_Class", "LULC",
            "pest_risk", "Refined", "Mask"
        ])
    ]

    if not sentinel_tifs:
        raise FileNotFoundError(f"No Sentinel-2 .tif files found in {output_dir}")

    # Use the latest image for current stress snapshot
    tif_path = sentinel_tifs[-1]
    print(f"  [PestDet] Using image: {os.path.basename(tif_path)}", flush=True)

    # ── Load bands ─────────────────────────────────────────────────────────
    bands = _load_bands(tif_path)
    if bands is None:
        raise ValueError(f"Could not load Sentinel-2 bands from {tif_path}")

    # ── Load agricultural mask if available ────────────────────────────────
    agri_mask = None
    if agri_mask_path and os.path.exists(agri_mask_path):
        with rasterio.open(agri_mask_path) as src:
            mask_data = src.read(1)
            # Resize to match the band spatial shape if needed
            band_shape = bands["B4"].shape
            if mask_data.shape != band_shape:
                from PIL import Image as PILImg
                mask_img = PILImg.fromarray(mask_data.astype(np.uint8))
                mask_img = mask_img.resize((band_shape[1], band_shape[0]), PILImg.NEAREST)
                mask_data = np.array(mask_img)
            agri_mask = (mask_data == 1)
        print(f"  [PestDet] Agri mask loaded: {int(agri_mask.sum())} ag pixels", flush=True)

    # ── Compute indices ────────────────────────────────────────────────────
    print("  [PestDet] Computing stress indices...", flush=True)
    indices = compute_indices(bands)

    # ── Compute risk map ───────────────────────────────────────────────────
    print("  [PestDet] Classifying risk levels...", flush=True)
    risk_map, score_map = compute_risk_map(indices, agri_mask=agri_mask)

    # ── Estimate pixel area ────────────────────────────────────────────────
    try:
        crs = bands["crs"]
        transform = bands["transform"]
        res_x = abs(transform.a)
        res_y = abs(transform.e)

        # Detect geographic CRS (units = degrees, e.g. WGS84 from GEE export)
        is_geographic = False
        if crs is not None:
            try:
                from pyproj import CRS as ProjCRS
                crs_obj = ProjCRS(crs.to_wkt())
                is_geographic = crs_obj.is_geographic
            except Exception:
                # Fallback: if res_x < 0.01 it's almost certainly in degrees
                is_geographic = (res_x < 0.01)

        if is_geographic:
            # Convert degree resolution → meters using center-latitude
            center_lat = transform.f + transform.e * (bands["B4"].shape[0] / 2.0)
            lat_rad = abs(center_lat) * (3.14159265358979 / 180.0)
            m_per_deg_lat = 111320.0
            m_per_deg_lon = 111320.0 * np.cos(lat_rad)
            pixel_area_m2 = res_x * m_per_deg_lon * res_y * m_per_deg_lat
        else:
            pixel_area_m2 = res_x * res_y

        pixel_area_ha = pixel_area_m2 / 10000.0
        # Sanity check: EE exports at 10m → 0.01 ha/pixel
        if pixel_area_ha <= 0 or pixel_area_ha > 1.0:
            pixel_area_ha = 0.01
        print(f"  [PestDet] Pixel area: {pixel_area_m2:.2f} m² → {pixel_area_ha:.6f} ha", flush=True)
    except Exception as e:
        print(f"  [PestDet] Pixel area fallback (error: {e})", flush=True)
        pixel_area_ha = 0.01  # default 10m × 10m = 100m² = 0.01 ha

    # ── Statistics ────────────────────────────────────────────────────────
    stats = compute_risk_stats(risk_map, pixel_area_ha=pixel_area_ha)

    # ── Save risk GeoTIFF ─────────────────────────────────────────────────
    tif_out = os.path.join(output_dir, "pest_risk_map.tif")
    meta = bands["meta"].copy()
    meta.update({"count": 1, "dtype": "uint8", "nodata": 0})
    with rasterio.open(tif_out, "w", **meta) as dst:
        dst.write(risk_map[np.newaxis, :, :])
    print(f"  [PestDet] Saved risk GeoTIFF: {tif_out}", flush=True)

    # ── Save RGBA PNG overlay ─────────────────────────────────────────────
    png_out = os.path.join(output_dir, "pest_risk_map.png")
    png_bytes = risk_to_rgba_png(risk_map)
    with open(png_out, "wb") as f:
        f.write(png_bytes)
    print(f"  [PestDet] Saved risk PNG: {png_out}", flush=True)

    return {
        "status": "success",
        "source_image": os.path.basename(tif_path),
        "risk_tif": tif_out,
        "risk_png": png_out,
        "stats": stats,
    }
