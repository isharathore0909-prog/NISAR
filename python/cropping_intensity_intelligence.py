import os
# Configure PROJ_LIB to use venv rasterio share folder to avoid postgresql version mismatch
venv_proj_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "venv", "Lib", "site-packages", "rasterio", "proj_data"))
if os.path.exists(venv_proj_path):
    os.environ['PROJ_LIB'] = venv_proj_path

import re
import glob
import json
import time
import shutil
import warnings
import numpy as np
import rasterio
import geopandas as gpd
from rasterio.warp import reproject, Resampling
from rasterio.enums import ColorInterp
from scipy.ndimage import generic_filter
from shapely.geometry import shape, mapping, box
import matplotlib.colors as mcolors
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

from download_imagery import run_satellite_download

# Cropping Intensity Classes & Colors
INTENSITY_CLASSES = {
    0  : ('Outside AOI',              '#00000000'),
    1  : ('Fallow Cropland',          '#D2B48C'),  # Tan
    2  : ('Single Crop',              '#FFD700'),  # Gold
    3  : ('Double Crop',              '#FFA500'),  # Orange
    4  : ('Triple Crop',              '#228B22'),  # Forest Green
    10 : ('Tree Cover / Forest',      '#006400'),
    20 : ('Shrubland',                '#BDB76B'),
    30 : ('Grassland',                '#ADFF2F'),
    50 : ('Built-up / Urban',         '#FF4500'),
    60 : ('Barren / Bare Land',       '#C0C0C0'),
    80 : ('Water Body',               '#0040FF'),
    90 : ('Wetland',                  '#00CED1'),
}

# Crop name registry based on agri_process.py
CROP_REGISTRY_NAMES = {
    'kharif': {1: 'Rice', 2: 'Cotton', 3: 'Bajra', 4: 'Maize', 5: 'Other'},
    'rabi': {1: 'Wheat', 2: 'Mustard', 3: 'Gram', 4: 'Other'},
    'zaid': {1: 'Vegetables', 2: 'Melon/Gourd', 3: 'Other'}
}

# Predefined colors for rotation patterns
ROTATION_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ec4899', 
    '#8b5cf6', '#06b6d4', '#14b8a6', '#f43f5e',
    '#6b7280' # Other / Fallow
]

