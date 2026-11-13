import os
import glob
import json
import rasterio
import numpy as np
import geopandas as gpd
from rasterio.features import shapes
from rasterio.warp import calculate_default_transform, reproject, Resampling
from shapely.geometry import shape
from datetime import datetime
from scipy.ndimage import binary_dilation, binary_erosion, uniform_filter, label
import warnings

# ─────────────────────────────────────────────────────────────────────────────
# RS-AIMS  |  Advanced Agriculture Land Extraction + Phenology-based Classification
# ─────────────────────────────────────────────────────────────────────────────

CSV_PATH = os.path.join(os.path.dirname(__file__), "crop_phenology_trends_final.csv")

MONTH_MAP = {"Jan":1,"Feb":2,"Mar":3,"Apr":4,"May":5,"Jun":6,
             "Jul":7,"Aug":8,"Sep":9,"Oct":10,"Nov":11,"Dec":12}

# ── Crop registry — codes, display colors, yields ────────────────────────────
# IMPORTANT: crop 'name' MUST match exactly the column prefix in the CSV
# (e.g. "Wheat" matches "Wheat_NDVI_Mean", "Bajra" matches "Bajra_NDVI_Mean")
CROP_REGISTRY = {
    'rabi': {
        # Benchmarks: Rajasthan state avg (MoA India 2022-23)
        # ref_ndvi / ref_biomass / ref_growth derived from crop_phenology_trends_final.csv
        # Wheat  CSV peak months: Oct(0.134) Nov(0.210) Dec(0.401) Jan(0.460) Feb(0.382) Mar(0.186)
        # Mustard CSV peak months: Oct(0.105) Nov(0.109) Dec(0.197) Jan(0.262) Feb(0.255) Mar(0.085)
        1: {'name': 'Wheat',   'color': (253, 208,  23, 170), 'yield_t_ha': 3.12,
            'ref_ndvi': 0.460, 'ref_biomass': 0.295, 'ref_growth': 0.109},
        2: {'name': 'Mustard', 'color': (219,  39, 119, 170), 'yield_t_ha': 1.45,
            'ref_ndvi': 0.262, 'ref_biomass': 0.169, 'ref_growth': 0.052},
        3: {'name': 'Gram',    'color': ( 13, 148, 136, 170), 'yield_t_ha': 0.95,
            'ref_ndvi': 0.220, 'ref_biomass': 0.170, 'ref_growth': 0.040},
        4: {'name': 'Other',   'color': ( 34, 197,  94, 170), 'yield_t_ha': 1.80,
            'ref_ndvi': 0.350, 'ref_biomass': 0.250, 'ref_growth': 0.060},
    },
    'kharif': {
        # Rice: Odisha avg; others: India national avg (MoA 2022-23)
        # Rice   CSV Jun(0.242) Sep(0.211) Oct(0.561) Nov(0.432)
        # Cotton CSV Jun(0.207) Sep(0.771) Oct(0.418) Nov(0.361)
        # Bajra  CSV Sep(0.761) Oct(0.489) Nov(0.308)
        # Maize  CSV Sep(0.642) Oct(0.335) Nov(0.270)
        1: {'name': 'Rice',    'color': (  0, 180, 216, 170), 'yield_t_ha': 2.10,
            'ref_ndvi': 0.561, 'ref_biomass': 0.362, 'ref_growth': 0.175},
        2: {'name': 'Cotton',  'color': (226, 232, 240, 170), 'yield_t_ha': 1.60,
            'ref_ndvi': 0.771, 'ref_biomass': 0.439, 'ref_growth': 0.282},
        3: {'name': 'Bajra',   'color': (251, 191,  36, 170), 'yield_t_ha': 1.65,
            'ref_ndvi': 0.761, 'ref_biomass': 0.411, 'ref_growth': 0.337},
        4: {'name': 'Maize',   'color': (249, 115,  22, 170), 'yield_t_ha': 2.90,
            'ref_ndvi': 0.642, 'ref_biomass': 0.344, 'ref_growth': 0.256},
        5: {'name': 'Other',   'color': ( 34, 197,  94, 170), 'yield_t_ha': 1.80,
            'ref_ndvi': 0.500, 'ref_biomass': 0.350, 'ref_growth': 0.150},
    },
    'zaid': {
        1: {'name': 'Vegetables',  'color': ( 16, 185, 129, 170), 'yield_t_ha': 14.0,
            'ref_ndvi': 0.550, 'ref_biomass': 0.420, 'ref_growth': 0.080},
        2: {'name': 'Melon/Gourd', 'color': (245, 158,  11, 170), 'yield_t_ha': 11.0,
            'ref_ndvi': 0.480, 'ref_biomass': 0.360, 'ref_growth': 0.060},
        3: {'name': 'Other',       'color': (148, 163, 184, 170), 'yield_t_ha':  2.0,
            'ref_ndvi': 0.380, 'ref_biomass': 0.280, 'ref_growth': 0.040},
    }
}

# Crops to attempt phenology matching per season (must be a column prefix in the CSV)
SEASON_CANDIDATES = {
    'rabi':   ['Wheat', 'Mustard'],
    'kharif': ['Rice', 'Cotton', 'Bajra', 'Maize'],
    'zaid':   [],
}

# Minimum correlation score to trust the match; below this → 'Other'
CORR_THRESHOLD = 0.20


def parse_date_from_filename(filename):
    """Extract date from filename format: SEASON_DD-MM-YYYY_HH-MM.tif"""
    try:
        parts = os.path.basename(filename).split("_")
        if len(parts) >= 2:
            return datetime.strptime(parts[1], "%d-%m-%Y")
    except Exception:
        pass
    return datetime.min