def run_cropping_intensity_analysis(boundary_file, workspace_dir, year):
    """
    Cropping Intensity & Crop Rotation Intelligence Module.
    Steps:
      1. Auto-process seasonal agriculture & crop classification maps (Kharif, Rabi, Zaid) if missing.
      2. Combine seasonal agricultural masks to count active crop seasons per pixel.
      3. Calculate Cropping Intensity Map (Fallow, Single, Double, Triple Crop).
      4. Compare seasonal crop classification rasters to map Crop Rotation transitions.
      5. Generate Farm-wise, Village-wise, Block-wise, and District-wise Statistics.
      6. Output maps, statistics, and text reports.
    """
    yield json.dumps({"status": "starting", "message": "Starting Cropping Intensity Intelligence Analysis..."})
    
    # 1. Resolve paths for the three seasons based on output directory
    folder_name = os.path.basename(workspace_dir)
    if "_Annual_" in folder_name:
        safe_name = folder_name.split("_Annual_")[0]
    else:
        safe_name = folder_name
        
    parent_dir = os.path.dirname(workspace_dir)
    kharif_dir = os.path.normpath(os.path.join(parent_dir, f"{safe_name}_Kharif_{year}"))
    rabi_dir   = os.path.normpath(os.path.join(parent_dir, f"{safe_name}_Rabi_{year}"))
    zaid_dir   = os.path.normpath(os.path.join(parent_dir, f"{safe_name}_Zaid_{year}"))
    
    os.makedirs(workspace_dir, exist_ok=True)
    
    # 2. Check and auto-run individual seasons if missing
    seasons_to_check = [
        ('Kharif', kharif_dir, 'kharif'),
        ('Rabi', rabi_dir, 'rabi'),
        ('Zaid', zaid_dir, 'zaid')
    ]
    
    for s_name, s_dir, s_key in seasons_to_check:
        mask_tif = os.path.join(s_dir, "Final_Agri_Land_Mask.tif")
        class_tif = os.path.join(s_dir, "Crop_Classification.tif")
        
        if not (os.path.exists(mask_tif) and os.path.exists(class_tif)):
            yield json.dumps({
                "status": "processing", 
                "message": f"{s_name} {year} maps missing. Auto-initializing Sentinel-2 processing for {s_name}..."
            })
            
            # Execute seasonal processing generator
            for update in run_satellite_download(boundary_file, s_key, year, s_dir):
                yield update
                
    # 3. Read seasonal masks and classification rasters
    k_mask_path = os.path.join(kharif_dir, "Final_Agri_Land_Mask.tif")
    r_mask_path = os.path.join(rabi_dir, "Final_Agri_Land_Mask.tif")
    z_mask_path = os.path.join(zaid_dir, "Final_Agri_Land_Mask.tif")
    
    k_class_path = os.path.join(kharif_dir, "Crop_Classification.tif")
    r_class_path = os.path.join(rabi_dir, "Crop_Classification.tif")
    z_class_path = os.path.join(zaid_dir, "Crop_Classification.tif")
    
    if not (os.path.exists(k_mask_path) and os.path.exists(r_mask_path)):
        yield json.dumps({
            "status": "error",
            "message": "Kharif and Rabi seasonal runs are required to compute Cropping Intensity."
        })
        return
        
    yield json.dumps({"status": "processing", "message": "Loading seasonal agriculture and crop classification maps..."})
    
    # Read Kharif grid metadata as reference
    with rasterio.open(k_mask_path) as src_k:
        ref_meta = src_k.profile.copy()
        k_mask = src_k.read(1)
        h, w = k_mask.shape
        ref_transform = src_k.transform
        ref_crs = src_k.crs
        
    with rasterio.open(k_class_path) as src_k_c:
        k_class = src_k_c.read(1)
        
    # Helper to resample arrays to reference grid size if they differ
    def read_and_resample(file_path):
        with rasterio.open(file_path) as src:
            data = src.read(1)
            if data.shape == (h, w):
                return data
            dst = np.zeros((h, w), dtype=np.uint8)
            reproject(
                source=data, destination=dst,
                src_transform=src.transform, src_crs=src.crs,
                dst_transform=ref_transform, dst_crs=ref_crs,
                resampling=Resampling.nearest
            )
            return dst
            
    r_mask = read_and_resample(r_mask_path)
    r_class = read_and_resample(r_class_path)
    
    # Zaid is optional (use zeros if missing or download failed)
    has_zaid = os.path.exists(z_mask_path)
    if has_zaid:
        z_mask = read_and_resample(z_mask_path)
        z_class = read_and_resample(z_class_path)
    else:
        z_mask = np.zeros((h, w), dtype=np.uint8)
        z_class = np.zeros((h, w), dtype=np.uint8)
        
    # 4. Calculate Cropping Intensity Map
    yield json.dumps({"status": "processing", "message": "Calculating pixel-wise Cropping Intensity..."})
    
    # Define active agricultural masks (1 = active agriculture in Sentinel mask)
    active_k = (k_mask == 1)
    active_r = (r_mask == 1)
    active_z = (z_mask == 1) if has_zaid else np.zeros((h, w), dtype=bool)
    
    # Cropland baseline is the union of all active areas across seasons
    cropland_baseline = active_k | active_r | active_z
    
    # Count of active crop cycles per pixel
    active_count = active_k.astype(np.uint8) + active_r.astype(np.uint8) + active_z.astype(np.uint8)
    
    # Construct intensity raster
    intensity_map = np.zeros((h, w), dtype=np.uint8)
    
    # Cropping Intensity mapping
    intensity_map[cropland_baseline & (active_count == 3)] = 4  # Triple Crop
    intensity_map[cropland_baseline & (active_count == 2)] = 3  # Double Crop
    intensity_map[cropland_baseline & (active_count == 1)] = 2  # Single Crop
    intensity_map[cropland_baseline & (active_count == 0)] = 1  # Fallow Cropland
    
    # Fill in non-agricultural land covers if LULC output is present in Kharif folder
    k_lulc_path = os.path.join(kharif_dir, "LULC_Refined.tif")
    if os.path.exists(k_lulc_path):
        try:
            k_lulc = read_and_resample(k_lulc_path)
            non_crop_mask = ~cropland_baseline & (k_mask != 255)
            # Retain original general LULC classes for non-cropland areas
            for code in [10, 11, 12, 13, 20, 30, 50, 60, 61, 62, 70, 80, 81, 82, 90, 91, 92, 95, 100]:
                intensity_map[non_crop_mask & (k_lulc == code)] = code
        except Exception:
            intensity_map[~cropland_baseline & (k_mask == 0)] = 60 # Barren
    else:
        # Default non-agri fallback
        intensity_map[~cropland_baseline & (k_mask == 0)] = 60
        
    # Retain outside boundary nodata value (0 or 255)
    intensity_map[k_mask == 255] = 0
    intensity_map[k_mask == 0] = 0
    
    # Apply majority filter to smooth out pixelated classification noise
    def majority_filter(values):
        centre = int(values[4])
        if centre == 0:
            return 0
        valid = values[values > 0].astype(int)
        if len(valid) == 0:
            return centre
        counts = np.bincount(valid)
        return int(np.argmax(counts))

    intensity_smooth = generic_filter(
        intensity_map.astype(float),
        majority_filter,
        size=3,
        mode='nearest'
    ).astype(np.uint8)
    
    # Save Refined Cropping Intensity Raster (named LULC_Refined.tif for DB compatibility)
    LULC_REFINED_PATH = os.path.join(workspace_dir, "LULC_Refined.tif")
    out_meta = ref_meta.copy()
    out_meta.update({
        'count': 1,
        'dtype': 'uint8',
        'nodata': 0,
        'compress': 'lzw'
    })
    
    with rasterio.open(LULC_REFINED_PATH, 'w', **out_meta) as dst:
        dst.write(intensity_smooth, 1)
        ct = {}
        for code, (name, hexcol) in INTENSITY_CLASSES.items():
            if hexcol == '#00000000':
                ct[code] = (0, 0, 0, 0)
            else:
                r, g, b = [int(x * 255) for x in mcolors.to_rgb(hexcol)]
                ct[code] = (r, g, b, 255)
        dst.write_colormap(1, ct)
        
    # Save Visual GeoTIFF (3-band RGB)
    LULC_VISUAL_PATH = os.path.join(workspace_dir, "LULC_Visual.tif")
    _r = np.zeros((h, w), dtype=np.uint8)
    _g = np.zeros((h, w), dtype=np.uint8)
    _b = np.zeros((h, w), dtype=np.uint8)
    
    for code, (name, hexcol) in INTENSITY_CLASSES.items():
        if hexcol == '#00000000':
            continue
        r, g, b = [int(x * 255) for x in mcolors.to_rgb(hexcol)]
        mask = (intensity_smooth == code)
        _r[mask] = r
        _g[mask] = g
        _b[mask] = b
        
    out_meta_visual = ref_meta.copy()
    out_meta_visual.update({
        'count': 3,
        'dtype': 'uint8',
        'nodata': None,
        'compress': 'lzw',
        'photometric': 'RGB'
    })
    with rasterio.open(LULC_VISUAL_PATH, 'w', **out_meta_visual) as dst:
        dst.write(_r, 1)
        dst.write(_g, 2)
        dst.write(_b, 3)
        dst.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue]
        
    # Save a static PNG map for Cropping Intensity
    LULC_PNG_PATH = os.path.join(workspace_dir, "LULC_Map.png")
    _code_to_rgb = {code: mcolors.to_rgb(hexcol) if hexcol != '#00000000' else (1.0, 1.0, 1.0) 
                    for code, (name, hexcol) in INTENSITY_CLASSES.items()}
    _cmap_array = np.ones((256, 3), dtype=float)
    for code, rgb in _code_to_rgb.items():
        _cmap_array[code] = rgb
    intensity_rgb = _cmap_array[intensity_smooth]
    
    fig, ax = plt.subplots(figsize=(12, 10))
    ax.imshow(intensity_rgb, interpolation='nearest')
    ax.set_title(f'Annual Cropping Intensity & Land Cover — {safe_name} ({year})', fontsize=14, fontweight='bold')
    ax.axis('off')
    present_codes = [c for c in sorted(INTENSITY_CLASSES.keys()) if c in np.unique(intensity_smooth) and c != 0]
    patches = []
    for code in present_codes:
        name, hexcol = INTENSITY_CLASSES[code]
        col = '#C0C0C0' if hexcol == '#00000000' else hexcol
        patches.append(mpatches.Patch(color=col, label=f'{code:>2}  {name}'))
    ax.legend(handles=patches, loc='lower left', bbox_to_anchor=(1.01, 0), fontsize=8, framealpha=0.9, title='Classes', title_fontsize=9)
    plt.tight_layout()
    plt.savefig(LULC_PNG_PATH, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close(fig)

    # 5. Crop Rotation Analysis
    yield json.dumps({"status": "processing", "message": "Executing Crop Rotation analysis..."})
    
    # Mapping pixel crop codes to crop name strings
    rotation_patterns = {}
    rotation_indices = np.zeros((h, w), dtype=np.uint8) # 0 = Non-cropland
    
    # Process crop rotation arrays
    agri_rows, agri_cols = np.where(cropland_baseline)
    
    for r, c in zip(agri_rows, agri_cols):
        k_code = k_class[r, c]
        r_code = r_class[r, c]
        z_code = z_class[r, c] if has_zaid else 0
        
        # Get crop names
        k_name = CROP_REGISTRY_NAMES['kharif'].get(k_code, 'Other') if active_k[r, c] else 'Fallow'
        r_name = CROP_REGISTRY_NAMES['rabi'].get(r_code, 'Other') if active_r[r, c] else 'Fallow'
        z_name = CROP_REGISTRY_NAMES['zaid'].get(z_code, 'Other') if active_z[r, c] else 'Fallow'
        
        # Formulate pattern string
        if has_zaid and z_name != 'Fallow':
            pattern = f"{k_name} → {r_name} → {z_name}"
        else:
            pattern = f"{k_name} → {r_name}"
            
        rotation_patterns[pattern] = rotation_patterns.get(pattern, 0) + 1
        
    # Get top rotation patterns and assign codes
    sorted_rotations = sorted(rotation_patterns.items(), key=lambda x: x[1], reverse=True)
    top_rotations = [pat for pat, count in sorted_rotations[:7]] # Keep top 7, group rest under 'Other Rotations'
    
    rotation_codes = {}
    rotation_class_details = {
        0: ('Outside / Non-cropland', '#00000000')
    }
    for idx, pat in enumerate(top_rotations):
        code = idx + 1
        rotation_codes[pat] = code
        rotation_class_details[code] = (pat, ROTATION_COLORS[idx])
        
    # Add 'Other Rotations' class
    other_code = len(top_rotations) + 1
    rotation_class_details[other_code] = ('Other Rotations / Fallow', ROTATION_COLORS[7])
    
    # Populate rotation index map
    for r, c in zip(agri_rows, agri_cols):
        k_code = k_class[r, c]
        r_code = r_class[r, c]
        z_code = z_class[r, c] if has_zaid else 0
        
        k_name = CROP_REGISTRY_NAMES['kharif'].get(k_code, 'Other') if active_k[r, c] else 'Fallow'
        r_name = CROP_REGISTRY_NAMES['rabi'].get(r_code, 'Other') if active_r[r, c] else 'Fallow'
        z_name = CROP_REGISTRY_NAMES['zaid'].get(z_code, 'Other') if active_z[r, c] else 'Fallow'
        
        if has_zaid and z_name != 'Fallow':
            pattern = f"{k_name} → {r_name} → {z_name}"
        else:
            pattern = f"{k_name} → {r_name}"
            
        code = rotation_codes.get(pattern, other_code)
        rotation_indices[r, c] = code
        
    # Apply majority filter to smooth rotation map
    rotation_smooth = generic_filter(
        rotation_indices.astype(float),
        majority_filter,
        size=3,
        mode='nearest'
    ).astype(np.uint8)
    
    # Save Crop Rotation GeoTIFF
    CROP_ROTATION_PATH = os.path.join(workspace_dir, "Crop_Rotation.tif")
    with rasterio.open(CROP_ROTATION_PATH, 'w', **out_meta) as dst:
        dst.write(rotation_smooth, 1)
        ct = {}
        for code, (name, hexcol) in rotation_class_details.items():
            if hexcol == '#00000000':
                ct[code] = (0, 0, 0, 0)
            else:
                r, g, b = [int(x * 255) for x in mcolors.to_rgb(hexcol)]
                ct[code] = (r, g, b, 255)
        dst.write_colormap(1, ct)
        
    # Save Crop Rotation Map PNG
    ROTATION_PNG_PATH = os.path.join(workspace_dir, "Crop_Rotation.png")
    _rot_code_to_rgb = {code: mcolors.to_rgb(hexcol) if hexcol != '#00000000' else (1.0, 1.0, 1.0) 
                        for code, (name, hexcol) in rotation_class_details.items()}
    _cmap_rot = np.ones((256, 3), dtype=float)
    for code, rgb in _rot_code_to_rgb.items():
        _cmap_rot[code] = rgb
    rot_rgb = _cmap_rot[rotation_smooth]
    
    fig, ax = plt.subplots(figsize=(12, 10))
    ax.imshow(rot_rgb, interpolation='nearest')
    ax.set_title(f'Annual Crop Rotation Patterns — {safe_name} ({year})', fontsize=14, fontweight='bold')
    ax.axis('off')
    present_rot_codes = [c for c in sorted(rotation_class_details.keys()) if c in np.unique(rotation_smooth) and c != 0]
    patches = []
    for code in present_rot_codes:
        name, hexcol = rotation_class_details[code]
        patches.append(mpatches.Patch(color=hexcol, label=f'{name}'))
    ax.legend(handles=patches, loc='lower left', bbox_to_anchor=(1.01, 0), fontsize=8, framealpha=0.9, title='Rotation Patterns', title_fontsize=9)
    plt.tight_layout()
    plt.savefig(ROTATION_PNG_PATH, dpi=300, bbox_inches='tight', facecolor='white')
    plt.close(fig)

    # 6. Farm-wise, Village-wise, Block-wise, District-wise Statistics
    yield json.dumps({"status": "processing", "message": "Compiling multi-level administrative statistics..."})
    
    pixel_area_ha = 0.01
    
    # Read the boundary file shape
    gdf_boundary = gpd.read_file(boundary_file)
    gdf_boundary = gdf_boundary.to_crs(ref_crs)
    
    features_list = []
    
    # If the boundary file has only a single feature, create a synthetic grid of "Farms" inside the AOI
    if len(gdf_boundary) == 1:
        print("[Stats] Single polygon boundary detected. Creating synthetic grid of farms...")
        geom = gdf_boundary.geometry.iloc[0]
        bounds = geom.bounds # minx, miny, maxx, maxy
        minx, miny, maxx, maxy = bounds
        
        # Split into a 4x4 grid of farm plots
        x_coords = np.linspace(minx, maxx, 5)
        y_coords = np.linspace(miny, maxy, 5)
        
        synthetic_polys = []
        for i in range(4):
            for j in range(4):
                bx = box(x_coords[i], y_coords[j], x_coords[i+1], y_coords[j+1])
                intersection = bx.intersection(geom)
                if not intersection.is_empty and intersection.area > 1000: # only keep significant areas
                    synthetic_polys.append(intersection)
                    
        # Construct GeoDataFrame for the synthetic farms
        gdf_farms = gpd.GeoDataFrame(geometry=synthetic_polys, crs=ref_crs)
        
        # Generate names and administrative details
        villages = ["Rampur", "Shyampur", "Govindpur"]
        blocks = ["Arain", "Srinagar"]
        district = "Ajmer"
        
        gdf_farms["farm_id"] = [f"Plot-{idx+1:03d}" for idx in range(len(gdf_farms))]
        gdf_farms["owner"] = [f"Farmer {idx+1}" for idx in range(len(gdf_farms))]
        gdf_farms["village"] = [villages[idx % len(villages)] for idx in range(len(gdf_farms))]
        gdf_farms["block"] = [blocks[(idx // 2) % len(blocks)] for idx in range(len(gdf_farms))]
        gdf_farms["district"] = district
    else:
        # File has multiple features, utilize them
        gdf_farms = gdf_boundary.copy()
        # Ensure administrative fields are present
        if "farm_id" not in gdf_farms.columns:
            gdf_farms["farm_id"] = [f"Plot-{idx+1:03d}" for idx in range(len(gdf_farms))]
        if "owner" not in gdf_farms.columns:
            gdf_farms["owner"] = [gdf_farms.get("Name", gdf_farms.get("name", [f"Farmer {idx+1}" for idx in range(len(gdf_farms))])).iloc[idx] for idx in range(len(gdf_farms))]
        if "village" not in gdf_farms.columns:
            # Fallback village mapping
            gdf_farms["village"] = [gdf_farms.get("VILLAGE", gdf_farms.get("village_name", ["Village A" if idx % 2 == 0 else "Village B" for idx in range(len(gdf_farms))])).iloc[idx] for idx in range(len(gdf_farms))]
        if "block" not in gdf_farms.columns:
            gdf_farms["block"] = [gdf_farms.get("BLOCK", gdf_farms.get("block_name", ["Block X" for idx in range(len(gdf_farms))])).iloc[idx] for idx in range(len(gdf_farms))]
        if "district" not in gdf_farms.columns:
            gdf_farms["district"] = [gdf_farms.get("DISTRICT", gdf_farms.get("dist_name", ["District Y" for idx in range(len(gdf_farms))])).iloc[idx] for idx in range(len(gdf_farms))]

    # Compute cropping statistics for each farm/plot using raster masking
    farm_stats_records = []
    village_stats = {}
    block_stats = {}
    district_stats = {}
    
    # Raster transform details
    gt = ref_transform
    
    # Unique values inside mapped smooth maps
    unique_smooth = np.unique(intensity_smooth)
    
    for idx, row in gdf_farms.iterrows():
        farm_geom = row.geometry
        f_id = row["farm_id"]
        f_owner = row["owner"]
        f_village = row["village"]
        f_block = row["block"]
        f_district = row["district"]
        
        # Calculate polygon mask coordinates in pixel indices
        try:
            # Rasterize polygon to obtain pixel mask for this specific farm
            from rasterio.features import geometry_mask
            mask = geometry_mask([farm_geom], out_shape=(h, w), transform=gt, invert=True)
            
            # Extract farm values
            farm_intensity = intensity_smooth[mask]
            farm_rotation = rotation_smooth[mask]
            
            total_farm_px = len(farm_intensity)
            if total_farm_px == 0:
                continue
                
            f_total_area = total_farm_px * pixel_area_ha
            f_fallow_area = np.sum(farm_intensity == 1) * pixel_area_ha
            f_single_area = np.sum(farm_intensity == 2) * pixel_area_ha
            f_double_area = np.sum(farm_intensity == 3) * pixel_area_ha
            f_triple_area = np.sum(farm_intensity == 4) * pixel_area_ha
            
            # Dominant rotation pattern on this farm
            rot_counts = np.bincount(farm_rotation)
            dominant_rot_code = np.argmax(rot_counts) if len(rot_counts) > 0 else 0
            dominant_rot_name = rotation_class_details.get(dominant_rot_code, ('Outside / Non-cropland', ''))[0]
            
            # Define dominant intensity label
            intensity_counts = np.bincount(farm_intensity)
            dom_int_code = np.argmax(intensity_counts) if len(intensity_counts) > 0 else 1
            dominant_intensity = INTENSITY_CLASSES.get(dom_int_code, ('Fallow Cropland', ''))[0]
            
            record = {
                "farm_id": f_id,
                "owner": f_owner,
                "village": f_village,
                "block": f_block,
                "district": f_district,
                "area_ha": round(f_total_area, 2),
                "area_acres": round(f_total_area * 2.47105, 2),
                "fallow_ha": round(f_fallow_area, 2),
                "single_crop_ha": round(f_single_area, 2),
                "double_crop_ha": round(f_double_area, 2),
                "triple_crop_ha": round(f_triple_area, 2),
                "intensity": dominant_intensity,
                "rotation": dominant_rot_name
            }
            farm_stats_records.append(record)
            
            # Aggregate to Village level
            if f_village not in village_stats:
                village_stats[f_village] = {"total_area_ha": 0.0, "fallow_ha": 0.0, "single_crop_ha": 0.0, "double_crop_ha": 0.0, "triple_crop_ha": 0.0}
            village_stats[f_village]["total_area_ha"] += f_total_area
            village_stats[f_village]["fallow_ha"] += f_fallow_area
            village_stats[f_village]["single_crop_ha"] += f_single_area
            village_stats[f_village]["double_crop_ha"] += f_double_area
            village_stats[f_village]["triple_crop_ha"] += f_triple_area
            
            # Aggregate to Block level
            if f_block not in block_stats:
                block_stats[f_block] = {"total_area_ha": 0.0, "fallow_ha": 0.0, "single_crop_ha": 0.0, "double_crop_ha": 0.0, "triple_crop_ha": 0.0}
            block_stats[f_block]["total_area_ha"] += f_total_area
            block_stats[f_block]["fallow_ha"] += f_fallow_area
            block_stats[f_block]["single_crop_ha"] += f_single_area
            block_stats[f_block]["double_crop_ha"] += f_double_area
            block_stats[f_block]["triple_crop_ha"] += f_triple_area
            
            # Aggregate to District level
            if f_district not in district_stats:
                district_stats[f_district] = {"total_area_ha": 0.0, "fallow_ha": 0.0, "single_crop_ha": 0.0, "double_crop_ha": 0.0, "triple_crop_ha": 0.0}
            district_stats[f_district]["total_area_ha"] += f_total_area
            district_stats[f_district]["fallow_ha"] += f_fallow_area
            district_stats[f_district]["single_crop_ha"] += f_single_area
            district_stats[f_district]["double_crop_ha"] += f_double_area
            district_stats[f_district]["triple_crop_ha"] += f_triple_area
            
        except Exception as e_farm:
            print(f"[Stats] Error calculating stats for farm {f_id}: {e_farm}")
            continue

    # Finalize administrative stats rounding
    for v_name in village_stats:
        for k in village_stats[v_name]:
            village_stats[v_name][k] = round(village_stats[v_name][k], 2)
            
    for b_name in block_stats:
        for k in block_stats[b_name]:
            block_stats[b_name][k] = round(block_stats[b_name][k], 2)
            
    for d_name in district_stats:
        for k in district_stats[d_name]:
            district_stats[d_name][k] = round(district_stats[d_name][k], 2)

    # 7. Global Summary Calculations
    crop_total_px = int(np.sum(intensity_smooth > 0))
    total_agri_ha = crop_total_px * pixel_area_ha
    
    single_ha = int(np.sum(intensity_smooth == 2)) * pixel_area_ha
    double_ha = int(np.sum(intensity_smooth == 3)) * pixel_area_ha
    triple_ha = int(np.sum(intensity_smooth == 4)) * pixel_area_ha
    fallow_ha = int(np.sum(intensity_smooth == 1)) * pixel_area_ha
    non_agri_ha = int(np.sum(intensity_smooth >= 10)) * pixel_area_ha
    
    crops_summary = {}
    summary_map = {
        'Fallow Cropland': (1, fallow_ha, '#D2B48C'),
        'Single Crop': (2, single_ha, '#FFD700'),
        'Double Crop': (3, double_ha, '#FFA500'),
        'Triple Crop': (4, triple_ha, '#228B22'),
    }
    
    for s_name, (code, ha_val, hex_col) in summary_map.items():
        pct = 100.0 * ha_val / total_agri_ha if total_agri_ha > 0 else 0.0
        crops_summary[s_name] = {
            "code": code,
            "area_ha": round(ha_val, 2),
            "area_acres": round(ha_val * 2.47105, 2),
            "percentage": round(pct, 2),
            "color_hex": hex_col,
            "pixels": int(np.sum(intensity_smooth == code))
        }
        
    # Include non-agri classes in summary if present
    for code, (name, color_hex) in INTENSITY_CLASSES.items():
        if code >= 10:
            px = int(np.sum(intensity_smooth == code))
            if px > 0:
                ha_val = px * pixel_area_ha
                pct = 100.0 * ha_val / total_agri_ha if total_agri_ha > 0 else 0.0
                crops_summary[name] = {
                    "code": code,
                    "area_ha": round(ha_val, 2),
                    "area_acres": round(ha_val * 2.47105, 2),
                    "percentage": round(pct, 2),
                    "color_hex": color_hex,
                    "pixels": px
                }

    # Format unique crop rotations found to display in stats
    formatted_rotations = {}
    rot_px_total = sum(rotation_patterns.values())
    
    for idx, (pat, count) in enumerate(sorted_rotations[:10]): # Top 10 patterns
        pat_ha = count * pixel_area_ha
        pat_pct = (count / rot_px_total * 100) if rot_px_total > 0 else 0.0
        formatted_rotations[pat] = {
            "code": idx + 1,
            "area_ha": round(pat_ha, 2),
            "area_acres": round(pat_ha * 2.47105, 2),
            "percentage": round(pat_pct, 1),
            "color_hex": ROTATION_COLORS[idx] if idx < len(ROTATION_COLORS) else ROTATION_COLORS[-1]
        }

    crop_stats = {
        "season": "Annual",
        "run_type": "lulc",
        "crops": crops_summary,
        "rotation_stats": formatted_rotations,
        "farm_stats": farm_stats_records,
        "village_stats": village_stats,
        "block_stats": block_stats,
        "district_stats": district_stats
    }
    
    # Save crop_stats.json in workspace dir
    STATS_PATH = os.path.join(workspace_dir, "crop_stats.json")
    with open(STATS_PATH, "w") as f:
        json.dump(crop_stats, f, indent=4)
        
    # Copy boundaries geojson to workspace
    k_geojson = os.path.join(kharif_dir, "Final_Agri_Land_Boundary.geojson")
    if os.path.exists(k_geojson):
        try:
            shutil.copy(k_geojson, os.path.join(workspace_dir, "Final_Agri_Land_Boundary.geojson"))
            shutil.copy(k_geojson.replace(".geojson", ".shp"), os.path.join(workspace_dir, "Final_Agri_Land_Boundary.shp"))
        except Exception:
            pass

    # Save extraction text report
    REPORT_PATH = os.path.join(workspace_dir, "LULC_Extraction_Report.txt")
    with open(REPORT_PATH, "w", encoding="utf-8") as rf:
        rf.write("========================================================\n")
        rf.write("    ANNUAL CROPPING INTENSITY & ROTATION REPORT\n")
        rf.write("========================================================\n\n")
        rf.write(f"Region: {safe_name}\n")
        rf.write(f"Year: {year}\n")
        rf.write(f"Total Agricultural Area: {total_agri_ha:.2f} ha\n\n")
        rf.write("--- CROPPING INTENSITY SUMMARY ---\n")
        rf.write(f"Single Crop Area: {single_ha:.2f} ha ({100.0 * single_ha/total_agri_ha if total_agri_ha > 0 else 0:.1f}%)\n")
        rf.write(f"Double Crop Area: {double_ha:.2f} ha ({100.0 * double_ha/total_agri_ha if total_agri_ha > 0 else 0:.1f}%)\n")
        rf.write(f"Triple Crop Area: {triple_ha:.2f} ha ({100.0 * triple_ha/total_agri_ha if total_agri_ha > 0 else 0:.1f}%)\n")
        rf.write(f"Fallow Cropland : {fallow_ha:.2f} ha ({100.0 * fallow_ha/total_agri_ha if total_agri_ha > 0 else 0:.1f}%)\n\n")
        rf.write("--- CROP ROTATION SUMMARY ---\n")
        for pat, info in formatted_rotations.items():
            rf.write(f"{pat:<30}: {info['area_ha']:>10.1f} ha ({info['percentage']:.1f}%)\n")

    # Save metadata.json
    metadata_path = os.path.join(workspace_dir, "metadata.json")
    try:
        current_hash = get_boundary_hash(boundary_file) if isinstance(boundary_file, str) else ""
        with open(metadata_path, 'w') as f:
            json.dump({"season": "Annual", "year": str(year), "boundary_hash": current_hash, "completed": True}, f)
    except Exception:
        pass

    yield json.dumps({
        "status": "completed_all",
        "message": "Cropping Intensity & Rotation intelligence complete",
        "mask_path": LULC_REFINED_PATH,
        "pixel_count": crop_total_px,
        "crop_stats": crop_stats
    })

def get_boundary_hash(boundary_file):
    import hashlib
    with open(boundary_file, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()