# ─────────────────────────────────────────────────────────────────────────────
# Phenology table loader
# ─────────────────────────────────────────────────────────────────────────────

def load_phenology(csv_path=CSV_PATH):
    """
    Parse crop_phenology_trends_final.csv.
    Returns dict: { crop_name: { 'ndvi': {month_int: float}, 'ndwi': {...} } }
    Zero values are treated as missing data (no satellite coverage that month).
    """
    if not os.path.exists(csv_path):
        print(f"  [Phenology] CSV not found at {csv_path} — falling back to rule-based", flush=True)
        return {}

    import csv
    result = {}
    with open(csv_path, newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            month = MONTH_MAP.get(row['Month'].strip())
            if month is None:
                continue

            for key, raw_val in row.items():
                if key == 'Month':
                    continue
                try:
                    val = float(raw_val)
                except ValueError:
                    continue

                # Treat 0.0 as missing (cloud-obscured month)
                val = float('nan') if val == 0.0 else val

                # "Wheat_NDVI_Mean" → crop="Wheat", index="ndvi"
                parts = key.split('_')
                if len(parts) < 3:
                    continue
                crop      = parts[0]          # e.g. "Wheat"
                idx_type  = parts[1].lower()  # e.g. "ndvi", "ndwi", "gndvi"

                if crop not in result:
                    result[crop] = {}
                if idx_type not in result[crop]:
                    result[crop][idx_type] = {}
                result[crop][idx_type][month] = val

    print(f"  [Phenology] Loaded data for: {list(result.keys())}", flush=True)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Vectorised Pearson correlation (pixels × template)
# ─────────────────────────────────────────────────────────────────────────────

def batch_pearson(pixels, template):
    """
    Compute Pearson correlation between every row of `pixels` and `template`.

    Parameters
    ----------
    pixels   : (N, T) float32 array — per-pixel temporal NDVI/NDWI values (may contain NaN)
    template : (T,)  float64 array — crop phenology template (may contain NaN)

    Returns
    -------
    corr : (N,) float32 — correlation in [-1, 1]; 0 where insufficient data
    """
    T = template.shape[0]
    valid_t = ~np.isnan(template)
    n_valid = valid_t.sum()

    if n_valid < 3:
        return np.zeros(pixels.shape[0], dtype='float32')

    P = pixels[:, valid_t].copy().astype('float64')  # (N, n_valid)
    T_ = template[valid_t]                            # (n_valid,)

    # Fill pixel NaN with per-column mean (uses surrounding pixel data)
    for j in range(n_valid):
        nan_mask = np.isnan(P[:, j])
        if nan_mask.any():
            col_mean = np.nanmean(P[:, j])
            P[nan_mask, j] = col_mean if not np.isnan(col_mean) else 0.0

    P_mean = P.mean(axis=1, keepdims=True)
    T_mean = T_.mean()
    P_c = P - P_mean
    T_c = T_ - T_mean

    num   = (P_c * T_c).sum(axis=1)                         # (N,)
    P_std = np.sqrt((P_c ** 2).sum(axis=1))                 # (N,)
    T_std = np.sqrt((T_c ** 2).sum())

    denom = P_std * T_std
    denom = np.where(denom < 1e-8, 1e-8, denom)

    return (num / denom).astype('float32')


# ─────────────────────────────────────────────────────────────────────────────
# Main crop classification
# ─────────────────────────────────────────────────────────────────────────────

def classify_crops(agri_mask, ndvi_stack, ndwi_stack,
                   ndvi_max, ndvi_amp, ndvi_std,
                   tif_files, season, phenology=None):
    """
    Phenology-based crop classification using Pearson correlation against
    per-month NDVI (and NDWI where available) templates from the CSV.

    For each agricultural pixel:
      1. Extract temporal NDVI profile (T values, one per downloaded image)
      2. For each candidate crop, build a template from CSV values at those months
      3. Compute weighted correlation:
             score = 0.75 × NDVI_corr + 0.25 × NDWI_corr
         (NDWI weight applied only when template has ≥3 valid months)
      4. Assign the crop with the highest score if score ≥ CORR_THRESHOLD,
         otherwise fall back to 'Other'.

    Returns
    -------
    crop_class : uint8 ndarray, same spatial shape as agri_mask
    stats      : dict — per-crop area / percentage / yield estimates
    """
    if phenology is None:
        phenology = load_phenology()

    season = season.lower()
    registry   = CROP_REGISTRY.get(season, CROP_REGISTRY['rabi'])
    candidates = SEASON_CANDIDATES.get(season, [])

    # Build crop_name → registry_code mapping
    name_to_code = {info['name']: code for code, info in registry.items()}

    # Fallback code for "Other" in this season
    other_code = max(registry.keys())

    T, H, W = ndvi_stack.shape
    crop_class  = np.zeros((H, W), dtype='uint8')
    on_agri     = agri_mask == 1
    agri_rows, agri_cols = np.where(on_agri)
    N = len(agri_rows)

    image_months = [parse_date_from_filename(f).month for f in tif_files]
    print(f"  [Classify] Season={season.upper()}  Candidates={candidates}  "
          f"Images={len(tif_files)}  Months={image_months}  AgriPx={N}", flush=True)

    # ── Phenology-based path ──────────────────────────────────────────────────
    valid_crops = [c for c in candidates if c in phenology and c in name_to_code]

    if N > 0 and valid_crops:
        # Extract pixel vectors for agri pixels only
        pix_ndvi = ndvi_stack[:, agri_rows, agri_cols].T  # (N, T)
        pix_ndwi = ndwi_stack[:, agri_rows, agri_cols].T  # (N, T)

        C = len(valid_crops)
        scores = np.full((N, C), -1.0, dtype='float32')

        for c_idx, crop_name in enumerate(valid_crops):
            # Build template vectors for this crop at each image month
            ndvi_tpl  = np.array([phenology[crop_name]['ndvi'].get(m, np.nan)
                                   for m in image_months], dtype='float64')
            ndwi_data = phenology[crop_name].get('ndwi', {})
            ndwi_tpl  = np.array([ndwi_data.get(m, np.nan)
                                   for m in image_months], dtype='float64')

            ndvi_corr = batch_pearson(pix_ndvi, ndvi_tpl)  # (N,)

            # NDWI contribution (only when template has ≥3 valid months)
            ndwi_valid_months = (~np.isnan(ndwi_tpl)).sum()
            if ndwi_valid_months >= 3:
                ndwi_corr = batch_pearson(pix_ndwi, ndwi_tpl)
                scores[:, c_idx] = 0.75 * ndvi_corr + 0.25 * ndwi_corr
            else:
                scores[:, c_idx] = ndvi_corr

            print(f"    {crop_name:<10} template_ndvi={np.nanmean(ndvi_tpl):.3f}  "
                  f"mean_corr={float(np.nanmean(ndvi_corr)):.3f}", flush=True)

        best_idx   = np.argmax(scores, axis=1)        # (N,)
        best_score = scores[np.arange(N), best_idx]  # (N,)

        for i in range(N):
            if best_score[i] >= CORR_THRESHOLD:
                code = name_to_code[valid_crops[best_idx[i]]]
            else:
                # Below confidence threshold — assign "Gram" for Rabi or "Other"
                code = 3 if season == 'rabi' else other_code
            crop_class[agri_rows[i], agri_cols[i]] = code

    elif N > 0:
        # ── Fallback: simple rule-based (no CSV or no matching crops) ────────
        print("  [Classify] No phenology templates - using rule-based fallback", flush=True)
        if season == 'rabi':
            wheat   = on_agri & (ndvi_max >= 0.55) & (ndvi_amp >= 0.25)
            mustard = on_agri & ~wheat & (ndvi_max >= 0.42) & (ndvi_max < 0.68)
            gram    = on_agri & ~wheat & ~mustard
            crop_class[wheat]   = 1
            crop_class[mustard] = 2
            crop_class[gram]    = 3
        elif season == 'kharif':
            paddy   = on_agri & (ndvi_max >= 0.55) & (ndvi_std >= 0.04)
            cotton  = on_agri & ~paddy & (ndvi_max >= 0.60)
            bajra   = on_agri & ~paddy & ~cotton & (ndvi_max >= 0.50)
            maize   = on_agri & ~paddy & ~cotton & ~bajra
            crop_class[paddy]  = 1
            crop_class[cotton] = 2
            crop_class[bajra]  = 3
            crop_class[maize]  = 4
        else:
            crop_class[on_agri & (ndvi_max >= 0.50)] = 1
            crop_class[on_agri & (crop_class == 0)]  = 2

    # ── Per-crop stats with full formula ──────────────────────────────────────
    #
    # Yield = (a·Biomass + b·NDVIpeak + c·GrowthRate) · StressFactor · CropScale
    #
    # Feature definitions (all computed per-pixel from the NDVI/NDWI stacks):
    #   Biomass     = Σ NDVI(t)            — temporal integral, main yield driver
    #   NDVIpeak    = max(NDVI(t))          — peak canopy density
    #   GrowthRate  = (NDVIpeak - NDVI_t0) / (t_peak - t_0)  — crop vigor slope
    #   StressFactor= clip(1 - |NDWI_min|, 0.3, 1.0)  — water stress (low NDWI = stressed)
    #
    # Coefficients (a=0.50, b=0.35, c=0.15) reflect relative importance:
    #   Biomass dominates because it integrates the full growing season.
    #   NDVIpeak captures maximum canopy density at harvest readiness.
    #   GrowthRate adds crop vigor — fast-establishing crops yield better.
    #
    # CropScale: calibration constant derived from phenology CSV reference.
    #   At reference conditions (CSV values), formula output = state benchmark yield.
    #   Any pixel better/worse than reference scales proportionally.

    A, B, C = 0.50, 0.35, 0.15  # formula coefficients

    # ── Step 1: Compute spatial feature maps ─────────────────────────────────
    T_count = ndvi_stack.shape[0]

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)

        # Biomass = Mean NDVI(t) — robust to cloud cover (NaN values)
        biomass_map = np.nanmean(ndvi_stack, axis=0)               # (H, W)

        # NDVIpeak already passed as ndvi_max

        # GrowthRate = (NDVIpeak - NDVI_first) / t_peak_index
        ndvi_start_map = ndvi_stack[0].copy()                     # (H, W) first image
        nan_start = np.isnan(ndvi_start_map)
        if nan_start.any():
            # Fill NaN starts with the next valid value per pixel
            for t in range(1, T_count):
                fill_mask = nan_start & ~np.isnan(ndvi_stack[t])
                ndvi_start_map[fill_mask] = ndvi_stack[t][fill_mask]
                nan_start = nan_start & np.isnan(ndvi_start_map)
        # Index of the temporal peak per pixel
        peak_t_map = np.nanargmax(
            np.where(np.isnan(ndvi_stack), -999, ndvi_stack), axis=0
        ).astype('float32')                                        # (H, W)
        denom = np.where(peak_t_map == 0, 1.0, peak_t_map)       # avoid /0
        growth_rate_map = np.clip(
            (ndvi_max - ndvi_start_map) / denom, 0.0, 1.0        # (H, W)
        )

        # StressFactor = clip(1 - |NDWI_min|, 0.30, 1.00)
        # Low NDWI (negative = dry) → high |NDWI_min| → lower stress factor
        ndwi_min_map = np.nanmin(ndwi_stack, axis=0)              # (H, W)
        stress_map   = np.clip(1.0 - np.abs(ndwi_min_map), 0.30, 1.00)

    # ── Step 2: Raw yield index map ───────────────────────────────────────────
    raw_yield_map = (A * biomass_map + B * ndvi_max + C * growth_rate_map) * stress_map

    # ── Step 3: CropScale calibration using phenology CSV ────────────────────
    # For each crop, build reference feature values from CSV at the observed months.
    # CropScale = benchmark_yield_t_ha / (raw_index_ref · stress_ref)
    # At reference conditions the formula returns exactly the state benchmark yield.

    def _crop_scale(crop_name, info, image_months):
        """Derive CropScale from phenology CSV reference values."""
        if crop_name not in phenology:
            return 1.0   # no CSV data → fallback constant

        ndvi_ref  = [phenology[crop_name]['ndvi'].get(m, np.nan) for m in image_months]
        ndwi_ref  = [phenology[crop_name].get('ndwi', {}).get(m, np.nan) for m in image_months]

        ndvi_ref  = np.array(ndvi_ref)
        ndwi_ref  = np.array(ndwi_ref)

        valid = ~np.isnan(ndvi_ref)
        if valid.sum() < 2:
            return 1.0

        ndvi_ref_clean  = np.where(np.isnan(ndvi_ref), 0.0, ndvi_ref)
        biomass_ref     = float(np.nanmean(ndvi_ref))
        ndvi_peak_ref   = float(np.nanmax(ndvi_ref))
        peak_t_ref      = int(np.nanargmax(ndvi_ref_clean))
        ndvi_start_ref  = float(ndvi_ref_clean[0])
        denom_ref       = max(peak_t_ref, 1)
        growth_ref      = float(np.clip((ndvi_peak_ref - ndvi_start_ref) / denom_ref, 0.0, 1.0))

        ndwi_min_ref    = float(np.nanmin(ndwi_ref)) if not np.all(np.isnan(ndwi_ref)) else -0.15
        stress_ref      = float(np.clip(1.0 - abs(ndwi_min_ref), 0.30, 1.00))

        raw_ref = (A * biomass_ref + B * ndvi_peak_ref + C * growth_ref) * stress_ref
        if raw_ref < 1e-6:
            return 1.0

        return info['yield_t_ha'] / raw_ref

    # ── Step 4: Per-crop statistics ───────────────────────────────────────────
    PIXEL_AREA_M2 = 100   # GEE exports at scale=10 → ~10×10m per pixel
    total_agri_px = int(on_agri.sum())
    stats = {}

    for code, info in registry.items():
        crop_mask = (crop_class == code)
        px = int(np.sum(crop_mask))

        if px == 0:
            stats[info['name']] = {
                'code': code, 'pixels': 0,
                'area_ha': 0.0, 'area_acres': 0.0, 'percentage': 0.0,
                'yield_t_ha': info['yield_t_ha'], 'base_yield_t_ha': info['yield_t_ha'],
                'est_yield_tonnes': 0.0,
                'biomass': None, 'ndvi_peak': None,
                'growth_rate': None, 'stress_factor': None,
                'color_hex': '#{:02x}{:02x}{:02x}'.format(*info['color'][:3])
            }
            continue

        area_ha    = round((px * PIXEL_AREA_M2) / 10000, 2)
        area_acres = round(area_ha * 2.47105, 2)
        pct        = round((px / total_agri_px * 100) if total_agri_px > 0 else 0, 1)

        # Mean feature values over this crop's classified pixels
        mean_biomass     = float(np.nanmean(biomass_map[crop_mask]))
        mean_ndvi_peak   = float(np.nanmean(ndvi_max[crop_mask]))
        mean_growth_rate = float(np.nanmean(growth_rate_map[crop_mask]))
        mean_stress      = float(np.nanmean(stress_map[crop_mask]))

        # CropScale from CSV calibration
        crop_scale = _crop_scale(info['name'], info, image_months)

        # Final formula: yield per ha at mean conditions for this crop class
        raw_index  = A * mean_biomass + B * mean_ndvi_peak + C * mean_growth_rate
        yield_t_ha = round(raw_index * mean_stress * crop_scale, 3)
        yield_t_ha = max(yield_t_ha, 0.10)   # floor: always some yield if crop detected

        # Clamp to ±50% of benchmark to avoid extreme outliers without ground truth
        lo = info['yield_t_ha'] * 0.50
        hi = info['yield_t_ha'] * 1.50
        yield_t_ha = round(float(np.clip(yield_t_ha, lo, hi)), 3)

        est_yield = round(area_ha * yield_t_ha, 1)

        stats[info['name']] = {
            'code':               code,
            'pixels':             px,
            'area_ha':            area_ha,
            'area_acres':         area_acres,
            'percentage':         pct,
            'yield_t_ha':         yield_t_ha,
            'base_yield_t_ha':    info['yield_t_ha'],
            'est_yield_tonnes':   est_yield,
            # Feature breakdown for transparency
            'biomass':            round(mean_biomass, 3),
            'ndvi_peak':          round(mean_ndvi_peak, 3),
            'growth_rate':        round(mean_growth_rate, 3),
            'stress_factor':      round(mean_stress, 3),
            'crop_scale':         round(crop_scale, 4),
            'color_hex': '#{:02x}{:02x}{:02x}'.format(*info['color'][:3])
        }

    print(f"\n  Yield Formula Results (season={season.upper()}):")
    print(f"  Coefficients: a={A} (Biomass)  b={B} (NDVIpeak)  c={C} (GrowthRate)")
    for name, s in stats.items():
        if s['pixels'] == 0:
            continue
        bar = '#' * int(s['percentage'] / 5)
        print(f"    {name:<14}: {s['area_ha']:7.1f} ha  "
              f"B={s['biomass']:.2f}  N={s['ndvi_peak']:.3f}  "
              f"G={s['growth_rate']:.3f}  SF={s['stress_factor']:.2f}  "
              f"-> {s['yield_t_ha']:.3f} t/ha  "
              f"= {s['est_yield_tonnes']:.0f} T  ({s['percentage']:.1f}%)  {bar}")

    return crop_class, stats


def save_static_pngs(data_dir, season):
    """
    Saves RGB median composite and crop classification rasters as static PNGs.
    """
    try:
        from PIL import Image
        import numpy as np
        import rasterio
        
        tif_path = os.path.join(data_dir, "Seasonal_Median_Composite.tif")
        png_path = os.path.join(data_dir, "Seasonal_Median_Composite.png")
        if os.path.exists(tif_path):
            with rasterio.open(tif_path) as src:
                data = src.read([1, 2, 3]).astype('float32')
                valid_pixels = data[data > 0]
                if valid_pixels.size > 0:
                    p2, p98 = np.percentile(valid_pixels, [2, 98])
                else:
                    p2, p98 = 0, 3000
                stretched = np.clip((data - p2) / (p98 - p2), 0, 1)
                stretched = np.power(stretched, 1/1.2) # Gamma correction
                stretched = (stretched * 255).astype('uint8')
                rgb = np.transpose(stretched, (1, 2, 0))
                img = Image.fromarray(rgb)
                img.save(png_path, "PNG")
                print(f"[PNG Export] Saved composite to {png_path}")
    except Exception as e:
        print(f"[PNG Export] Failed to save composite PNG: {e}")

    try:
        from PIL import Image
        import numpy as np
        import rasterio
        
        class_path = os.path.join(data_dir, "Crop_Classification.tif")
        class_png_path = os.path.join(data_dir, "Crop_Classification.png")
        if os.path.exists(class_path):
            registry = CROP_REGISTRY.get(season.lower(), CROP_REGISTRY['rabi'])
            with rasterio.open(class_path) as src:
                crop_class = src.read(1)
            h, w = crop_class.shape
            rgba = np.zeros((h, w, 4), dtype=np.uint8)
            for code, info in registry.items():
                px = (crop_class == code)
                r, g, b, a = info['color']
                rgba[px, 0] = r
                rgba[px, 1] = g
                rgba[px, 2] = b
                rgba[px, 3] = a
            img = Image.fromarray(rgba.astype(np.uint8))
            img.save(class_png_path, "PNG")
            print(f"[PNG Export] Saved classification to {class_png_path}")
    except Exception as e:
        print(f"[PNG Export] Failed to save classification PNG: {e}")

    try:
        from PIL import Image
        import numpy as np
        import rasterio
        
        ndvi_path = os.path.join(data_dir, "NDVI_Max.tif")
        ndvi_png_path = os.path.join(data_dir, "NDVI_Max.png")
        if os.path.exists(ndvi_path):
            with rasterio.open(ndvi_path) as src:
                ndvi = src.read(1)
            h, w = ndvi.shape
            rgba = np.zeros((h, w, 4), dtype=np.uint8)
            mask_nan = np.isnan(ndvi) | (ndvi == -999.0)
            
            # Mask out non-agricultural pixels using the cropland mask
            mask_path = os.path.join(data_dir, "Final_Agri_Land_Mask.tif")
            if os.path.exists(mask_path):
                try:
                    with rasterio.open(mask_path) as mask_src:
                        agri_mask = mask_src.read(1)
                        mask_nan = mask_nan | (agri_mask != 1)
                except Exception as e:
                    print(f"Error loading agri mask for static ndvi: {e}")
            
            # Use exact same standardized colormap as app.py
            ndvi_flat = np.nan_to_num(ndvi, nan=0.0).ravel()
            xp = [-1.0, 0.1, 0.3, 0.4, 0.5, 0.6, 1.0]
            r_fp = [60, 215, 253, 254, 166, 26, 26]
            g_fp = [90, 48, 174, 224, 217, 152, 152]
            b_fp = [120, 39, 97, 139, 106, 80, 80]
            
            rgba[:, :, 0] = np.interp(ndvi_flat, xp, r_fp).astype(np.uint8).reshape((h, w))
            rgba[:, :, 1] = np.interp(ndvi_flat, xp, g_fp).astype(np.uint8).reshape((h, w))
            rgba[:, :, 2] = np.interp(ndvi_flat, xp, b_fp).astype(np.uint8).reshape((h, w))
            rgba[:, :, 3] = 190
            rgba[mask_nan, 3] = 0
            
            img = Image.fromarray(rgba.astype(np.uint8))
            img.save(ndvi_png_path, "PNG")
            print(f"[PNG Export] Saved NDVI max to {ndvi_png_path}")
    except Exception as e:
        print(f"[PNG Export] Failed to save NDVI PNG: {e}")

    try:
        from PIL import Image
        import numpy as np
        import rasterio
        
        ndwi_path = os.path.join(data_dir, "NDWI_Min.tif")
        ndwi_png_path = os.path.join(data_dir, "NDWI_Min.png")
        if os.path.exists(ndwi_path):
            with rasterio.open(ndwi_path) as src:
                ndwi = src.read(1)
            h, w = ndwi.shape
            rgba = np.zeros((h, w, 4), dtype=np.uint8)
            mask_nan = np.isnan(ndwi) | (ndwi == -999.0)
            
            # Mask out non-agricultural pixels using the cropland mask
            mask_path = os.path.join(data_dir, "Final_Agri_Land_Mask.tif")
            if os.path.exists(mask_path):
                try:
                    with rasterio.open(mask_path) as mask_src:
                        agri_mask = mask_src.read(1)
                        mask_nan = mask_nan | (agri_mask != 1)
                except Exception as e:
                    print(f"Error loading agri mask for static ndwi: {e}")
            
            # Use exact same standardized colormap as app.py
            ndwi_flat = np.nan_to_num(ndwi, nan=0.0).ravel()
            xp = [-1.0, -0.20, -0.10, -0.02, 0.08, 0.33, 1.0]
            r_fp = [34, 46, 150, 166, 31, 20, 8]
            g_fp = [139, 175, 220, 206, 120, 80, 48]
            b_fp = [34, 50, 90, 227, 180, 160, 107]
            
            rgba[:, :, 0] = np.interp(ndwi_flat, xp, r_fp).astype(np.uint8).reshape((h, w))
            rgba[:, :, 1] = np.interp(ndwi_flat, xp, g_fp).astype(np.uint8).reshape((h, w))
            rgba[:, :, 2] = np.interp(ndwi_flat, xp, b_fp).astype(np.uint8).reshape((h, w))
            rgba[:, :, 3] = 180
            rgba[mask_nan, 3] = 0
            
            img = Image.fromarray(rgba.astype(np.uint8))
            img.save(ndwi_png_path, "PNG")
            print(f"[PNG Export] Saved NDWI min to {ndwi_png_path}")
    except Exception as e:
        print(f"[PNG Export] Failed to save NDWI PNG: {e}")



# ─────────────────────────────────────────────────────────────────────────────
# Main extraction pipeline
# ─────────────────────────────────────────────────────────────────────────────

def run_agri_extraction(data_dir, season='rabi', aoi_geojson=None):
    yield {"status": "preparing_dataset", "message": "Initializing RS-AIMS extraction..."}
    print("\n" + "=" * 55)
    print("  RS-AIMS  |  ADVANCED AGRICULTURE EXTRACTION")
    print("=" * 55 + "\n")

    # ── 1. Season thresholds ──────────────────────────────────────────────────
    configs = {
        'rabi':   {'ndvi_min': 0.45, 'ndwi_max': 0.0, 'ndbi_max': 0.1, 'amp': 0.12, 'std': 0.05, 'min_pixels': 150},
        'kharif': {'ndvi_min': 0.45, 'ndwi_max': 0.0, 'ndbi_max': 0.1, 'amp': 0.15, 'std': 0.05, 'min_pixels': 150},
        'zaid':   {'ndvi_min': 0.40, 'ndwi_max': 0.0, 'ndbi_max': 0.1, 'amp': 0.10, 'std': 0.03, 'min_pixels': 100},
    }
    conf = configs.get(season.lower(), configs['rabi'])
    print(f"Season : {season.upper()}")
    print(f"Config : {conf}\n")

    # ── 2. Load phenology CSV once ────────────────────────────────────────────
    phenology = load_phenology()

    # ── 3. Find and sort TIFFs ────────────────────────────────────────────────
    prefix = season.upper() + "_"
    exclude = {"final_agri_land_mask.tif", "crop_classification.tif",
               "agriculture_only.tif", "seasonal_median_composite.tif",
               "ndvi_max.tif", "ndwi_min.tif"}
    all_files = glob.glob(os.path.join(data_dir, "*.tif"))
    tif_files = sorted(
        [f for f in all_files
         if os.path.basename(f).upper().startswith(prefix)
         and os.path.basename(f).lower() not in exclude],
        key=parse_date_from_filename
    )

    if len(tif_files) < 2:
        yield {"status": "error", "message": "Need at least 2 images for temporal extraction."}
        return

    print(f"[RS-AIMS] {len(tif_files)} temporal snapshots:")
    yield {"status": "preparing_dataset", "message": f"Reading {len(tif_files)} temporal satellite images..."}

    # ── 4. Read images → build stacks ─────────────────────────────────────────
    ndvi_stack = []
    ndwi_stack = []
    ndbi_stack = []
    rgb_stack  = []
    meta       = None
    has_swir   = None

    with np.errstate(divide='ignore', invalid='ignore'):
        for idx, fpath in enumerate(tif_files):
            fname    = os.path.basename(fpath)
            img_date = parse_date_from_filename(fpath)
            print(f"  [{idx+1}/{len(tif_files)}] {fname}  ({img_date.strftime('%Y-%m-%d')})", flush=True)

            with rasterio.open(fpath) as src:
                if meta is None:
                    meta     = src.meta.copy()
                    has_swir = src.count >= 5
                    print(f"  [INFO] Bands={src.count}  NDBI={'on' if has_swir else 'off (no B11)'}")

                red   = src.read(1).astype('float32')
                green = src.read(2).astype('float32')
                blue  = src.read(3).astype('float32')
                nir   = src.read(4).astype('float32')

                d = nir + red
                ndvi = np.where(d == 0, np.nan, (nir - red) / d)
                ndvi_stack.append(np.clip(ndvi, -1, 1))

                d = green + nir
                ndwi = np.where(d == 0, np.nan, (green - nir) / d)
                ndwi_stack.append(np.clip(ndwi, -1, 1))

                if has_swir:
                    swir = src.read(5).astype('float32')
                    d    = swir + nir
                    ndbi = np.where(d == 0, np.nan, (swir - nir) / d)
                    ndbi_stack.append(np.clip(ndbi, -1, 1))

                rgb_stack.append(np.stack([red, green, blue]))

    ndvi_stack = np.stack(ndvi_stack, axis=0)
    ndwi_stack = np.stack(ndwi_stack, axis=0)
    rgb_stack  = np.stack(rgb_stack,  axis=0)
    if has_swir and ndbi_stack:
        ndbi_stack = np.stack(ndbi_stack, axis=0)

    # ── 5. Temporal statistics ────────────────────────────────────────────────
    yield {"status": "preparing_dataset", "message": "Calculating temporal statistics..."}
    print("\nCalculating temporal statistics...")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        ndvi_max = np.nanmax(ndvi_stack, axis=0)
        ndvi_min = np.nanmin(ndvi_stack, axis=0)
        ndvi_std = np.nanstd(ndvi_stack, axis=0)
    ndvi_amp = ndvi_max - ndvi_min

    # ── 6. Peak image ─────────────────────────────────────────────────────────
    mean_per_image = [float(np.nanmean(ndvi_stack[i])) for i in range(len(tif_files))]
    peak_idx  = int(np.argmax(mean_per_image))
    ndwi_peak = ndwi_stack[peak_idx]
    ndbi_peak = ndbi_stack[peak_idx] if (has_swir and len(ndbi_stack) > 0) else None
    print(f"Peak image: {os.path.basename(tif_files[peak_idx])}  "
          f"(mean NDVI={mean_per_image[peak_idx]:.3f})")

    # ── 7. AOI coverage mask ──────────────────────────────────────────────────
    data_coverage = (~np.isnan(ndvi_max)).astype('uint8')

    # ── 8. RGB composite ──────────────────────────────────────────────────────
    print("Generating median RGB composite...")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        median_composite = np.nanmedian(rgb_stack, axis=0).astype(meta['dtype'])
    for i in range(3):
        median_composite[i] = np.where(data_coverage == 1, median_composite[i], 0)

  

    comp_meta = meta.copy()
    comp_meta.update(count=3, nodata=0)
    composite_path = os.path.join(data_dir, "Seasonal_Median_Composite.tif")
    with rasterio.open(composite_path, 'w', **comp_meta) as dst:
        for i in range(3):
            dst.write(median_composite[i], i + 1)
  

    # ── 9. Agriculture mask (GEE Step 9) ──────────────────────────────────────
    yield {"status": "analyzing_vegetation", "message": "Applying RS-AIMS crop extraction logic..."}
    print("\nApplying RS-AIMS logic...")
    agri_mask = ndvi_max > conf['ndvi_min']
    agri_mask = agri_mask & (ndwi_peak < conf['ndwi_max'])
    if ndbi_peak is not None:
        agri_mask = agri_mask & (ndbi_peak < conf['ndbi_max'])
    agri_mask = agri_mask & (ndvi_amp > conf['amp'])
    agri_mask = agri_mask & (ndvi_std > conf['std'])
    agri_mask = (agri_mask & data_coverage.astype(bool)).astype('uint8')
    print(f"  After all filters: {int(np.sum(agri_mask))} px")

    # ── 10. Morphological cleaning (GEE Step 10) ──────────────────────────────
    yield {"status": "extracting_land", "message": "Applying morphological cleaning and connectivity filters..."}
    print("Morphological cleaning...")
    agri_mask = binary_dilation(agri_mask, structure=np.ones((3,3))).astype('uint8')
    agri_mask = (uniform_filter(agri_mask.astype('float32'), size=5) >= 0.5).astype('uint8')
    agri_mask = binary_erosion(agri_mask,  structure=np.ones((3,3))).astype('uint8')

    # ── 11. Connected component filter (GEE Step 11) ──────────────────────────
    struct = np.ones((3,3), dtype=int)
    labeled_arr, _ = label(agri_mask, structure=struct)
    comp_sizes = np.bincount(labeled_arr.ravel())
    keep = comp_sizes >= conf['min_pixels']
    keep[0] = False
    agri_mask = keep[labeled_arr].astype('uint8')
    print(f"  After size filter: {int(np.sum(agri_mask))} px")

    # ── 11b. Fill small holes inside agricultural regions ──────────────────────
    # Small dark blobs inside crop fields are typically:
    #   - footpaths / bunds between parcels
    #   - pixels temporarily shadowed or cloudy in one image
    #   - bare soil patches too small to be meaningful
    # Strategy: label the BACKGROUND (inverted mask), remove background components
    # smaller than a hole_threshold, then merge them into the agricultural mask.
    # hole_threshold = 200 px × 100 m² = 20,000 m² = 2 ha  (sensible minimum hole)
    HOLE_THRESHOLD = 200
    inverted = 1 - agri_mask
    # Only fill holes that are completely surrounded by agri pixels (don't fill
    # true non-agri areas at the boundary). We do this by labeling the inverted
    # mask and excluding any component that touches the image border.
    labeled_holes, _ = label(inverted, structure=struct)
    border_labels = set()
    border_labels.update(labeled_holes[0, :])
    border_labels.update(labeled_holes[-1, :])
    border_labels.update(labeled_holes[:, 0])
    border_labels.update(labeled_holes[:, -1])
    hole_sizes = np.bincount(labeled_holes.ravel())
    # Fill interior holes smaller than threshold
    fill_mask = np.zeros_like(agri_mask, dtype=bool)
    for lbl in range(1, len(hole_sizes)):
        if lbl not in border_labels and hole_sizes[lbl] < HOLE_THRESHOLD:
            fill_mask[labeled_holes == lbl] = True
    agri_mask[fill_mask] = 1
    print(f"  After hole fill  : {int(np.sum(agri_mask))} px  "
          f"(filled {int(fill_mask.sum())} hole pixels)")

    # ── 12. Crop classification ────────────────────────────────────────────────
    yield {"status": "extracting_land", "message": "Running phenology-based crop classification..."}
    print("\nRunning phenology-based crop classification...")
    crop_class, crop_stats = classify_crops(
        agri_mask, ndvi_stack, ndwi_stack,
        ndvi_max, ndvi_amp, ndvi_std,
        tif_files, season, phenology
    )

    # ── 13. Agriculture-only RGB raster ───────────────────────────────────────
    agri_only_rgb = np.zeros_like(median_composite)
    for i in range(3):
        agri_only_rgb[i] = np.where(agri_mask == 1, median_composite[i], 0)
    agri_only_path = os.path.join(data_dir, "Agriculture_Only.tif")
    with rasterio.open(agri_only_path, 'w', **comp_meta) as dst:
        for i in range(3):
            dst.write(agri_only_rgb[i], i + 1)

    # ── 14. Binary mask (0=non-agri, 1=agri, 255=outside AOI) ─────────────────
    final_mask = np.full(agri_mask.shape, 255, dtype='uint8')
    final_mask[data_coverage == 1] = 0
    final_mask[agri_mask == 1]     = 1
    mask_meta = meta.copy()
    mask_meta.update(dtype='uint8', count=1, nodata=255)
    output_path = os.path.join(data_dir, "Final_Agri_Land_Mask.tif")
    with rasterio.open(output_path, 'w', **mask_meta) as dst:
        dst.write(final_mask, 1)

    # ── 15. Classification raster ─────────────────────────────────────────────
    class_meta = mask_meta.copy()
    class_meta.update(nodata=0)
    class_path = os.path.join(data_dir, "Crop_Classification.tif")
    with rasterio.open(class_path, 'w', **class_meta) as dst:
        dst.write(crop_class, 1)



    # ── 15b. NDVI and NDWI rasters ────────────────────────────────────────────
    try:
        ndvi_meta = meta.copy()
        ndvi_meta.update(dtype='float32', count=1, nodata=-999.0)
        ndvi_max_path = os.path.join(data_dir, "NDVI_Max.tif")
        ndvi_max_clean = np.where(np.isnan(ndvi_max), -999.0, ndvi_max)
        with rasterio.open(ndvi_max_path, 'w', **ndvi_meta) as dst:
            dst.write(ndvi_max_clean.astype('float32'), 1)

        ndwi_min = np.nanmin(ndwi_stack, axis=0)
        ndwi_meta = meta.copy()
        ndwi_meta.update(dtype='float32', count=1, nodata=-999.0)
        ndwi_min_path = os.path.join(data_dir, "NDWI_Min.tif")
        ndwi_min_clean = np.where(np.isnan(ndwi_min), -999.0, ndwi_min)
        with rasterio.open(ndwi_min_path, 'w', **ndwi_meta) as dst:
            dst.write(ndwi_min_clean.astype('float32'), 1)
        print("[Raster Export] Saved NDVI_Max and NDWI_Min rasters")
    except Exception as e_indices:
        print(f"[Raster Export] Failed to save NDVI/NDWI rasters: {e_indices}")

    # ── 16. Crop stats JSON ───────────────────────────────────────────────────
    stats_path = os.path.join(data_dir, "crop_stats.json")
    with open(stats_path, 'w') as f:
        json.dump({'season': season, 'run_type': 'agri', 'crops': crop_stats}, f, indent=2)

    # ── 17. Vectorization ────────────────────────────────────────────────────
    yield {"status": "generating_results", "message": "Vectorizing boundaries and exporting GeoJSON..."}
    print("\nVectorizing boundaries...")
    mask_shapes = shapes(agri_mask, mask=(agri_mask > 0), transform=mask_meta['transform'])
    polygons = [shape(s) for s, v in mask_shapes]

    shp_path = None
    if polygons:
        gdf     = gpd.GeoDataFrame({'geometry': polygons}, crs=mask_meta['crs'])
        utm_crs = gdf.estimate_utm_crs()
        gdf_utm = gdf.to_crs(utm_crs)
        gdf_utm = gdf_utm[gdf_utm.geometry.area > 1500]

        if not gdf_utm.empty:
            gdf = gdf_utm.to_crs("EPSG:4326")
            if aoi_geojson:
                try:
                    aoi_geom = (shape(aoi_geojson['features'][0]['geometry'])
                                if aoi_geojson.get('type') == 'FeatureCollection'
                                else shape(aoi_geojson))
                    gdf = gpd.clip(gdf, gpd.GeoDataFrame({'geometry': [aoi_geom]}, crs="EPSG:4326"))
                except Exception as e:
                    print(f"  AOI Clip Error: {e}")

            gdf['geometry'] = gdf.geometry.simplify(0.0001, preserve_topology=True)
            shp_path = os.path.join(data_dir, "Final_Agri_Land_Boundary.shp")
            gdf.to_file(shp_path)
            gdf.to_file(shp_path.replace(".shp", ".geojson"), driver='GeoJSON')
            print(f"  Saved {len(gdf)} polygons")

    try:
        save_static_pngs(data_dir, season)
    except Exception as e_png:
        print(f"Error generating static PNG files: {e_png}")

    print("\n[OK] RS-AIMS EXTRACTION COMPLETE")
    yield {
        "status":         "success",
        "message":        "RS-AIMS extraction completed",
        "mask_path":      output_path,
        "class_path":     class_path,
        "agri_only_path": agri_only_path,
        "shp_path":       shp_path,
        "pixel_count":    int(np.sum(agri_mask)),
        "crop_stats":     crop_stats
    }
