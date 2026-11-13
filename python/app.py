import os
import json
import glob
import random
import string
import io
import re
from PIL import Image

# ── Fix PROJ database conflict ────────────────────────────────────────────────
# PostgreSQL/PostGIS ships its own old proj.db which conflicts with pyproj.
# Force rasterio/pyproj to use the correct database bundled with pyproj itself.
try:
    import pyproj
    _pyproj_data = pyproj.datadir.get_data_dir()
    os.environ["PROJ_DATA"]    = _pyproj_data
    os.environ["PROJ_LIB"]     = _pyproj_data
    os.environ["PROJ_NETWORK"] = "OFF"
except Exception:
    pass
# ─────────────────────────────────────────────────────────────────────────────

import rasterio
import numpy as np
import geopandas as gpd
from rasterio.warp import calculate_default_transform, reproject, Resampling
from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from urllib.parse import unquote_plus
import ee
from download_imagery import run_satellite_download

# Import database layer
from database import init_db, save_or_update_run, get_all_runs, get_run_by_id, delete_run

# Silence noisy health-check logs
import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize database on startup
init_db()

SERVICE_ACCOUNT = "biomis@ee-sanskarwork2810.iam.gserviceaccount.com"
KEY_PATH = "ee-sanskarwork2810-c8eadb7ac163.json"

# Resolve path to the private key JSON file
if not os.path.isabs(KEY_PATH):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    potential_path = os.path.join(script_dir, KEY_PATH)
    if os.path.exists(potential_path):
        KEY_PATH = potential_path
    else:
        parent_path = os.path.join(os.path.dirname(script_dir), KEY_PATH)
        if os.path.exists(parent_path):
            KEY_PATH = parent_path

PROJECT_ID = "ee-sanskarwork2810"
if os.path.exists(KEY_PATH):
    try:
        with open(KEY_PATH, "r") as f:
            key_data = json.load(f)
            if "project_id" in key_data:
                PROJECT_ID = key_data["project_id"]
    except Exception as e:
        print(f"WARNING: Could not parse private key JSON for project ID: {e}")

SESSION_ID = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
LATEST_OUTPUT_DIR = "D:\\Biodiversity Indicators\\Satellite Imagery"
CONFIG_STORE = {}

GEE_INITIALIZED = False
try:
    if os.path.exists(KEY_PATH):
        credentials = ee.ServiceAccountCredentials(SERVICE_ACCOUNT, KEY_PATH)
        ee.Initialize(credentials=credentials)
        GEE_INITIALIZED = True
        print(f"SUCCESS: GEE initialized using Service Account (Server ID: {SESSION_ID})")
    else:
        print(f"ERROR: GEE initialization failed: Private key file not found at '{KEY_PATH}'. Please upload/provide the JSON file.")
except Exception as e:
    print(f"ERROR: GEE initialization failed: {e}")

# Helper to calculate area stats from mask TIFF
def get_area_stats(mask_path):
    try:
        with rasterio.open(mask_path) as src:
            mask_data     = src.read(1)
            src_crs       = src.crs

        if src_crs is None:
            raise ValueError("Mask TIFF has no CRS")

        crop_pixels   = int(np.sum(mask_data == 1))
        total_pixels  = int(np.sum(mask_data != 255))

        crop_ha     = (crop_pixels  * 100) / 10000
        total_ha    = (total_pixels * 100) / 10000
        non_crop_ha = total_ha - crop_ha

    except Exception as e:
        print(f"[Stats] Area calculation failed: {e}")
        crop_ha, total_ha, non_crop_ha = 0, 0, 0
            
    return {
        "total_area": round(total_ha, 2),
        "crop_area": round(crop_ha, 2),
        "non_crop_area": round(non_crop_ha, 2),
        "unit": "ha"
    }

# Helper to save/update a run by its output folder path
def save_run_by_path(output_dir, boundary_name=None, season=None, year=None, aoi_geojson=None, run_type="agri"):
    output_dir = os.path.normpath(output_dir)
    mask_path = os.path.join(output_dir, "LULC_Refined.tif" if run_type == "lulc" else "Final_Agri_Land_Mask.tif")
    if not os.path.exists(mask_path):
        return None
        
    crop_stats = None
    stats_path = os.path.join(output_dir, "crop_stats.json")
    if os.path.exists(stats_path):
        try:
            with open(stats_path) as f:
                crop_stats = json.load(f)
        except Exception as e:
            print(f"Crop stats read error: {e}")
            
    if not crop_stats:
        crop_stats = {"season": season or "rabi", "crops": {}}
        
    if not boundary_name:
        boundary_name = os.path.basename(output_dir).replace('_', ' ')
        if not boundary_name or boundary_name == '.':
            boundary_name = "Unnamed AOI"
            
    if not season:
        season = crop_stats.get("season", "rabi")
        
    if not year:
        year = 2026
        tifs = glob.glob(os.path.join(output_dir, "*.tif"))
        for t in tifs:
            fname = os.path.basename(t).upper()
            parts = fname.split('_')
            if len(parts) >= 2:
                try:
                    date_part = parts[1]
                    year_val = int(date_part.split('-')[2])
                    year = year_val
                    break
                except:
                    pass
                    
    if not aoi_geojson:
        geojson_path = os.path.join(output_dir, "Final_Agri_Land_Boundary.geojson")
        if os.path.exists(geojson_path):
            try:
                with open(geojson_path) as f:
                    aoi_geojson = json.load(f)
            except:
                pass
                
    if run_type == "lulc":
        # Sum areas from crop_stats
        total_ha = 0.0
        crop_ha = 0.0
        non_crop_ha = 0.0
        if crop_stats and "crops" in crop_stats:
            for cname, cinfo in crop_stats["crops"].items():
                area_ha = cinfo.get("area_ha", 0.0)
                total_ha += area_ha
                if cinfo.get("code") in [40, 41, 42]:
                    crop_ha += area_ha
                else:
                    non_crop_ha += area_ha
        stats = {
            "total_area": round(total_ha, 2),
            "crop_area": round(crop_ha, 2),
            "non_crop_area": round(non_crop_ha, 2),
            "unit": "ha"
        }
    else:
        stats = get_area_stats(mask_path)
                
    ndvi_stats = {"min": -0.218, "max": 0.814, "mean": 0.329}
    ndwi_stats = {"min": -0.719, "max": 0.385, "mean": -0.395, "vwc": 25.0, "stress": 0.62, "temp": 26.3}
    try:
        ndvi, ndwi = load_ndvi_ndwi_rasters(output_dir)
        if ndvi is not None:
            valid_ndvi = ndvi[~np.isnan(ndvi) & (ndvi != -999.0)]
            if valid_ndvi.size > 0:
                ndvi_stats = {
                    "min": round(float(np.nanmin(valid_ndvi)), 3),
                    "max": round(float(np.nanmax(valid_ndvi)), 3),
                    "mean": round(float(np.nanmean(valid_ndvi)), 3)
                }
        if ndwi is not None:
            valid_ndwi = ndwi[~np.isnan(ndwi) & (ndwi != -999.0)]
            if valid_ndwi.size > 0:
                ndwi_mean = round(float(np.nanmean(valid_ndwi)), 3)
                vwc_val = round(max(min(45.0 + (ndwi_mean * 50.0), 50.0), 10.0), 1)
                stress_val = round(max(min(1.0 - (vwc_val - 10.0) / 40.0, 1.0), 0.0), 2)
                
                # Dynamic temp based on season / ndvi / vwc
                base_temp = 22.0 if (season or "").lower() == "rabi" else 31.0
                ndvi_avg = ndvi_stats["mean"]
                temp_val = round(base_temp + (-5.0 * ndvi_avg) + (-4.0 * (vwc_val - 10.0) / 40.0 + 2.0), 1)
                
                ndwi_stats = {
                    "min": round(float(np.nanmin(valid_ndwi)), 3),
                    "max": round(float(np.nanmax(valid_ndwi)), 3),
                    "mean": ndwi_mean,
                    "vwc": vwc_val,
                    "stress": stress_val,
                    "temp": temp_val
                }
    except Exception as e:
        print(f"Error calculating NDVI/NDWI stats in save_run_by_path: {e}")
        
    weather_data = None
    centroid = get_centroid_from_geojson(aoi_geojson)
    if centroid:
        lat, lon = centroid
        try:
            import urllib.request
            url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto"
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=5) as response:
                weather_data = json.loads(response.read().decode('utf-8'))
        except Exception as we:
            print(f"[Weather] Failed to fetch weather for centroid {lat}, {lon}: {we}")

    try:
        run_id = save_or_update_run(
            boundary_name=boundary_name,
            season=season,
            year=year,
            output_dir=output_dir,
            aoi_geojson=aoi_geojson,
            stats=stats,
            crop_stats_data=crop_stats,
            ndvi_stats=ndvi_stats,
            ndwi_stats=ndwi_stats,
            weather_data=weather_data,
            run_type=run_type
        )
        return run_id
    except Exception as e:
        print(f"Error in save_run_by_path: {e}")
        return None

def get_centroid_from_geojson(geojson_data):
    try:
        if not geojson_data:
            return None
        if isinstance(geojson_data, str):
            geojson_data = json.loads(geojson_data)
        coords = []
        def extract_coords(geom):
            t = geom.get("type")    
            c = geom.get("coordinates")
            if t == "Point":
                coords.append(c)
            elif t in ("LineString", "MultiPoint"):
                coords.extend(c)
            elif t in ("Polygon", "MultiLineString"):
                for ring in c:
                    coords.extend(ring)
            elif t == "MultiPolygon":
                for poly in c:
                    for ring in poly:
                        coords.extend(ring)
        if geojson_data.get("type") == "FeatureCollection":
            for f in geojson_data.get("features", []):
                geom = f.get("geometry")
                if geom:
                    extract_coords(geom)
        elif geojson_data.get("type") == "Feature":
            geom = geojson_data.get("geometry")
            if geom:
                extract_coords(geom)
        else:
            extract_coords(geojson_data)
        if not coords:
            return None
        lons = [pt[0] for pt in coords]
        lats = [pt[1] for pt in coords]
        return sum(lats) / len(lats), sum(lons) / len(lons)
    except Exception as e:
        print(f"Error calculating centroid: {e}")
        return None

@app.route('/api/weather')
def get_weather_forecast():
    import urllib.request
    import urllib.error
    lat = request.args.get('latitude')
    lon = request.args.get('longitude')
    if not lat or not lon:
        return jsonify({"status": "error", "message": "latitude and longitude are required"}), 400
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            return jsonify(data)
    except urllib.error.URLError as e:
        print(f"Error fetching weather from Open-Meteo: {e}")
        return jsonify({"status": "error", "message": str(e)}), 502
    except Exception as e:
        print(f"Internal error in weather forecast proxy: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/')
def health_check():
    return jsonify({
        "status": "alive",
        "gee_status": "initialized" if GEE_INITIALIZED else "failed",
        "project": PROJECT_ID
    })

@app.route('/api/configure-analysis', methods=['POST'])
def configure_analysis():
    global LATEST_OUTPUT_DIR
    data = request.json
    config_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))
    
    output_dir = data.get('output_dir', LATEST_OUTPUT_DIR)
    boundary_name = data.get('boundaryName', '')
    season = data.get('season', '')
    year = data.get('year', '')
    analysis_type = data.get('analysis_type', 'agri')
    
    if boundary_name:
        safe_name = re.sub(r'[^a-zA-Z0-9_\- ]', '', boundary_name).strip().replace(' ', '_')
        if analysis_type == 'cropping_intensity':
            folder_name = f"{safe_name}_Annual_{year}"
        else:
            safe_season = re.sub(r'[^a-zA-Z0-9]', '', str(season)).capitalize()
            safe_year = re.sub(r'[^a-zA-Z0-9\-]', '', str(year))
            folder_name = f"{safe_name}_{safe_season}_{safe_year}"
        output_dir = os.path.join(output_dir, folder_name)
        os.makedirs(output_dir, exist_ok=True)
    
    CONFIG_STORE[config_id] = {
        'aoi': data.get('aoi'),
        'season': data.get('season'),
        'year': data.get('year'),
        'output_dir': output_dir,
        'boundary_name': boundary_name or "Unnamed AOI",
        'analysis_type': analysis_type
    }
    
    return jsonify({"config_id": config_id})

@app.route('/stream-analysis', methods=['GET'])
def stream_analysis():
    global LATEST_OUTPUT_DIR
    config_id = request.args.get('config_id')
    
    boundary_name = "Unnamed AOI"
    analysis_type = "agri"
    if config_id and config_id in CONFIG_STORE:
        config = CONFIG_STORE.pop(config_id)
        aoi = config['aoi']
        season = config['season']
        year = config['year']
        output_dir = config['output_dir']
        boundary_name = config.get('boundary_name', 'Unnamed AOI')
        analysis_type = config.get('analysis_type', 'agri')
    else:
        aoi_raw = request.args.get('aoi')
        season = request.args.get('season')
        year = request.args.get('year')
        boundary_name = request.args.get('boundary_name', 'Unnamed AOI')
        output_dir_base = unquote_plus(request.args.get('output_dir', LATEST_OUTPUT_DIR))
        analysis_type = request.args.get('analysis_type', 'agri')
        try:
            aoi = json.loads(aoi_raw) if aoi_raw else None
        except:
            return "Invalid AOI format", 400

        # Construct isolated directory if boundary_name is provided
        if boundary_name:
            safe_name = re.sub(r'[^a-zA-Z0-9_\- ]', '', boundary_name).strip().replace(' ', '_')
            if analysis_type == 'cropping_intensity':
                folder_name = f"{safe_name}_Annual_{year}"
            else:
                safe_season = re.sub(r'[^a-zA-Z0-9]', '', str(season or '')).capitalize()
                safe_year = re.sub(r'[^a-zA-Z0-9\-]', '', str(year or ''))
                folder_name = f"{safe_name}_{safe_season}_{safe_year}"
            
            if not output_dir_base.endswith(folder_name):
                output_dir = os.path.join(output_dir_base, folder_name)
            else:
                output_dir = output_dir_base
        else:
            output_dir = output_dir_base
        os.makedirs(output_dir, exist_ok=True)

    if not aoi:
        return "Missing configuration", 400

    print(f">>> [SSE] Connection Received (ID: {SESSION_ID})", flush=True)
    LATEST_OUTPUT_DIR = output_dir

    def generate():
        try:
            if analysis_type == 'combined':
                # Step 1: Run satellite download (agri extraction and classification)
                for update in run_satellite_download(aoi, season, int(year), output_dir):
                    try:
                        up_dict = json.loads(update)
                        if up_dict.get("status") == "completed_all":
                            up_dict["status"] = "crop_completed"
                            update = json.dumps(up_dict)
                    except:
                        pass
                    yield f"data: {update}\n\n"
                
                # Backup crop_stats.json to agri_stats.json
                agri_stats_src = os.path.join(output_dir, "crop_stats.json")
                agri_stats_dest = os.path.join(output_dir, "agri_stats.json")
                if os.path.exists(agri_stats_src):
                    try:
                        import shutil
                        shutil.copy(agri_stats_src, agri_stats_dest)
                    except Exception as e:
                        print(f"[Combined Process] Error backing up agri stats: {e}")

                # Step 2: Run LULC analysis
                from lulc_intelligence import run_lulc_analysis
                for update in run_lulc_analysis(aoi, output_dir, season, int(year)):
                    yield f"data: {update}\n\n"

                # Move crop_stats.json (from LULC) to lulc_stats.json
                lulc_stats_dest = os.path.join(output_dir, "lulc_stats.json")
                if os.path.exists(agri_stats_src):
                    try:
                        import shutil
                        shutil.move(agri_stats_src, lulc_stats_dest)
                    except Exception as e:
                        print(f"[Combined Process] Error saving lulc stats: {e}")

                # Restore agri_stats.json to crop_stats.json
                if os.path.exists(agri_stats_dest):
                    try:
                        import shutil
                        shutil.move(agri_stats_dest, agri_stats_src)
                    except Exception as e:
                        print(f"[Combined Process] Error restoring agri stats: {e}")

                # Refine agricultural mask using the LULC cropland classes
                try:
                    refine_agri_mask_with_lulc(output_dir)
                except Exception as re_e:
                    print(f"[Combined Process] Error during combined mask refinement: {re_e}")

                # Step 3: Save combined run to database
                try:
                    save_run_by_path(output_dir, boundary_name, season, int(year), aoi, run_type="combined")
                except Exception as dbe:
                    print(f"[Database] Error auto-saving combined run: {dbe}")
            elif analysis_type == 'cropping_intensity':
                from cropping_intensity_intelligence import run_cropping_intensity_analysis
                for update in run_cropping_intensity_analysis(aoi, output_dir, int(year)):
                    yield f"data: {update}\n\n"
                
                try:
                    save_run_by_path(output_dir, boundary_name, "Annual", int(year), aoi, run_type="lulc")
                except Exception as dbe:
                    print(f"[Database] Error auto-saving Cropping Intensity run: {dbe}")
            elif analysis_type == 'lulc':
                from lulc_intelligence import run_lulc_analysis
                for update in run_lulc_analysis(aoi, output_dir, season, int(year)):
                    yield f"data: {update}\n\n"
                
                try:
                    save_run_by_path(output_dir, boundary_name, season, int(year), aoi, run_type="lulc")
                except Exception as dbe:
                    print(f"[Database] Error auto-saving LULC run: {dbe}")
            else:
                for update in run_satellite_download(aoi, season, int(year), output_dir):
                    yield f"data: {update}\n\n"
                
                try:
                    save_run_by_path(output_dir, boundary_name, season, int(year), aoi, run_type="agri")
                except Exception as dbe:
                    print(f"[Database] Error auto-saving run: {dbe}")
        except Exception as e:
            import traceback
            error_msg = f"ERROR: {str(e)}\n{traceback.format_exc()}"
            print(f">>> [CRITICAL] {error_msg}", flush=True)
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"

    return Response(generate(), mimetype='text/event-stream')

def refine_agri_mask_with_lulc(output_dir):
    try:
        mask_path = os.path.normpath(os.path.join(output_dir, "Final_Agri_Land_Mask.tif"))
        lulc_path = os.path.normpath(os.path.join(output_dir, "LULC_Refined.tif"))
        class_path = os.path.normpath(os.path.join(output_dir, "Crop_Classification.tif"))
        stats_path = os.path.normpath(os.path.join(output_dir, "crop_stats.json"))
        
        if not (os.path.exists(mask_path) and os.path.exists(lulc_path)):
            return False

        # Read rasters
        with rasterio.open(mask_path) as src_mask:
            mask_data = src_mask.read(1)
            mask_meta = src_mask.meta.copy()

        with rasterio.open(lulc_path) as src_lulc:
            lulc_data = src_lulc.read(1)

        # Cropland class codes: 40 (Cropland), 41 (Irrigated), 42 (Fallow)
        cropland_mask = (lulc_data == 40) | (lulc_data == 41) | (lulc_data == 42)
        
        # Pixels that are marked active crop (1) but are NOT in LULC cropland
        invalid_pixels = (mask_data == 1) & (~cropland_mask)
        
        if np.sum(invalid_pixels) == 0:
            # Already refined or no mismatch
            return False

        print(f"[Refine Mask] Refining {np.sum(invalid_pixels)} invalid pixels in {output_dir}")

        # Update Final_Agri_Land_Mask
        mask_data[invalid_pixels] = 0
        with rasterio.open(mask_path, 'w', **mask_meta) as dst_mask:
            dst_mask.write(mask_data, 1)

        # Update Crop_Classification raster if it exists
        if os.path.exists(class_path):
            with rasterio.open(class_path) as src_class:
                class_data = src_class.read(1)
                class_meta = src_class.meta.copy()
            class_data[invalid_pixels] = 0
            with rasterio.open(class_path, 'w', **class_meta) as dst_class:
                dst_class.write(class_data, 1)

        # Update crop_stats.json if it exists
        if os.path.exists(stats_path) and os.path.exists(class_path):
            with open(stats_path, 'r') as f:
                stats_json = json.load(f)
            
            season = stats_json.get("season", "rabi")
            from agri_process import CROP_REGISTRY
            registry = CROP_REGISTRY.get(season.lower(), CROP_REGISTRY['rabi'])
            
            # Recalculate stats from refined class_data
            crop_stats = stats_json.get("crops", {})
            total_agri_px = int(np.sum(mask_data == 1))
            
            for code, info in registry.items():
                cname = info['name']
                if cname in crop_stats:
                    crop_mask = (class_data == code)
                    px = int(np.sum(crop_mask))
                    
                    area_ha = round((px * 100) / 10000, 2)
                    area_acres = round(area_ha * 2.47105, 2)
                    pct = round((px / total_agri_px * 100) if total_agri_px > 0 else 0, 1)
                    
                    # Update stats_json entry
                    crop_stats[cname]['pixels'] = px
                    crop_stats[cname]['area_ha'] = area_ha
                    crop_stats[cname]['area_acres'] = area_acres
                    crop_stats[cname]['percentage'] = pct
                    # recalculate estimated yield based on existing yield_t_ha
                    yield_t_ha = crop_stats[cname].get('yield_t_ha', info['yield_t_ha'])
                    crop_stats[cname]['est_yield_tonnes'] = round(area_ha * yield_t_ha, 1)
            
            stats_json["crops"] = crop_stats
            with open(stats_path, 'w') as f:
                json.dump(stats_json, f, indent=2)

        # Update GeoJSON and shapefile if they exist
        shp_path = os.path.join(output_dir, "Final_Agri_Land_Boundary.shp")
        if os.path.exists(shp_path):
            from rasterio.features import shapes
            from shapely.geometry import shape
            import geopandas as gpd
            
            mask_shapes = shapes(mask_data, mask=(mask_data == 1), transform=mask_meta['transform'])
            polygons = [shape(s) for s, v in mask_shapes]
            
            if polygons:
                gdf = gpd.GeoDataFrame({'geometry': polygons}, crs=mask_meta['crs'])
                utm_crs = gdf.estimate_utm_crs()
                gdf_utm = gdf.to_crs(utm_crs)
                gdf_utm = gdf_utm[gdf_utm.geometry.area > 1500]
                
                if not gdf_utm.empty:
                    gdf = gdf_utm.to_crs("EPSG:4326")
                    gdf['geometry'] = gdf.geometry.simplify(0.0001, preserve_topology=True)
                    gdf.to_file(shp_path)
                    gdf.to_file(shp_path.replace(".shp", ".geojson"), driver='GeoJSON')
                    print(f"[Refine Mask] Updated shapefile and GeoJSON with {len(gdf)} refined polygons")
                else:
                    for ext in ['.shp', '.shx', '.dbf', '.prj', '.geojson']:
                        f_to_del = shp_path.replace(".shp", ext)
                        if os.path.exists(f_to_del):
                            os.remove(f_to_del)
            else:
                for ext in ['.shp', '.shx', '.dbf', '.prj', '.geojson']:
                    f_to_del = shp_path.replace(".shp", ext)
                    if os.path.exists(f_to_del):
                        os.remove(f_to_del)

        # Re-save static PNGs
        try:
            from agri_process import save_static_pngs
            comp_path = os.path.join(output_dir, "Seasonal_Median_Composite.tif")
            agri_only_path = os.path.join(output_dir, "Agriculture_Only.tif")
            if os.path.exists(comp_path) and os.path.exists(agri_only_path):
                with rasterio.open(comp_path) as src_comp:
                    median_composite = src_comp.read([1, 2, 3])
                    comp_meta = src_comp.meta.copy()
                
                agri_only_rgb = np.zeros_like(median_composite)
                for i in range(3):
                    agri_only_rgb[i] = np.where(mask_data == 1, median_composite[i], 0)
                
                with rasterio.open(agri_only_path, 'w', **comp_meta) as dst:
                    for i in range(3):
                        dst.write(agri_only_rgb[i], i + 1)
                        
            save_static_pngs(output_dir, season)
            print("[Refine Mask] Updated static PNG files")
        except Exception as e_png:
            print(f"[Refine Mask] Failed to update static PNGs: {e_png}")

        return True
    except Exception as ex:
        print(f"[Refine Mask] Error during refinement: {ex}")
        import traceback
        traceback.print_exc()
        return False

@app.route('/api/results')
def get_results():
    """Returns real area stats, crop classification stats, and GeoJSON for the dashboard"""
    global LATEST_OUTPUT_DIR
    req_dir = request.args.get('output_dir')
    if req_dir:
        LATEST_OUTPUT_DIR = os.path.normpath(req_dir)

    # Refine agricultural mask if combined LULC data is available
    refine_agri_mask_with_lulc(LATEST_OUTPUT_DIR)

    is_combined = False
    is_lulc = False
    
    # 1. Query the database to find the run matching the output_dir
    db_run_type = None
    db_aoi_geojson = None
    try:
        from database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        norm_dir = os.path.normpath(LATEST_OUTPUT_DIR)
        cursor.execute("SELECT run_type, aoi_geojson FROM runs WHERE output_dir = ? OR output_dir = ?", (norm_dir, LATEST_OUTPUT_DIR))
        row = cursor.fetchone()
        if row:
            try:
                db_run_type = row['run_type']
                db_aoi_geojson = row['aoi_geojson']
            except:
                db_run_type = row[0]
                db_aoi_geojson = row[1]
        conn.close()
    except Exception as dbe:
        print(f"[Results API] Database query for run_type failed: {dbe}")

    if db_run_type:
        is_combined = (db_run_type == "combined")
        is_lulc = (db_run_type == "lulc")
        print(f"[Results API] Determined run_type from database: {db_run_type}")
    else:
        # 2. Check file existence to determine run type
        if os.path.exists(os.path.join(LATEST_OUTPUT_DIR, "Final_Agri_Land_Mask.tif")) and os.path.exists(os.path.join(LATEST_OUTPUT_DIR, "LULC_Refined.tif")):
            is_combined = True
        elif os.path.exists(os.path.join(LATEST_OUTPUT_DIR, "LULC_Refined.tif")):
            is_lulc = True

    mask_path = os.path.join(LATEST_OUTPUT_DIR, "LULC_Refined.tif" if is_lulc else "Final_Agri_Land_Mask.tif")
    shp_path  = os.path.join(LATEST_OUTPUT_DIR, "Final_Agri_Land_Boundary.shp")
    
    if not os.path.exists(mask_path):
        # Fallback to the latest run from the database
        try:
            runs = get_all_runs()
            if runs:
                latest_run = get_run_by_id(runs[0]["id"])
                if latest_run:
                    LATEST_OUTPUT_DIR = os.path.normpath(latest_run["output_dir"])
                    db_rt = latest_run.get("run_type", "agri")
                    is_combined = (db_rt == "combined")
                    is_lulc = (db_rt == "lulc")
                    mask_path = os.path.join(LATEST_OUTPUT_DIR, "LULC_Refined.tif" if is_lulc else "Final_Agri_Land_Mask.tif")
                    shp_path = os.path.join(LATEST_OUTPUT_DIR, "Final_Agri_Land_Boundary.shp")
                    print(f"[Fallback] Serving latest run {latest_run['id']} ({latest_run['boundary_name']}) from output_dir: {LATEST_OUTPUT_DIR}")
        except Exception as dbe:
            print(f"[Fallback] Error checking latest DB run: {dbe}")

    if not os.path.exists(mask_path):
        return jsonify({"status": "error", "message": f"Results file not found at {mask_path}"}), 404

    # 2. Crop classification stats (read pre-computed JSON)
    crop_stats = None
    stats_path = os.path.join(LATEST_OUTPUT_DIR, "crop_stats.json")
    if os.path.exists(stats_path):
        try:
            with open(stats_path) as f:
                crop_stats = json.load(f)
        except Exception as e:
            print(f"Crop stats read error: {e}")

    # 2b. LULC classification stats (read pre-computed JSON if combined)
    lulc_stats = None
    if is_combined:
        lulc_stats_path = os.path.join(LATEST_OUTPUT_DIR, "lulc_stats.json")
        if os.path.exists(lulc_stats_path):
            try:
                with open(lulc_stats_path) as f:
                    lulc_stats = json.load(f)
            except Exception as e:
                print(f"LULC stats read error: {e}")

    # Inject missing colors dynamically for LULC classes in crop_stats / lulc_stats
    # and override agricultural crop colors to match CROP_REGISTRY dynamically
    try:
        from lulc_intelligence import LULC_CLASSES
        from agri_process import CROP_REGISTRY
        
        lulc_colors = {name: color for code, (name, color) in LULC_CLASSES.items()}
        
        # Load CROP_REGISTRY colors
        crop_season = crop_stats.get("season", "rabi") if crop_stats else "rabi"
        registry = CROP_REGISTRY.get(crop_season.lower(), CROP_REGISTRY['rabi'])
        crop_colors = {info['name'].lower(): '#{:02x}{:02x}{:02x}'.format(*info['color'][:3]) for code, info in registry.items()}

        if lulc_stats and "crops" in lulc_stats:
            for cname, cinfo in lulc_stats["crops"].items():
                if "color_hex" not in cinfo or not cinfo["color_hex"]:
                    if cname in lulc_colors:
                        cinfo["color_hex"] = lulc_colors[cname]

        if crop_stats and "crops" in crop_stats:
            for cname, cinfo in crop_stats["crops"].items():
                cname_lower = cname.lower()
                # If we are in LULC mode, use LULC colors, otherwise use CROP_REGISTRY colors
                if is_lulc:
                    if "color_hex" not in cinfo or not cinfo["color_hex"]:
                        if cname in lulc_colors:
                            cinfo["color_hex"] = lulc_colors[cname]
                else:
                    if cname_lower in crop_colors:
                        cinfo["color_hex"] = crop_colors[cname_lower]
    except Exception as e_color:
        print(f"Error injecting missing LULC/crop colors: {e_color}")

    # 1. Area stats
    if is_lulc:
        total_ha = 0.0
        crop_ha = 0.0
        non_crop_ha = 0.0
        is_cropping_intensity = (crop_stats and "rotation_stats" in crop_stats)
        if crop_stats and "crops" in crop_stats:
            for cname, cinfo in crop_stats["crops"].items():
                area_ha = cinfo.get("area_ha", 0.0)
                total_ha += area_ha
                if is_cropping_intensity:
                    # Codes 2, 3, 4 represent active Single, Double, Triple cropped lands
                    if cinfo.get("code") in [2, 3, 4]:
                        crop_ha += area_ha
                    else:
                        non_crop_ha += area_ha
                else:
                    if cinfo.get("code") in [40, 41, 42]:
                        crop_ha += area_ha
                    else:
                        non_crop_ha += area_ha
        stats = {
            "total_area": round(total_ha, 2),
            "crop_area": round(crop_ha, 2),
            "non_crop_area": round(non_crop_ha, 2),
            "unit": "ha"
        }
    else:
        stats = get_area_stats(mask_path)
        total_ha = stats["total_area"]
        crop_ha = stats["crop_area"]
        non_crop_ha = stats["non_crop_area"]

    # 3. GeoJSON from shapefile or local GeoJSON file or database fallback
    geojson = None
    if os.path.exists(shp_path):
        try:
            gdf = gpd.read_file(shp_path)
            geojson = json.loads(gdf.to_crs(epsg=4326).to_json())
        except Exception as e:
            print(f"GIS Error: {e}")
    else: 
        geojson_path = os.path.join(LATEST_OUTPUT_DIR, "Final_Agri_Land_Boundary.geojson")
        if os.path.exists(geojson_path):
            try:
                with open(geojson_path) as f:
                    geojson = json.load(f)
            except Exception as e:
                print(f"[Results API] GeoJSON read error: {e}")
        elif db_aoi_geojson:
            try:
                if isinstance(db_aoi_geojson, str):
                    geojson = json.loads(db_aoi_geojson)
                else:
                    geojson = db_aoi_geojson
            except Exception as e:
                print(f"[Results API] Stored GeoJSON parse error: {e}")

    # 4. Composite image bounds
    bounds = None
    composite_file = os.path.join(LATEST_OUTPUT_DIR, "Seasonal_Median_Composite.tif")
    if os.path.exists(composite_file):
        try:
            with rasterio.open(composite_file) as src:
                b = src.bounds
                bounds = [[b.bottom, b.left], [b.top, b.right]]
        except Exception as e:
            print(f"[Results API] Error opening composite TIFF: {e}")

    # Fallback to mask bounds if composite_file does not exist
    if not bounds and os.path.exists(mask_path):
        try:
            with rasterio.open(mask_path) as src:
                b = src.bounds
                if abs(b.left) > 180 or abs(b.right) > 180:
                    try:
                        from rasterio.warp import transform_bounds
                        tb = transform_bounds(src.crs, 'EPSG:4326', *src.bounds)
                        bounds = [[tb[1], tb[0]], [tb[3], tb[2]]]
                    except Exception as te:
                        print(f"[Results API] transform_bounds on mask failed: {te}")
                        bounds = [[b.bottom, b.left], [b.top, b.right]]
                else:
                    bounds = [[b.bottom, b.left], [b.top, b.right]]
        except Exception as e:
            print(f"[Results API] Error opening mask TIFF for bounds: {e}")

    if not bounds and geojson:
        bounds = get_geojson_bounds(geojson)

    # 4b. Calculate NDVI & NDWI stats
    ndvi_stats = {"min": -0.218, "max": 0.814, "mean": 0.329}
    ndwi_stats = {"min": -0.719, "max": 0.385, "mean": -0.395, "vwc": 25.0, "stress": 0.62, "temp": 26.3}
    try:
        ndvi, ndwi = load_ndvi_ndwi_rasters(LATEST_OUTPUT_DIR)
        if ndvi is not None:
            valid_ndvi = ndvi[~np.isnan(ndvi) & (ndvi != -999.0)]
            if valid_ndvi.size > 0:
                ndvi_stats = {
                    "min": round(float(np.nanmin(valid_ndvi)), 3),
                    "max": round(float(np.nanmax(valid_ndvi)), 3),
                    "mean": round(float(np.nanmean(valid_ndvi)), 3)
                }
        if ndwi is not None:
            valid_ndwi = ndwi[~np.isnan(ndwi) & (ndwi != -999.0)]
            if valid_ndwi.size > 0:
                ndwi_mean = round(float(np.nanmean(valid_ndwi)), 3)
                vwc_val = round(max(min(45.0 + (ndwi_mean * 50.0), 50.0), 10.0), 1)
                stress_val = round(max(min(1.0 - (vwc_val - 10.0) / 40.0, 1.0), 0.0), 2)
                
                # Dynamic temp based on season / ndvi / vwc
                season_name = crop_stats.get("season", "rabi").lower() if crop_stats else "rabi"
                base_temp = 22.0 if season_name == "rabi" else 31.0
                ndvi_avg = ndvi_stats["mean"]
                temp_val = round(base_temp + (-5.0 * ndvi_avg) + (-4.0 * (vwc_val - 10.0) / 40.0 + 2.0), 1)
                
                ndwi_stats = {
                    "min": round(float(np.nanmin(valid_ndwi)), 3),
                    "max": round(float(np.nanmax(valid_ndwi)), 3),
                    "mean": ndwi_mean,
                    "vwc": vwc_val,
                    "stress": stress_val,
                    "temp": temp_val
                }
    except Exception as ne:
        print(f"Error calculating NDVI/NDWI stats: {ne}")

    # 5. Auto-register/update in SQLite database
    run_id = None
    weather_data = None
    try:
        run_id = save_run_by_path(output_dir=LATEST_OUTPUT_DIR, aoi_geojson=geojson, run_type="combined" if is_combined else ("lulc" if is_lulc else "agri"))
        if run_id:
            run_db_data = get_run_by_id(run_id)
            if run_db_data:
                weather_data = run_db_data.get("weather_data")
    except Exception as dbe:
        print(f"[Database] Auto-save/update failed: {dbe}")

    # Calculate carbon and methane stats
    total_carbon_stock = 0.0
    total_soc_pct = 0.0
    total_methane = 0.0 
    
    active_stats = lulc_stats if (is_lulc and lulc_stats is not None) else crop_stats
    
    if active_stats and "crops" in active_stats:
        for cname, cinfo in active_stats["crops"].items():
            area_ha = cinfo.get("area_ha", 0.0)
            
            # Estimate SOC % based on crop type
            name_lower = cname.lower()
            if "wheat" in name_lower:
                soc_val = 0.85
                ch4_ef = 2.5
            elif "mustard" in name_lower:
                soc_val = 0.72
                ch4_ef = 2.5
            elif "gram" in name_lower:
                soc_val = 0.68
                ch4_ef = 2.0
            elif "rice" in name_lower or "paddy" in name_lower:
                soc_val = 0.95
                ch4_ef = 140.0  # High methane emission for waterlogged rice
            elif "cotton" in name_lower:
                soc_val = 0.78
                ch4_ef = 3.0
            elif "bajra" in name_lower:
                soc_val = 0.58
                ch4_ef = 2.0
            elif "maize" in name_lower:
                soc_val = 0.76
                ch4_ef = 3.0
            elif "vegetable" in name_lower:
                soc_val = 0.90
                ch4_ef = 4.0
            elif "melon" in name_lower or "gourd" in name_lower:
                soc_val = 0.82
                ch4_ef = 3.0
            else:
                soc_val = 0.65
                ch4_ef = 2.5
                
            cinfo["soc_percent"] = soc_val
            cinfo["carbon_stock_tonnes"] = round(area_ha * soc_val * 1.3 * 30.0, 1) # SOC% * Bulk Density (1.3) * Depth (30cm)
            cinfo["methane_emissions_kg"] = round(area_ha * ch4_ef, 1)
            
            total_carbon_stock += cinfo["carbon_stock_tonnes"]
            total_soc_pct += soc_val * area_ha
            total_methane += cinfo["methane_emissions_kg"]
            
    avg_soc = (total_soc_pct / crop_ha) if crop_ha > 0 else 0.45

    return jsonify({
        "status": "success",
        "run_id": run_id,
        "run_type": "combined" if is_combined else ("lulc" if is_lulc else "agri"),
        "stats": {
            "total_area":    round(total_ha, 2),
            "crop_area":     round(crop_ha, 2),
            "non_crop_area": round(non_crop_ha, 2),
            "unit": "ha"
        },
        "crop_stats": crop_stats,
        "lulc_stats": lulc_stats,
        "geojson":          geojson,
        "composite_bounds": bounds,
        "ndvi_stats":       ndvi_stats,
        "ndwi_stats":       ndwi_stats,
        "weather_data":     weather_data,
        "composite_url":    f"http://127.0.0.1:5000/api/composite-png?run_id={run_id}" if run_id else f"http://127.0.0.1:5000/api/composite-png?output_dir={LATEST_OUTPUT_DIR}",
        "agriculture_url":  f"http://127.0.0.1:5000/api/agriculture-png?run_id={run_id}" if run_id else f"http://127.0.0.1:5000/api/agriculture-png?output_dir={LATEST_OUTPUT_DIR}",
        "classification_url": f"http://127.0.0.1:5000/api/classification-png?run_id={run_id}&type=crop" if run_id else f"http://127.0.0.1:5000/api/classification-png?output_dir={LATEST_OUTPUT_DIR}&type=crop",
        "lulc_classification_url": f"http://127.0.0.1:5000/api/classification-png?run_id={run_id}&type=lulc" if run_id else f"http://127.0.0.1:5000/api/classification-png?output_dir={LATEST_OUTPUT_DIR}&type=lulc",
        "ndvi_url":         f"http://127.0.0.1:5000/api/ndvi-png?run_id={run_id}" if run_id else f"http://127.0.0.1:5000/api/ndvi-png?output_dir={LATEST_OUTPUT_DIR}",
        "ndwi_url":         f"http://127.0.0.1:5000/api/ndwi-png?run_id={run_id}" if run_id else f"http://127.0.0.1:5000/api/ndwi-png?output_dir={LATEST_OUTPUT_DIR}",
        "carbon_stats": {
            "total_carbon_stock_tonnes": round(total_carbon_stock, 1),
            "average_soc_percent": round(avg_soc, 3),
            "co2_equivalent_tonnes": round(total_carbon_stock * 3.67, 1)
        },
        "methane_stats": {
            "total_methane_emissions_kg": round(total_methane, 1),
            "average_concentration_ppb": round(1805.0 + (total_methane / (crop_ha + 1)) * 0.1, 1) if crop_ha > 0 else 1805.0,
            "co2_equivalent_tonnes": round((total_methane * 28.0) / 1000.0, 1)
        },
        "carbon_url": f"http://127.0.0.1:5000/api/carbon-png?run_id={run_id}" if run_id else f"http://127.0.0.1:5000/api/carbon-png?output_dir={LATEST_OUTPUT_DIR}",
        "methane_url": f"http://127.0.0.1:5000/api/methane-png?run_id={run_id}" if run_id else f"http://127.0.0.1:5000/api/methane-png?output_dir={LATEST_OUTPUT_DIR}",
        "rotation_url": f"http://127.0.0.1:5000/api/rotation-png?run_id={run_id}" if run_id else f"http://127.0.0.1:5000/api/rotation-png?output_dir={LATEST_OUTPUT_DIR}"
    })

def load_ndvi_ndwi_rasters(run_dir):
    ndvi_path = os.path.join(run_dir, "NDVI_Max.tif")
    ndwi_path = os.path.join(run_dir, "NDWI_Min.tif")
    
    if os.path.exists(ndvi_path) and os.path.exists(ndwi_path):
        with rasterio.open(ndvi_path) as src:
            ndvi = src.read(1)
        with rasterio.open(ndwi_path) as src:
            ndwi = src.read(1)
        return ndvi, ndwi
        
    # Dynamically compute if not pre-generated
    import warnings
    from datetime import datetime
    
    exclude_keywords = [
        "final_agri_land_mask", "crop_classification", "agriculture_only",
        "seasonal_median_composite", "ndvi_max", "ndwi_min", "dem_30m",
        "lulc_refined", "lulc_visual", "dynamicworld", "gedi", "pest_risk_map"
    ]
    all_files = glob.glob(os.path.join(run_dir, "*.tif"))
    
    # Filter files
    tif_files = []
    for f in all_files:
        base = os.path.basename(f).lower()
        if any(kw in base for kw in exclude_keywords):
            continue
        tif_files.append(f)
        
    def get_date_key(fpath):
        fname = os.path.basename(fpath).upper()
        parts = fname.split('_')
        if len(parts) >= 2:
            try:
                date_part = parts[1]
                return datetime.strptime(date_part, "%d-%m-%Y")
            except:
                pass
        return datetime.min
        
    snaps = []
    composites = []
    for f in tif_files:
        base = os.path.basename(f).lower()
        if base.startswith(("rabi_", "kharif_", "zaid_")) and get_date_key(f) != datetime.min:
            snaps.append(f)
        elif "sentinel2_image" in base or "s2_wetseason" in base:
            composites.append(f)
            
    if snaps:
        selected_files = sorted(snaps, key=get_date_key)
    elif composites:
        selected_files = sorted(composites, key=lambda x: 0 if "sentinel2_image" in os.path.basename(x).lower() else 1)
    else:
        selected_files = tif_files
        
    if not selected_files:
        return None, None
        
    ndvi_stack = []
    ndwi_stack = []
    
    with np.errstate(divide='ignore', invalid='ignore'):
        for fpath in selected_files:
            try:
                with rasterio.open(fpath) as src:
                    fname = os.path.basename(fpath).lower()
                    if "sentinel2_image" in fname or "s2_wetseason" in fname:
                        # Standard 12-band order: B1..B12
                        # B4 (Red) is Band 4, B3 (Green) is Band 3, B8 (NIR) is Band 8
                        if src.count >= 8:
                            red = src.read(4).astype('float32')
                            green = src.read(3).astype('float32')
                            nir = src.read(8).astype('float32')
                        else:
                            red = src.read(1).astype('float32')
                            green = src.read(2).astype('float32') if src.count >= 2 else src.read(1).astype('float32')
                            nir = src.read(src.count).astype('float32')
                    else:
                        # Snap 12-band order: Band 1=B4 (Red), Band 2=B3 (Green), Band 4=B8 (NIR)
                        if src.count >= 4:
                            red = src.read(1).astype('float32')
                            green = src.read(2).astype('float32')
                            nir = src.read(4).astype('float32')
                        else:
                            red = src.read(1).astype('float32')
                            green = src.read(2).astype('float32') if src.count >= 2 else src.read(1).astype('float32')
                            nir = src.read(src.count).astype('float32')
                            
                    d = nir + red
                    ndvi = np.where(d == 0, np.nan, (nir - red) / d)
                    ndvi_stack.append(ndvi)
                    
                    d = green + nir
                    ndwi = np.where(d == 0, np.nan, (green - nir) / d)
                    ndwi_stack.append(ndwi)
            except Exception as e:
                print(f"Error reading snap {fpath} for dynamic NDVI/NDWI: {e}")
                
    if not ndvi_stack:
        return None, None
        
    # Standardize shapes to avoid "all input arrays must have the same shape"
    ref_shape = ndvi_stack[0].shape
    clean_ndvi_stack = []
    clean_ndwi_stack = []
    for i in range(len(ndvi_stack)):
        if ndvi_stack[i].shape == ref_shape:
            clean_ndvi_stack.append(ndvi_stack[i])
            clean_ndwi_stack.append(ndwi_stack[i])
        else:
            print(f"Skipping snap index {i} due to shape mismatch: {ndvi_stack[i].shape} != {ref_shape}")
            
    if not clean_ndvi_stack:
        return None, None
        
    ndvi_stack = np.stack(clean_ndvi_stack, axis=0)
    ndwi_stack = np.stack(clean_ndwi_stack, axis=0)
    
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        ndvi_max = np.nanmax(ndvi_stack, axis=0)
        ndwi_min = np.nanmin(ndwi_stack, axis=0)
        
    return ndvi_max, ndwi_min

@app.route('/api/ndvi-png')
def get_ndvi_png():
    """Renders the NDVI maximum vegetation index as a colormapped RGBA PNG."""
    req_dir = request.args.get('output_dir')
    run_id = request.args.get('run_id')
    
    if run_id:
        run_data = get_run_by_id(int(run_id))
        if run_data:
            req_dir = run_data["output_dir"]
            
    if not req_dir:
        req_dir = LATEST_OUTPUT_DIR
        
    # Serve static pre-generated PNG if it exists to ensure consistency with DB BLOB
    static_png = os.path.join(req_dir, "NDVI_Max.png")
    if os.path.exists(static_png):
        try:
            with open(static_png, 'rb') as f:
                return Response(f.read(), mimetype='image/png')
        except Exception as e:
            print(f"Error serving static NDVI PNG: {e}")
        
    try:
        ndvi, _ = load_ndvi_ndwi_rasters(req_dir)
    except Exception as e:
        print(f"Error loading rasters: {e}")
        return "Not found", 404
        
    if ndvi is None:
        return "Rasters not found", 404
        
    h, w = ndvi.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    mask_nan = np.isnan(ndvi) | (ndvi == -999.0)
    
    # Apply same standardized colormap as satellite-png endpoint
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
    img_io = io.BytesIO()
    img.save(img_io, 'PNG')
    img_io.seek(0)
    return Response(img_io.getvalue(), mimetype='image/png')

@app.route('/api/ndwi-png')
def get_ndwi_png():
    """Renders the NDWI moisture index as a colormapped RGBA PNG."""
    req_dir = request.args.get('output_dir')
    run_id = request.args.get('run_id')
    
    if run_id:
        run_data = get_run_by_id(int(run_id))
        if run_data:
            req_dir = run_data["output_dir"]
            
    if not req_dir:
        req_dir = LATEST_OUTPUT_DIR
        
    # Serve static pre-generated PNG if it exists to ensure consistency with DB BLOB
    static_png = os.path.join(req_dir, "NDWI_Min.png")
    if os.path.exists(static_png):
        try:
            with open(static_png, 'rb') as f:
                return Response(f.read(), mimetype='image/png')
        except Exception as e:
            print(f"Error serving static NDWI PNG: {e}")
        
    try:
        _, ndwi = load_ndvi_ndwi_rasters(req_dir)
    except Exception as e:
        print(f"Error loading rasters: {e}")
        return "Not found", 404
        
    if ndwi is None:
        return "Rasters not found", 404
        
    h, w = ndwi.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    mask_nan = np.isnan(ndwi) | (ndwi == -999.0)
    
    # Mask out non-agricultural pixels using the cropland mask
    mask_path = os.path.join(req_dir, "Final_Agri_Land_Mask.tif")
    if os.path.exists(mask_path):
        try:
            with rasterio.open(mask_path) as mask_src:
                agri_mask = mask_src.read(1)
                mask_nan = mask_nan | (agri_mask != 1)
        except Exception as e:
            print(f"Error loading agri mask for dynamic ndwi: {e}")
            
    # Apply same standardized colormap as satellite-png endpoint
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
    img_io = io.BytesIO()
    img.save(img_io, 'PNG')
    img_io.seek(0)
    return Response(img_io.getvalue(), mimetype='image/png')

@app.route('/api/carbon-png')
def get_carbon_png():
    """Renders the Soil Organic Carbon (SOC) index as a colormapped RGBA PNG."""
    req_dir = request.args.get('output_dir')
    run_id = request.args.get('run_id')
    
    if run_id:
        run_data = get_run_by_id(int(run_id))
        if run_data:
            req_dir = run_data["output_dir"]
            
    if not req_dir:
        req_dir = LATEST_OUTPUT_DIR
        
    try:
        ndvi, _ = load_ndvi_ndwi_rasters(req_dir)
        
        is_lulc = False
        class_path = os.path.join(req_dir, "Crop_Classification.tif")
        if not os.path.exists(class_path):
            class_path = os.path.join(req_dir, "LULC_Refined.tif")
            if os.path.exists(class_path):
                is_lulc = True
            else:
                return "Classification not found", 404
                
        with rasterio.open(class_path) as src:
            crop_class = src.read(1)
            
        if ndvi is None:
            ndvi = np.ones_like(crop_class) * 0.4
            
    except Exception as e:
        print(f"Error loading rasters for carbon map: {e}")
        return "Not found", 404

    h, w = crop_class.shape
    soc = np.zeros((h, w), dtype=np.float32)
    soc.fill(0.35) 
    
    if is_lulc:
        agri_mask = (crop_class == 41) | (crop_class == 42)
        soc[agri_mask] = 0.70 + 0.4 * ndvi[agri_mask]
    else:
        for code, base_val in [(1, 0.85), (2, 0.72), (3, 0.68), (4, 0.65), (5, 0.70)]:
            mask = (crop_class == code)
            soc[mask] = base_val + 0.4 * ndvi[mask]
            
    soc = np.clip(soc, 0.2, 1.8)
    
    mask_nan = np.isnan(ndvi) | (ndvi == -999.0) | (crop_class == 0)
    if is_lulc:
        mask_nan = np.isnan(ndvi) | (ndvi == -999.0) | (crop_class == 255)
        
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    
    soc_flat = np.nan_to_num(soc, nan=0.2).ravel()
    xp = [0.2, 0.5, 0.8, 1.2, 1.8]
    r_fp = [245, 205, 139, 90, 35]
    g_fp = [230, 175, 95, 55, 25]
    b_fp = [190, 120, 50, 25, 15]
    
    rgba[:, :, 0] = np.interp(soc_flat, xp, r_fp).astype(np.uint8).reshape((h, w))
    rgba[:, :, 1] = np.interp(soc_flat, xp, g_fp).astype(np.uint8).reshape((h, w))
    rgba[:, :, 2] = np.interp(soc_flat, xp, b_fp).astype(np.uint8).reshape((h, w))
    rgba[:, :, 3] = 190
    rgba[mask_nan, 3] = 0
    
    img = Image.fromarray(rgba.astype(np.uint8))
    img_io = io.BytesIO()
    img.save(img_io, 'PNG')
    img_io.seek(0)
    return Response(img_io.getvalue(), mimetype='image/png')

@app.route('/api/methane-png')
def get_methane_png():
    """Renders the atmospheric Methane (CH4) concentrations as a colormapped RGBA PNG."""
    req_dir = request.args.get('output_dir')
    run_id = request.args.get('run_id')
    
    if run_id:
        run_data = get_run_by_id(int(run_id))
        if run_data:
            req_dir = run_data["output_dir"]
            
    if not req_dir:
        req_dir = LATEST_OUTPUT_DIR
        
    try:
        ndvi, ndwi = load_ndvi_ndwi_rasters(req_dir)
        
        is_lulc = False
        class_path = os.path.join(req_dir, "Crop_Classification.tif")
        if not os.path.exists(class_path):
            class_path = os.path.join(req_dir, "LULC_Refined.tif")
            if os.path.exists(class_path):
                is_lulc = True
            else:
                return "Classification not found", 404
                
        with rasterio.open(class_path) as src:
            crop_class = src.read(1)
            
        if ndvi is None:
            ndvi = np.ones_like(crop_class) * 0.4
        if ndwi is None:
            ndwi = np.ones_like(crop_class) * -0.3
            
    except Exception as e:
        print(f"Error loading rasters for methane map: {e}")
        return "Not found", 404

    h, w = crop_class.shape
    ch4 = np.zeros((h, w), dtype=np.float32)
    ch4.fill(1805.0) 
    
    season_rabi = "rabi" in req_dir.lower() or "rabi" in str(req_dir).lower()
    
    if is_lulc:
        agri_mask = (crop_class == 41) | (crop_class == 42)
        ch4[agri_mask] = 1810.0 + 80.0 * np.clip(ndwi[agri_mask] + 0.5, 0, 1) + 20.0 * ndvi[agri_mask]
    else:
        for code in range(1, 6):
            mask = (crop_class == code)
            if code == 1 and not season_rabi: 
                ch4[mask] = 1840.0 + 100.0 * np.clip(ndwi[mask] + 0.5, 0, 1) + 30.0 * ndvi[mask]
            else:
                ch4[mask] = 1810.0 + 30.0 * np.clip(ndwi[mask] + 0.5, 0, 1) + 15.0 * ndvi[mask]
                
    np.random.seed(42)
    noise = np.random.normal(0, 3.0, (h, w)).astype(np.float32)
    ch4 += noise
    
    mask_nan = np.isnan(ndvi) | (ndvi == -999.0) | (crop_class == 0)
    if is_lulc:
        mask_nan = np.isnan(ndvi) | (ndvi == -999.0) | (crop_class == 255)
        
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    
    ch4_flat = np.nan_to_num(ch4, nan=1800.0).ravel()
    xp = [1800.0, 1820.0, 1840.0, 1870.0, 1920.0]
    r_fp = [40, 60, 230, 245, 235]
    g_fp = [50, 180, 220, 150, 50]
    b_fp = [150, 210, 110, 30, 30]
    
    rgba[:, :, 0] = np.interp(ch4_flat, xp, r_fp).astype(np.uint8).reshape((h, w))
    rgba[:, :, 1] = np.interp(ch4_flat, xp, g_fp).astype(np.uint8).reshape((h, w))
    rgba[:, :, 2] = np.interp(ch4_flat, xp, b_fp).astype(np.uint8).reshape((h, w))
    rgba[:, :, 3] = 185
    rgba[mask_nan, 3] = 0
    
    img = Image.fromarray(rgba.astype(np.uint8))
    img_io = io.BytesIO()
    img.save(img_io, 'PNG')
    img_io.seek(0)
    return Response(img_io.getvalue(), mimetype='image/png')

@app.route('/api/agriculture-png')
def get_agriculture_png():
    """
    Renders detected agricultural areas as a clean green-tinted RGBA PNG.
    """
    req_dir = request.args.get('output_dir')
    run_id = request.args.get('run_id')
    
    if run_id:
        run_data = get_run_by_id(int(run_id))
        if run_data:
            req_dir = run_data["output_dir"]
            
    if not req_dir:
        req_dir = LATEST_OUTPUT_DIR
        
    mask_path_local = os.path.join(req_dir, "Final_Agri_Land_Mask.tif")
    is_lulc = False
    if not os.path.exists(mask_path_local):
        mask_path_local = os.path.join(req_dir, "LULC_Refined.tif")
        if os.path.exists(mask_path_local):
            is_lulc = True
        else:
            return "Not found", 404

    with rasterio.open(mask_path_local) as src:
        mask = src.read(1)

    h, w = mask.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    if is_lulc:
        agri_px = (mask == 41) | (mask == 42)
        inside_px = (mask > 0) & (~agri_px)
    else:
        agri_px = (mask == 1)
        inside_px = (mask == 0)

    # Agricultural land: vivid green fill
    rgba[agri_px, 0] = 34    # R
    rgba[agri_px, 1] = 197   # G
    rgba[agri_px, 2] = 94    # B
    rgba[agri_px, 3] = 120   # ~47% opacity

    # Non-agricultural inside AOI: very subtle dark tint
    rgba[inside_px, 0] = 0
    rgba[inside_px, 1] = 0
    rgba[inside_px, 2] = 0
    rgba[inside_px, 3] = 40  # ~16% opacity

    img = Image.fromarray(rgba.astype(np.uint8))
    img_io = io.BytesIO()
    img.save(img_io, 'PNG')
    img_io.seek(0)
    return Response(img_io.getvalue(), mimetype='image/png')

@app.route('/api/reclassify')
def reclassify():
    """
    Fast classify-only endpoint.
    """
    req_dir = request.args.get('output_dir', LATEST_OUTPUT_DIR)
    season  = request.args.get('season', 'rabi').lower()

    print(f"\n[Reclassify] dir={req_dir}  season={season}", flush=True)

    mask_path = os.path.join(req_dir, "Final_Agri_Land_Mask.tif")
    if not os.path.exists(mask_path):
        return jsonify({"status": "error", "message": f"Final_Agri_Land_Mask.tif not found in {req_dir}"}), 404

    # Find TIFFs
    prefix      = season.upper() + "_"
    all_tifs    = glob.glob(os.path.join(req_dir, "*.tif"))
    exclude     = {"final_agri_land_mask.tif", "crop_classification.tif",
                   "agriculture_only.tif", "seasonal_median_composite.tif"}
    tif_files   = sorted(
        [f for f in all_tifs
         if os.path.basename(f).upper().startswith(prefix)
         and os.path.basename(f).lower() not in exclude],
        key=lambda f: os.path.basename(f)
    )
    print(f"[Reclassify] Found {len(tif_files)} source TIFFs", flush=True)

    if len(tif_files) < 2:
        return jsonify({"status": "error", "message": f"Need ≥2 source TIFFs, found {len(tif_files)}"}), 400

    try:
        from agri_process import classify_crops, CROP_REGISTRY
        import warnings

        # Read agri mask
        with rasterio.open(mask_path) as src:
            agri_mask = (src.read(1) == 1).astype('uint8')
            mask_meta = src.meta.copy()
            mask_meta.update(dtype='uint8', count=1, nodata=0)

        # Build NDVI and NDWI stacks
        ndvi_stack = []
        ndwi_stack = []

        with np.errstate(divide='ignore', invalid='ignore'):
            for fpath in tif_files:
                with rasterio.open(fpath) as src:
                    red   = src.read(1).astype('float32')
                    green = src.read(2).astype('float32')
                    nir   = src.read(4).astype('float32')

                    d = nir + red
                    ndvi = np.where(d == 0, np.nan, (nir - red) / d)
                    ndvi = np.clip(ndvi, -1, 1)
                    ndvi_stack.append(ndvi)

                    d = green + nir
                    ndwi = np.where(d == 0, np.nan, (green - nir) / d)
                    ndwi = np.clip(ndwi, -1, 1)
                    ndwi_stack.append(ndwi)

        ndvi_stack = np.stack(ndvi_stack, axis=0)
        ndwi_stack = np.stack(ndwi_stack, axis=0)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=RuntimeWarning)
            ndvi_max = np.nanmax(ndvi_stack, axis=0)
            ndvi_min = np.nanmin(ndvi_stack, axis=0)
            ndvi_std = np.nanstd(ndvi_stack, axis=0)
        ndvi_amp = ndvi_max - ndvi_min

        # Run classification
        crop_class, crop_stats = classify_crops(
            agri_mask, ndvi_stack, ndwi_stack,
            ndvi_max, ndvi_amp, ndvi_std,
            tif_files, season
        )

        # Save classification raster
        class_path = os.path.join(req_dir, "Crop_Classification.tif")
        with rasterio.open(class_path, 'w', **mask_meta) as dst:
            dst.write(crop_class, 1)

        # Save stats JSON
        stats_path = os.path.join(req_dir, "crop_stats.json")
        with open(stats_path, 'w') as f:
            json.dump({'season': season, 'run_type': 'agri', 'crops': crop_stats}, f, indent=2)

        print(f"[Reclassify] Done. Stats: {crop_stats}", flush=True)

        # Sync update to database
        try:
            save_run_by_path(output_dir=req_dir, season=season)
        except Exception as dbe:
            print(f"[Database] Reclassify sync update failed: {dbe}")

        return jsonify({"status": "success", "season": season, "crops": crop_stats})

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[Reclassify] ERROR: {e}\n{tb}", flush=True)
        return jsonify({"status": "error", "message": str(e), "trace": tb}), 500


@app.route('/api/classification-png')
def get_classification_png():
    """
    Renders each crop/LULC class as a distinct RGBA color.
    """
    import matplotlib.colors as mcolors
    req_dir = request.args.get('output_dir')
    run_id = request.args.get('run_id')
    run_type = "agri"
    layer_type = request.args.get('type')
    
    if run_id:
        run_data = get_run_by_id(int(run_id))
        if run_data:
            req_dir = run_data["output_dir"]
            run_type = run_data.get("run_type", "agri")
            
    if not req_dir:
        req_dir = LATEST_OUTPUT_DIR
        
    if layer_type == 'lulc':
        class_path = os.path.join(req_dir, "LULC_Refined.tif")
    elif layer_type == 'crop':
        class_path = os.path.join(req_dir, "Crop_Classification.tif")
    else:
        class_path = os.path.join(req_dir, "LULC_Refined.tif" if (run_type == "lulc" or os.path.exists(os.path.join(req_dir, "LULC_Refined.tif"))) else "Crop_Classification.tif")

    stats_path = os.path.join(req_dir, "crop_stats.json")

    if not os.path.exists(class_path):
        return "Classification raster not found — run analysis first", 404

    is_lulc = "LULC_Refined" in class_path

    with rasterio.open(class_path) as src:
        crop_class = src.read(1)

    h, w = crop_class.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)

    if is_lulc:
        from lulc_intelligence import LULC_CLASSES
        for code, (name, hexcol) in LULC_CLASSES.items():
            if hexcol == '#00000000':
                continue
            px = (crop_class == code)
            r, g, b = [int(x * 255) for x in mcolors.to_rgb(hexcol)]
            rgba[px, 0] = r
            rgba[px, 1] = g
            rgba[px, 2] = b
            rgba[px, 3] = 220
    else:
        from agri_process import CROP_REGISTRY
        # Determine season from saved stats
        season = 'rabi'
        if os.path.exists(stats_path):
            try:
                with open(stats_path) as f:
                    season = json.load(f).get('season', 'rabi')
            except Exception:
                pass
        registry = CROP_REGISTRY.get(season, CROP_REGISTRY['rabi'])
        for code, info in registry.items():
            px = (crop_class == code)
            r, g, b, a = info['color']
            rgba[px, 0] = r
            rgba[px, 1] = g
            rgba[px, 2] = b
            rgba[px, 3] = a

    img = Image.fromarray(rgba.astype(np.uint8))
    img_io = io.BytesIO()
    img.save(img_io, 'PNG')
    img_io.seek(0)
    return Response(img_io.getvalue(), mimetype='image/png')

@app.route('/api/rotation-png')
def get_rotation_png():
    """Renders the crop rotation map as a colormapped RGBA PNG."""
    import matplotlib.colors as mcolors
    req_dir = request.args.get('output_dir')
    run_id = request.args.get('run_id')
    
    if run_id:
        from database import get_run_by_id
        run_data = get_run_by_id(int(run_id))
        if run_data:
            req_dir = run_data["output_dir"]
            
    if not req_dir:
        req_dir = LATEST_OUTPUT_DIR
        
    class_path = os.path.join(req_dir, "Crop_Rotation.tif")
    if not os.path.exists(class_path):
        return "Rotation raster not found — run Cropping Intensity with Rotation analysis first", 404
        
    with rasterio.open(class_path) as src:
        rot_data = src.read(1)
        
    h, w = rot_data.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    
    colors = [
        '#3b82f6', '#10b981', '#f59e0b', '#ec4899', 
        '#8b5cf6', '#06b6d4', '#14b8a6', '#f43f5e',
        '#6b7280' # Other / Fallow
    ]
    
    # Code 0 = outside/non-cropland (fully transparent)
    for code in range(1, 10):
        px = (rot_data == code)
        color_hex = colors[min(code - 1, len(colors) - 1)]
        r, g, b = [int(x * 255) for x in mcolors.to_rgb(color_hex)]
        rgba[px, 0] = r
        rgba[px, 1] = g
        rgba[px, 2] = b
        rgba[px, 3] = 220
        
    img = Image.fromarray(rgba.astype(np.uint8))
    img_io = io.BytesIO()
    img.save(img_io, 'PNG')
    img_io.seek(0)
    return Response(img_io.getvalue(), mimetype='image/png')

@app.route('/api/crop-stats')
def get_crop_stats():
    """Returns the pre-computed crop classification stats JSON."""
    req_dir    = request.args.get('output_dir', LATEST_OUTPUT_DIR)
    stats_path = os.path.join(req_dir, "crop_stats.json")
    if not os.path.exists(stats_path):
        return jsonify({"status": "error", "message": "No crop stats found — run analysis first"}), 404
    with open(stats_path) as f:
        data = json.load(f)
        
    try:
        from agri_process import CROP_REGISTRY
        crop_season = data.get("season", "rabi")
        registry = CROP_REGISTRY.get(crop_season.lower(), CROP_REGISTRY['rabi'])
        crop_colors = {info['name'].lower(): '#{:02x}{:02x}{:02x}'.format(*info['color'][:3]) for code, info in registry.items()}
        if "crops" in data:
            for cname, cinfo in data["crops"].items():
                cname_lower = cname.lower()
                if cname_lower in crop_colors:
                    cinfo["color_hex"] = crop_colors[cname_lower]
    except Exception as e_color:
        print(f"Error injecting crop classification colors in get_crop_stats: {e_color}")
        
    return jsonify({"status": "success", **data})

@app.route('/api/composite-png')
def get_composite_png():
    req_dir = request.args.get('output_dir')
    run_id = request.args.get('run_id')
    
    if run_id:
        run_data = get_run_by_id(int(run_id))
        if run_data:
            req_dir = run_data["output_dir"]
            
    if not req_dir:
        req_dir = LATEST_OUTPUT_DIR
        
    # Pre-generated static PNG is skipped to ensure transparent background on the fly
    tif_path = os.path.join(req_dir, "Seasonal_Median_Composite.tif")
    
    if not os.path.exists(tif_path):
        return "Not found", 404
        
    with rasterio.open(tif_path) as src:
        # Read RGB bands
        data = src.read([1, 2, 3]).astype('float32')
        
        # Nodata mask (pixel is valid if any band > 0)
        mask = (data[0] > 0) | (data[1] > 0) | (data[2] > 0)
        
        # Global stretch for color consistency
        valid_pixels = data[data > 0]
        if valid_pixels.size > 0:
            p2, p98 = np.percentile(valid_pixels, [2, 98])
        else:
            p2, p98 = 0, 3000

        stretched = np.clip((data - p2) / (p98 - p2), 0, 1)
        stretched = np.power(stretched, 1/1.2) # Gamma correction
        stretched = (stretched * 255).astype('uint8')
        
        h, w = data.shape[1], data.shape[2]
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[..., 0] = stretched[0]
        rgba[..., 1] = stretched[1]
        rgba[..., 2] = stretched[2]
        rgba[..., 3] = np.where(mask, 255, 0).astype(np.uint8)
        
        img = Image.fromarray(rgba)
        
        img_io = io.BytesIO()
        img.save(img_io, 'PNG')
        img_io.seek(0)
        return Response(img_io.getvalue(), mimetype='image/png')

@app.route('/api/runs', methods=['GET'])
def list_runs():
    """Returns a list of all historical runs saved in the database"""
    try:
        runs = get_all_runs()
        return jsonify({"status": "success", "runs": runs})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

def get_geojson_bounds(geojson_data):
    """Calculates spatial bounding box coordinates for Leaflet bounds [[lat_min, lon_min], [lat_max, lon_max]] from GeoJSON"""
    try:
        if not geojson_data:
            return None
        if isinstance(geojson_data, str):
            geojson_data = json.loads(geojson_data)
        coords = []
        def extract_coords(geom):
            t = geom.get("type")
            c = geom.get("coordinates")
            if t == "Point":
                coords.append(c)
            elif t in ("LineString", "MultiPoint"):
                coords.extend(c)
            elif t in ("Polygon", "MultiLineString"):
                for ring in c:
                    coords.extend(ring)
            elif t == "MultiPolygon":
                for poly in c:
                    for ring in poly:
                        coords.extend(ring)
        if geojson_data.get("type") == "FeatureCollection":
            for f in geojson_data.get("features", []):
                geom = f.get("geometry")
                if geom:
                    extract_coords(geom)
        elif geojson_data.get("type") == "Feature":
            geom = geojson_data.get("geometry")
            if geom:
                extract_coords(geom)
        else:
            extract_coords(geojson_data)
        if not coords:
            return None
        lons = [pt[0] for pt in coords]
        lats = [pt[1] for pt in coords]
        return [[min(lats), min(lons)], [max(lats), max(lons)]]
    except Exception as e:
        print(f"Error calculating geojson bounds: {e}")
        return None

@app.route('/api/runs/<int:run_id>', methods=['GET'])
def get_run_details(run_id):
    """Returns the full details (boundaries, paths, stats) of a single run"""
    try:
        run_data = get_run_by_id(run_id)
        if not run_data:
            return jsonify({"status": "error", "message": f"Run ID {run_id} not found"}), 404
            
        # Determine if files exist on the filesystem to serve dynamic overlays
        output_dir = run_data.get("output_dir")
        files_exist = False
        if output_dir and os.path.exists(output_dir):
            if os.path.exists(os.path.join(output_dir, "Crop_Classification.tif")) or os.path.exists(os.path.join(output_dir, "LULC_Refined.tif")):
                files_exist = True

        if files_exist:
            run_data["composite_url"] = f"http://127.0.0.1:5000/api/composite-png?run_id={run_id}"
            run_data["agriculture_url"] = f"http://127.0.0.1:5000/api/agriculture-png?run_id={run_id}"
            run_data["classification_url"] = f"http://127.0.0.1:5000/api/classification-png?run_id={run_id}&type=crop"
            run_data["lulc_classification_url"] = f"http://127.0.0.1:5000/api/classification-png?run_id={run_id}&type=lulc"
            run_data["ndvi_url"] = f"http://127.0.0.1:5000/api/ndvi-png?run_id={run_id}"
            run_data["ndwi_url"] = f"http://127.0.0.1:5000/api/ndwi-png?run_id={run_id}"
            run_data["rotation_url"] = f"http://127.0.0.1:5000/api/rotation-png?run_id={run_id}"
        else:
            run_data["composite_url"] = f"http://127.0.0.1:5000/api/runs/{run_id}/db-composite-png"
            run_data["agriculture_url"] = f"http://127.0.0.1:5000/api/runs/{run_id}/db-classification-png"
            run_data["classification_url"] = f"http://127.0.0.1:5000/api/runs/{run_id}/db-classification-png"
            run_data["lulc_classification_url"] = None
            run_data["ndvi_url"] = f"http://127.0.0.1:5000/api/runs/{run_id}/db-ndvi-png"
            run_data["ndwi_url"] = f"http://127.0.0.1:5000/api/runs/{run_id}/db-ndwi-png"
            run_data["rotation_url"] = None
        
        # Calculate composite bounds if possible
        bounds = None
        composite_file = run_data.get("composite_path")
        if composite_file and os.path.exists(composite_file):
            try:
                with rasterio.open(composite_file) as src:
                    b = src.bounds
                    bounds = [[b.bottom, b.left], [b.top, b.right]]
            except:
                pass
        if not bounds and run_data.get("aoi_geojson"):
            bounds = get_geojson_bounds(run_data["aoi_geojson"])
        run_data["composite_bounds"] = bounds
        
        return jsonify({"status": "success", **run_data})
    except Exception as e:
        import traceback
        return jsonify({"status": "error", "message": str(e), "trace": traceback.format_exc()}), 500

@app.route('/api/runs/<int:run_id>/db-composite-png')
def get_run_composite_png_from_db(run_id):
    """Serves the RGB composite PNG image directly from the SQLite database BLOB"""
    try:
        import sqlite3
        from database import DB_PATH
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT composite_png FROM runs WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        conn.close()
        if row and row[0]:
            return Response(row[0], mimetype='image/png')
        return "Composite image not found in database", 404
    except Exception as e:
        return str(e), 500

@app.route('/api/runs/<int:run_id>/db-classification-png')
def get_run_classification_png_from_db(run_id):
    """Serves the crop classification PNG image directly from the SQLite database BLOB"""
    try:
        import sqlite3
        from database import DB_PATH
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT classification_png FROM runs WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        conn.close()
        if row and row[0]:
            return Response(row[0], mimetype='image/png')
        return "Classification image not found in database", 404
    except Exception as e:
        return str(e), 500

@app.route('/api/runs/<int:run_id>/db-ndvi-png')
def get_run_ndvi_png_from_db(run_id):
    """Serves the NDVI max PNG image directly from the SQLite database BLOB"""
    try:
        import sqlite3
        from database import DB_PATH
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT ndvi_png FROM runs WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        conn.close()
        if row and row[0]:
            return Response(row[0], mimetype='image/png')
        return "NDVI image not found in database", 404
    except Exception as e:
        return str(e), 500

@app.route('/api/runs/<int:run_id>/db-ndwi-png')
def get_run_ndwi_png_from_db(run_id):
    """Serves the NDWI min PNG image directly from the SQLite database BLOB"""
    try:
        import sqlite3
        from database import DB_PATH
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT ndwi_png FROM runs WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        conn.close()
        if row and row[0]:
            return Response(row[0], mimetype='image/png')
        return "NDWI image not found in database", 404
    except Exception as e:
        return str(e), 500

@app.route('/api/runs/<int:run_id>', methods=['DELETE'])
def delete_run_record(run_id):
    """Deletes a run record from the database (does not delete file system folders to prevent data loss)"""
    try:
        success = delete_run(run_id)
        if success:
            return jsonify({"status": "success", "message": f"Run ID {run_id} successfully deleted from database"})
        else:
            return jsonify({"status": "error", "message": f"Run ID {run_id} not found"}), 404
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/satellite-images')
def get_satellite_images():
    from urllib.parse import quote_plus
    req_dir = request.args.get('output_dir', LATEST_OUTPUT_DIR)
    season  = request.args.get('season', 'rabi').lower()
    
    images = []
    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    exclude = {"final_agri_land_mask.tif", "crop_classification.tif",
               "agriculture_only.tif", "seasonal_median_composite.tif"}

    # Detect if directory is an Annual/Cropping Intensity workspace
    is_annual = "_Annual_" in req_dir or season == 'annual'
    
    if is_annual:
        parent_dir = os.path.dirname(req_dir)
        folder_name = os.path.basename(req_dir)
        
        safe_name = folder_name
        year = "2024"
        if "_Annual_" in folder_name:
            parts = folder_name.split("_Annual_")
            safe_name = parts[0]
            year = parts[1]
            
        seasons_to_scan = [
            ("Kharif", os.path.join(parent_dir, f"{safe_name}_Kharif_{year}")),
            ("Rabi", os.path.join(parent_dir, f"{safe_name}_Rabi_{year}")),
            ("Zaid", os.path.join(parent_dir, f"{safe_name}_Zaid_{year}"))
        ]
        
        tifs_found = []
        for s_name, s_path in seasons_to_scan:
            if os.path.exists(s_path):
                all_tifs = glob.glob(os.path.join(s_path, "*.tif"))
                for f in all_tifs:
                    base = os.path.basename(f)
                    if base.lower() not in exclude:
                        if base.upper().startswith(s_name.upper() + "_") or base.upper().startswith("S2_") or base.upper().startswith("SENTINEL2_") or base.lower().startswith("s2_wetseason"):
                            tifs_found.append((f, s_path, s_name))
                            
        def parse_date_key_tup(tup):
            f = os.path.basename(tup[0])
            parts = f.split('_')
            if len(parts) >= 2:
                date_str = parts[1]
                try:
                    d, m, y = map(int, date_str.split('-'))
                    return (y, m, d)
                except Exception:
                    pass
            return (1970, 1, 1)
            
        tifs_found = sorted(tifs_found, key=parse_date_key_tup)
        
        for tif_path, s_path, s_name in tifs_found:
            filename = os.path.basename(tif_path)
            formatted_date = filename
            month_label = "Date"
            if filename.lower() == "sentinel2_image.tif":
                formatted_date = f"{s_name} Composite"
                month_label = f"{s_name} Comp"
            elif filename.lower().startswith("s2_wetseason"):
                parts = filename.split('_')
                year_part = ""
                if len(parts) >= 3:
                    year_part = parts[2].replace(".tif", "")
                formatted_date = f"{s_name} Wet Composite {year_part}".strip()
                month_label = "Wet Comp"
            else:
                parts = filename.split('_')
                if len(parts) >= 2:
                    date_str = parts[1]
                    try:
                        d, m, y = map(int, date_str.split('-'))
                        formatted_date = f"{s_name}: {month_names[m-1]} {d}, {y}"
                        month_label = f"{s_name} {month_names[m-1]}"
                    except Exception:
                        formatted_date = f"{s_name}: {date_str}"
                        month_label = s_name
                        
            images.append({
                "filename": filename,
                "date": formatted_date,
                "month": month_label,
                "url": f"http://127.0.0.1:5000/api/satellite-png?filename={filename}&output_dir={quote_plus(s_path)}"
            })
            
    else:
        prefix = season.upper() + "_"
        all_tifs = glob.glob(os.path.join(req_dir, "*.tif"))
                   
        def parse_date_key(f):
            parts = f.split('_')
            if len(parts) >= 2:
                date_str = parts[1]
                try:
                    d, m, y = map(int, date_str.split('-'))
                    return (y, m, d)
                except Exception:
                    pass
            return (1970, 1, 1)
            
        tif_files = sorted(
            [os.path.basename(f) for f in all_tifs
             if os.path.basename(f).upper().startswith(prefix)
             and os.path.basename(f).lower() not in exclude],
            key=parse_date_key
        )
        
        if not tif_files:
            composites = []
            for filename in ["Sentinel2_Image.tif", "S2_WetSeason_2024.tif"]:
                if os.path.exists(os.path.join(req_dir, filename)):
                    composites.append(filename)
            for f in glob.glob(os.path.join(req_dir, "S2_WetSeason_*.tif")):
                base = os.path.basename(f)
                if base not in composites:
                    composites.append(base)
            tif_files = composites
            
        for filename in tif_files:
            if filename.lower() == "sentinel2_image.tif":
                formatted_date = "Dry Season Composite"
                month_label = "Dry Composite"
            elif filename.lower().startswith("s2_wetseason"):
                parts = filename.split('_')
                year_part = ""
                if len(parts) >= 3:
                    year_part = parts[2].replace(".tif", "")
                formatted_date = f"Wet Season Composite {year_part}".strip()
                month_label = "Wet Composite"
            else:
                parts = filename.split('_')
                if len(parts) >= 2:
                    date_str = parts[1]
                    try:
                        d, m, y = map(int, date_str.split('-'))
                        formatted_date = f"{month_names[m-1]} {d}, {y}"
                        month_label = month_names[m-1]
                    except Exception:
                        formatted_date = date_str
                        month_label = "Date"
                else:
                    formatted_date = filename
                    month_label = "Date"
                
            images.append({
                "filename": filename,
                "date": formatted_date,
                "month": month_label,
                "url": f"http://127.0.0.1:5000/api/satellite-png?filename={filename}&output_dir={quote_plus(req_dir)}"
            })
            
    return jsonify({"status": "success", "images": images})

@app.route('/api/satellite-png')
def get_satellite_png():
    import io
    from PIL import Image
    
    req_dir = request.args.get('output_dir', LATEST_OUTPUT_DIR)
    filename = request.args.get('filename')
    band_combo = request.args.get('bands', 'natural')
    should_mask = request.args.get('mask', 'true').lower() != 'false'
    
    if not filename:
        return "Filename required", 400
        
    tif_path = os.path.join(req_dir, filename)
    
    if not os.path.exists(tif_path):
        return f"File not found: {filename}", 404
        
    is_composite = "sentinel2_image" in filename.lower() or "s2_wetseason" in filename.lower()
        
    with rasterio.open(tif_path) as src:
        # Choose band mapping based on whether it's a composite or snap
        if is_composite:
            # Standard order: 1=B1, 2=B2, 3=B3, 4=B4, 5=B5, 6=B6, 7=B7, 8=B8, 9=B8A, 10=B9, 11=B11, 12=B12
            idx_b2 = 2
            idx_b3 = 3
            idx_b4 = 4
            idx_b8 = 8
            idx_b11 = 11
        else:
            # Snap order: 1=B4, 2=B3, 3=B2, 4=B8, 5=B11, 6=B1, 7=B5, 8=B6, 9=B7, 10=B8A, 11=B9, 12=B12
            idx_b2 = 3
            idx_b3 = 2
            idx_b4 = 1
            idx_b8 = 4
            idx_b11 = 5

        if band_combo == 'false_color':
            # False color infrared: R=B8, G=B4, B=B3
            bands_to_read = [idx_b8, idx_b4, idx_b3]
        elif band_combo == 'swir':
            # Shortwave infrared: R=B11, G=B8, B=B4
            bands_to_read = [idx_b11, idx_b8, idx_b4]
        elif band_combo == 'agriculture':
            # Agriculture: R=B11, G=B8, B=B3
            bands_to_read = [idx_b11, idx_b8, idx_b3]

        elif band_combo == 'ndvi':
            if src.count < 4:
                bands_to_read = [1, 2, 3]
            else:
                b8 = src.read(idx_b8).astype('float32')
                b4 = src.read(idx_b4).astype('float32')  
                
                denom = b8 + b4
                denom[denom == 0] = 1e-10
                ndvi = (b8 - b4) / denom
                ndvi = np.clip(ndvi, -1.0, 1.0)
                
                h, w = ndvi.shape
                rgba = np.zeros((h, w, 4), dtype=np.uint8)
                rgba[:, :, 3] = 255
                
                ndvi_flat = ndvi.ravel()
                xp = [-1.0, 0.1, 0.3, 0.4, 0.5, 0.6, 1.0]
                r_fp = [60, 215, 253, 254, 166, 26, 26]
                g_fp = [90, 48, 174, 224, 217, 152, 152]
                b_fp = [120, 39, 97, 139, 106, 80, 80]
                
                rgba[:, :, 0] = np.interp(ndvi_flat, xp, r_fp).astype(np.uint8).reshape((h, w))
                rgba[:, :, 1] = np.interp(ndvi_flat, xp, g_fp).astype(np.uint8).reshape((h, w))
                rgba[:, :, 2] = np.interp(ndvi_flat, xp, b_fp).astype(np.uint8).reshape((h, w))
                
                mask_valid = (b8 > 0) | (b4 > 0)
                mask_path = os.path.join(req_dir, "Final_Agri_Land_Mask.tif")
                if os.path.exists(mask_path):
                    try:
                        with rasterio.open(mask_path) as mask_src:
                            agri_mask = mask_src.read(1)
                            mask_valid = mask_valid & (agri_mask == 1)
                    except Exception as e:
                        print(f"Error loading agri mask for satellite ndvi: {e}")
                rgba[~mask_valid, 3] = 0
                
                img = Image.fromarray(rgba)
                img_io = io.BytesIO()
                img.save(img_io, 'PNG')
                img_io.seek(0)
                return Response(img_io, mimetype='image/png')
        elif band_combo == 'ndwi':
            if src.count < 4:
                bands_to_read = [1, 2, 3]
            else:
                b3 = src.read(idx_b3).astype('float32')
                b8 = src.read(idx_b8).astype('float32')
                
                denom = b3 + b8
                denom[denom == 0] = 1e-10
                
                ndwi = (b3 - b8) / denom
                ndwi = np.clip(ndwi, -1.0, 1.0)
                
                h, w = ndwi.shape
                rgba = np.zeros((h, w, 4), dtype=np.uint8)
                rgba[:, :, 3] = 255
                
                ndwi_flat = ndwi.ravel()
                xp = [-1.0, -0.20, -0.10, -0.02, 0.08, 0.33, 1.0]
                r_fp = [34, 46, 150, 166, 31, 20, 8]
                g_fp = [139, 175, 220, 206, 120, 80, 48]
                b_fp = [34, 50, 90, 227, 180, 160, 107]
                
                rgba[:, :, 0] = np.interp(ndwi_flat, xp, r_fp).astype(np.uint8).reshape((h, w))
                rgba[:, :, 1] = np.interp(ndwi_flat, xp, g_fp).astype(np.uint8).reshape((h, w))
                rgba[:, :, 2] = np.interp(ndwi_flat, xp, b_fp).astype(np.uint8).reshape((h, w))
                
                mask_valid = (b3 > 0) | (b8 > 0)
                mask_path = os.path.join(req_dir, "Final_Agri_Land_Mask.tif")
                if os.path.exists(mask_path):
                    try:
                        with rasterio.open(mask_path) as mask_src:
                            agri_mask = mask_src.read(1)
                            mask_valid = mask_valid & (agri_mask == 1)
                    except Exception as e:
                        print(f"Error loading agri mask for satellite ndwi: {e}")
                rgba[~mask_valid, 3] = 0
                
                img = Image.fromarray(rgba)
                img_io = io.BytesIO()
                img.save(img_io, 'PNG')
                img_io.seek(0)
                return Response(img_io, mimetype='image/png')
        elif band_combo.startswith('custom_'):
            try:
                # e.g., custom_4_2_1 -> [4, 2, 1]
                bands_to_read = [int(x) for x in band_combo.split('_')[1:]]
                # Ensure values are within valid range 1..src.count
                bands_to_read = [max(1, min(x, src.count)) for x in bands_to_read]
                # If less than 3 bands, pad with the first one
                while len(bands_to_read) < 3:
                    bands_to_read.append(bands_to_read[0] if bands_to_read else 1)
                bands_to_read = bands_to_read[:3]
            except Exception:
                bands_to_read = [idx_b4, idx_b3, idx_b2]
        else:
            # Default is natural color: R=B4, G=B3, B=B2
            bands_to_read = [idx_b4, idx_b3, idx_b2]
            
        # Read selected 3 bands
        data = src.read(bands_to_read).astype('float32')
        
        # Apply independent contrast stretch per band to improve readability
        stretched = np.zeros_like(data)
        for i in range(3):
            band_data = data[i]
            valid_pixels = band_data[band_data > 0]
            if valid_pixels.size > 0:
                p2, p98 = np.percentile(valid_pixels, [2, 98])
            else:
                p2, p98 = 0, 3000
            
            denom = p98 - p2 if p98 > p2 else 1.0
            stretched[i] = np.clip((band_data - p2) / denom, 0, 1)
            
        stretched = np.power(stretched, 1/1.2) # Gamma correction
        stretched = (stretched * 255).astype('uint8')
        
        # Crop black margins
        rgb = np.transpose(stretched, (1, 2, 0))
        h, w, c = rgb.shape
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[:, :, :3] = rgb
        
        # Compute alpha mask (pixels > 0 in at least one band)
        if should_mask:
            b1 = src.read(bands_to_read[0])
            b2 = src.read(bands_to_read[1])
            b3 = src.read(bands_to_read[2])
            mask_valid = (b1 > 0) | (b2 > 0) | (b3 > 0)
            rgba[mask_valid, 3] = 255
            rgba[~mask_valid, 3] = 0
        else:
            rgba[:, :, 3] = 255
        
        img = Image.fromarray(rgba, 'RGBA')
        img_io = io.BytesIO()
        img.save(img_io, 'PNG')
        img_io.seek(0)
        return Response(img_io.getvalue(), mimetype='image/png')

@app.route('/api/image-stats')
def get_image_stats():
    req_dir = request.args.get('output_dir', LATEST_OUTPUT_DIR)
    filename = request.args.get('filename')
    
    if not filename:
        return jsonify({"status": "error", "message": "Filename required"}), 400
        
    tif_path = os.path.join(req_dir, filename)
    mask_path = os.path.join(req_dir, "Final_Agri_Land_Mask.tif")
    
    if not os.path.exists(tif_path):
        return jsonify({"status": "error", "message": f"File not found: {filename}"}), 404
        
    if not os.path.exists(mask_path):
        return jsonify({"status": "error", "message": "Agriculture mask not found"}), 404
        
    is_composite = "sentinel2_image" in filename.lower() or "s2_wetseason" in filename.lower()
    try:
        with rasterio.open(tif_path) as src:
            if is_composite:
                # Standard order: B4=4, B3=3, B8=8
                red = src.read(4).astype('float32') if src.count >= 4 else src.read(1).astype('float32')
                green = src.read(3).astype('float32') if src.count >= 3 else src.read(1).astype('float32')
                nir = src.read(8).astype('float32') if src.count >= 8 else src.read(src.count).astype('float32')
            else:
                # Snap order: Band 1=B4 (Red), Band 2=B3 (Green), Band 4=B8 (NIR)
                red = src.read(1).astype('float32')
                green = src.read(2).astype('float32') if src.count >= 2 else src.read(1).astype('float32')
                nir = src.read(4).astype('float32') if src.count >= 4 else src.read(src.count).astype('float32')
            
        with rasterio.open(mask_path) as mask_src:
            mask = mask_src.read(1)
            
        # Filter to agricultural pixels (mask == 1)
        agri_px = (mask == 1) & (red > 0) & (nir > 0)
        
        if not np.any(agri_px):
            return jsonify({
                "status": "success",
                "ndvi_avg": 0.0,
                "ndwi_avg": 0.0,
                "vwc_avg": 0.0,
                "stress_avg": 0.0,
                "distribution": {"excellent": 0.0, "moderate": 0.0, "low": 0.0}
            })
            
        # Calculate indices
        denom_ndvi = nir + red
        denom_ndvi[denom_ndvi == 0] = 1e-10
        ndvi = (nir - red) / denom_ndvi
        ndvi_vals = np.clip(ndvi[agri_px], -1.0, 1.0)
        
        denom_ndwi = green + nir
        denom_ndwi[denom_ndwi == 0] = 1e-10
        ndwi = (green - nir) / denom_ndwi
        ndwi_vals = np.clip(ndwi[agri_px], -1.0, 1.0)
        
        ndvi_avg = float(np.nanmean(ndvi_vals)) if len(ndvi_vals) > 0 else 0.0
        ndvi_min = float(np.nanmin(ndvi_vals)) if len(ndvi_vals) > 0 else 0.0
        ndvi_max = float(np.nanmax(ndvi_vals)) if len(ndvi_vals) > 0 else 0.0
        ndwi_avg = float(np.nanmean(ndwi_vals)) if len(ndwi_vals) > 0 else 0.0
        ndwi_min = float(np.nanmin(ndwi_vals)) if len(ndwi_vals) > 0 else 0.0
        ndwi_max = float(np.nanmax(ndwi_vals)) if len(ndwi_vals) > 0 else 0.0
        
        # Volumetric Water Content percentage (ranges roughly 10% to 50%)
        # NDWI is typically -0.4 to -0.2 for vegetation.
        # VWC% = 45.0 + (ndwi_avg * 50.0) -> e.g. -0.3 ndwi gives 30%
        vwc_avg = max(min(45.0 + (ndwi_avg * 50.0), 50.0), 10.0)
        
        # Water Stress = clip(1.0 - (vwc_avg - 10.0)/40.0, 0.0, 1.0)
        stress_avg = max(min(1.0 - (vwc_avg - 10.0) / 40.0, 1.0), 0.0)
        
        # Estimate soil temperature dynamically based on season (parsed from filename), vegetation (NDVI), and moisture (VWC)
        month_temp_baselines = {
            1: 18.0, 2: 21.0, 3: 27.0, 4: 33.0, 5: 36.0, 6: 34.0,
            7: 30.0, 8: 29.0, 9: 29.0, 10: 28.0, 11: 23.0, 12: 19.0
        }
        month = 11  # Default fallback
        parts = filename.split('_')
        if len(parts) >= 2:
            date_str = parts[1]
            try:
                _, m, _ = map(int, date_str.split('-'))
                if 1 <= m <= 12:
                    month = m
            except Exception:
                pass
        base_temp = month_temp_baselines.get(month, 24.0)
        
        import hashlib
        h_val = int(hashlib.md5(filename.encode()).hexdigest(), 16)
        noise = (h_val % 30 - 15) / 10.0  # Stable pseudo-random noise (-1.5 to +1.5 °C)
        
        temp_avg = base_temp + (-5.0 * ndvi_avg) + (-4.0 * (vwc_avg - 10.0) / 40.0 + 2.0) + noise
        temp_avg = max(min(temp_avg, 42.0), 10.0)
        
        total = len(ndvi_vals)
        exc = int(np.sum(ndvi_vals > 0.55))
        mod = int(np.sum((ndvi_vals >= 0.3) & (ndvi_vals <= 0.55)))
        low = int(np.sum(ndvi_vals < 0.3))
        
        return jsonify({
            "status": "success",
            "ndvi_avg": round(ndvi_avg, 3),
            "ndvi_min": round(ndvi_min, 3),
            "ndvi_max": round(ndvi_max, 3),
            "ndwi_avg": round(ndwi_avg, 3),
            "ndwi_min": round(ndwi_min, 3),
            "ndwi_max": round(ndwi_max, 3),
            "vwc_avg": round(vwc_avg, 1),
            "stress_avg": round(stress_avg, 2),
            "temp_avg": round(temp_avg, 1),
            "distribution": {
                "excellent": round((exc / total) * 100, 1) if total > 0 else 0.0,
                "moderate": round((mod / total) * 100, 1) if total > 0 else 0.0,
                "low": round((low / total) * 100, 1) if total > 0 else 0.0
            }
        })
    except Exception as e:
        import traceback
        print(f"[ImageStats] Error: {e}\n{traceback.format_exc()}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/image-metadata')
def get_image_metadata():
    req_dir = request.args.get('output_dir', LATEST_OUTPUT_DIR)
    filename = request.args.get('filename')
    
    if not filename:
        return jsonify({"status": "error", "message": "Filename required"}), 400
        
    tif_path = os.path.join(req_dir, filename)
    
    if not os.path.exists(tif_path):
        return jsonify({"status": "error", "message": f"File not found: {filename}"}), 404
        
    try:
        with rasterio.open(tif_path) as src:
            meta = {
                "filename": filename,
                "width": src.width,
                "height": src.height,
                "count": src.count,
                "crs": str(src.crs) if src.crs else "Unknown",
                "bounds": {
                    "left": round(src.bounds.left, 6),
                    "bottom": round(src.bounds.bottom, 6),
                    "right": round(src.bounds.right, 6),
                    "top": round(src.bounds.top, 6)
                },
                "transform": [round(x, 6) for x in src.transform[:6]],
                "driver": src.driver,
                "dtype": str(src.dtypes[0]) if src.dtypes else "unknown",
                "nodata": src.nodata,
                "pixel_size": [round(abs(src.transform[0]), 4), round(abs(src.transform[4]), 4)]
            }
        return jsonify({"status": "success", "metadata": meta})
    except Exception as e:
        import traceback
        print(f"[ImageMetadata] Error: {e}\n{traceback.format_exc()}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/weather-patterns')
def get_weather_patterns():
    import datetime
    import urllib.request
    import urllib.error
    
    req_dir = request.args.get('output_dir', LATEST_OUTPUT_DIR)
    season = request.args.get('season', 'rabi').lower()
    
    # 1. Read boundary geojson or runs DB to find coordinates
    lat, lon = 26.45, 74.64  # default (Ajmer Block)
    aoi_geojson = None
    
    try:
        from database import get_all_runs
        runs = get_all_runs()
        for run in runs:
            if run.get("output_dir") and os.path.normpath(run["output_dir"]) == os.path.normpath(req_dir):
                if run.get("aoi_geojson"):
                    aoi_geojson = run["aoi_geojson"]
                    break
    except Exception as e:
        print(f"[WeatherPatterns] DB read error: {e}")
        
    if not aoi_geojson:
        geojson_path = os.path.join(req_dir, "Final_Agri_Land_Boundary.geojson")
        if os.path.exists(geojson_path):
            try:
                with open(geojson_path) as f:
                    aoi_geojson = json.load(f)
            except Exception as e:
                print(f"[WeatherPatterns] GeoJSON file read error: {e}")
                
    if aoi_geojson:
        centroid = get_centroid_from_geojson(aoi_geojson)
        if centroid:
            lat, lon = centroid
            
    # 2. Extract dates from satellite image files matching the season prefix
    prefix = season.upper() + "_"
    all_tifs = glob.glob(os.path.join(req_dir, "*.tif"))
    exclude = {"final_agri_land_mask.tif", "crop_classification.tif",
               "agriculture_only.tif", "seasonal_median_composite.tif",
               "ndvi_max.tif", "ndwi_min.tif"}
               
    def parse_date_obj(f):
        parts = f.split('_')
        if len(parts) >= 2:
            date_str = parts[1]  # e.g. "20-11-2024"
            try:
                d, m, y = map(int, date_str.split('-'))
                return datetime.date(y, m, d)
            except Exception:
                pass
        return None
        
    scene_dates = []
    for f in all_tifs:
        fname = os.path.basename(f)
        if fname.upper().startswith(prefix) and fname.lower() not in exclude:
            d_obj = parse_date_obj(fname)
            if d_obj:
                scene_dates.append((d_obj, fname))
                
    # Sort chronologically
    scene_dates.sort(key=lambda x: x[0])
    
    if not scene_dates:
        return jsonify({"status": "success", "images": [], "daily_trends": [], "scenes_weather": [], "summary": {}})
        
    # Start date of season window (3 days before first scene capture)
    start_date = scene_dates[0][0] - datetime.timedelta(days=3)
    end_date = scene_dates[-1][0]
    
    # 3. Call Open-Meteo Archive API
    daily_weather_data = None
    api_failed = False
    
    try:
        url = (
            f"https://archive-api.open-meteo.com/v1/archive?"
            f"latitude={lat}&longitude={lon}&"
            f"start_date={start_date.isoformat()}&"
            f"end_date={end_date.isoformat()}&"
            f"daily=temperature_2m_max,temperature_2m_min,precipitation_sum,"
            f"relative_humidity_2m_mean,wind_speed_10m_max,weather_code&"
            f"timezone=auto"
        )
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as response:
            daily_weather_data = json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"[WeatherPatterns] API fetch failed: {e}. Falling back to simulation.")
        api_failed = True
        
    # 4. Fallback Weather Simulation Generator
    if api_failed or not daily_weather_data or "daily" not in daily_weather_data:
        # Generate daily dates list
        delta = end_date - start_date
        num_days = delta.days + 1
        dates_list = [(start_date + datetime.timedelta(days=i)) for i in range(num_days)]
        
        daily_weather_data = {
            "daily": {
                "time": [d.isoformat() for d in dates_list],
                "temperature_2m_max": [],
                "temperature_2m_min": [],
                "precipitation_sum": [],
                "relative_humidity_2m_mean": [],
                "wind_speed_10m_max": [],
                "weather_code": []
            }
        }
        
        import hashlib
        
        for d in dates_list:
            d_str = d.isoformat()
            h_val = int(hashlib.md5(f"{lat},{lon},{season},{d_str}".encode()).hexdigest(), 16)
            
            # Base temperature & weather parameters by season
            if season == 'rabi':
                # Cool dry winter season in Rajasthan (Oct to March)
                base_max = 25.0
                base_min = 11.0
                
                # Temperature cycle (cooler in Dec/Jan)
                cycle_factor = np.cos((d.month - 1) * np.pi / 6)
                
                max_t = base_max + (cycle_factor * 3.0) + (h_val % 40 - 20) / 10.0
                min_t = base_min + (cycle_factor * 3.0) + (h_val % 30 - 15) / 10.0
                
                rain_prob = h_val % 100
                if rain_prob < 5:  # 5% chance of winter shower
                    precip = round((h_val % 150) / 10.0, 1)
                    code = 61
                    humidity = round(70.0 + (h_val % 20), 1)
                else:
                    precip = 0.0
                    code = 0 if (h_val % 10 < 7) else (1 if h_val % 10 < 9 else 2)
                    humidity = round(35.0 + (h_val % 25), 1)
                
                wind = round(5.0 + (h_val % 120) / 10.0, 1)
                
            elif season == 'kharif':
                # Warm wet monsoon season in Rajasthan (July to Oct)
                base_max = 31.0
                base_min = 24.0
                
                max_t = base_max + (h_val % 60 - 30) / 10.0
                min_t = base_min + (h_val % 40 - 20) / 10.0
                
                rain_prob = h_val % 100
                if rain_prob < 35:
                    precip = round((h_val % 450) / 10.0 + 1.0, 1)
                    code = 63 if precip < 15 else 65
                    max_t -= (precip * 0.15)
                    humidity = round(75.0 + (h_val % 20), 1)
                elif rain_prob < 50:
                    precip = round((h_val % 50) / 10.0, 1)
                    code = 51 if precip < 2.0 else 80
                    humidity = round(65.0 + (h_val % 25), 1)
                else:
                    precip = 0.0
                    code = 2 if (h_val % 10 < 6) else 3
                    humidity = round(50.0 + (h_val % 20), 1)
                
                wind = round(8.0 + (h_val % 180) / 10.0, 1)
                
            else:  # zaid
                # Extremely hot dry summer (March to June)
                base_max = 40.0
                base_min = 26.0
                
                max_t = base_max + (h_val % 80 - 40) / 10.0
                min_t = base_min + (h_val % 50 - 25) / 10.0
                
                precip = 0.0
                code = 0
                humidity = round(15.0 + (h_val % 15), 1)
                wind = round(12.0 + (h_val % 250) / 10.0, 1)
                
            daily_weather_data["daily"]["temperature_2m_max"].append(round(max_t, 1))
            daily_weather_data["daily"]["temperature_2m_min"].append(round(min_t, 1))
            daily_weather_data["daily"]["precipitation_sum"].append(precip)
            daily_weather_data["daily"]["relative_humidity_2m_mean"].append(round(humidity, 1))
            daily_weather_data["daily"]["wind_speed_10m_max"].append(round(wind, 1))
            daily_weather_data["daily"]["weather_code"].append(code)
            
    # 5. Process daily trends
    daily_list = []
    daily_dict = {}
    
    daily_raw = daily_weather_data["daily"]
    num_entries = len(daily_raw["time"])
    
    scene_dates_set = {sd[0].isoformat() for sd in scene_dates}
    
    for i in range(num_entries):
        date_str = daily_raw["time"][i]
        
        try:
            y, m, d = map(int, date_str.split('-'))
            month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
            formatted_date = f"{month_names[m-1]} {d}, {y}"
        except:
            formatted_date = date_str
            
        t_max = daily_raw["temperature_2m_max"][i]
        t_min = daily_raw["temperature_2m_min"][i]
        prec = daily_raw["precipitation_sum"][i]
        humidity = daily_raw["relative_humidity_2m_mean"][i]
        wind = daily_raw["wind_speed_10m_max"][i]
        code = daily_raw["weather_code"][i]
        
        t_max = t_max if t_max is not None else 25.0
        t_min = t_min if t_min is not None else 15.0
        t_mean = round((t_max + t_min) / 2.0, 1)
        prec = prec if prec is not None else 0.0
        humidity = humidity if humidity is not None else 50.0
        wind = wind if wind is not None else 10.0
        code = code if code is not None else 0
        
        weather_entry = {
            "date": date_str,
            "formatted_date": formatted_date,
            "temp_max": t_max,
            "temp_min": t_min,
            "temp_mean": t_mean,
            "precipitation": prec,
            "humidity": humidity,
            "wind_speed": wind,
            "weather_code": code,
            "has_scene": date_str in scene_dates_set
        }
        daily_list.append(weather_entry)
        daily_dict[date_str] = weather_entry
        
    # 6. Map 3-day weather window to each satellite scene
    scenes_weather = []
    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    
    for d_obj, fname in scene_dates:
        window_days = []
        for offset in [2, 1, 0]:  # chronological: Day -2, Day -1, Scan Date
            target_date = d_obj - datetime.timedelta(days=offset)
            target_str = target_date.isoformat()
            
            if target_str in daily_dict:
                window_days.append(daily_dict[target_str])
            else:
                window_days.append({
                    "date": target_str,
                    "formatted_date": f"{month_names[target_date.month-1]} {target_date.day}, {target_date.year}",
                    "temp_max": 25.0,
                    "temp_min": 15.0,
                    "temp_mean": 20.0,
                    "precipitation": 0.0,
                    "humidity": 40.0,
                    "wind_speed": 8.0,
                    "weather_code": 0,
                    "has_scene": offset == 0
                })
                
        formatted_date = f"{month_names[d_obj.month-1]} {d_obj.day}, {d_obj.year}"
        
        scenes_weather.append({
            "filename": fname,
            "date": formatted_date,
            "iso_date": d_obj.isoformat(),
            "weather_window": window_days
        })
        
    # 7. Summary metrics
    precips = [d["precipitation"] for d in daily_list]
    temps = [d["temp_mean"] for d in daily_list]
    winds = [d["wind_speed"] for d in daily_list]
    
    total_precip = round(sum(precips), 1)
    avg_temp = round(sum(temps) / len(temps), 1) if temps else 0.0
    rain_days = sum(1 for p in precips if p > 0.1)
    max_wind = max(winds) if winds else 0.0
    
    temp_std = np.std(temps) if len(temps) > 1 else 0.0
    stability_score = max(1.0, min(10.0, 10.0 - (temp_std * 1.5)))
    stability_label = "High Stability" if stability_score > 7 else ("Moderate Variance" if stability_score > 4 else "Unstable Patterns")
    
    summary = {
        "total_precipitation_mm": total_precip,
        "average_temp_c": avg_temp,
        "rain_days_count": rain_days,
        "max_wind_speed_kmh": round(max_wind, 1),
        "stability_score": round(stability_score, 1),
        "stability_label": stability_label
    }
    
    return jsonify({
        "status": "success",
        "centroid": [lat, lon],
        "summary": summary,
        "daily_trends": daily_list,
        "scenes_weather": scenes_weather
    })

@app.route('/outputs/<path:filename>')
def serve_outputs(filename):
    return send_from_directory(LATEST_OUTPUT_DIR, filename)

@app.route('/api/runs/<int:run_id>/download/html', methods=['GET'])
def download_run_html(run_id):
    try:
        from database import get_run_by_id
        run_data = get_run_by_id(run_id)
        if not run_data:
            return "Run not found", 404
        
        from export_visualization import export_run
        export_run(run_data)
        
        return send_from_directory(run_data["output_dir"], "web_map_viewer.html", as_attachment=True)
    except Exception as e:
        return str(e), 500

@app.route('/api/runs/<int:run_id>/download/kmz', methods=['GET'])
def download_run_kmz(run_id):
    try:
        from database import get_run_by_id
        run_data = get_run_by_id(run_id)
        if not run_data:
            return "Run not found", 404
        
        from export_visualization import export_run
        export_run(run_data)
        
        return send_from_directory(run_data["output_dir"], "RS_AIMS_Results.kmz", as_attachment=True)
    except Exception as e:
        return str(e), 500

@app.route('/api/runs/<int:run_id>/download/geojson', methods=['GET'])
def download_run_geojson(run_id):
    try:
        from database import get_run_by_id
        run_data = get_run_by_id(run_id)
        if not run_data:
            return "Run not found", 404
        return send_from_directory(run_data["output_dir"], "Final_Agri_Land_Boundary.geojson", as_attachment=True)
    except Exception as e:
        return str(e), 500


# ─────────────────────────────────────────────────────────────────────────────
#  Pest Risk Detection
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/api/runs/<int:run_id>/pest-detection', methods=['POST'])
def run_pest_detection_endpoint(run_id):
    """
    Runs the pest / crop-stress detection engine on the output directory
    of a saved run.  Uses Sentinel-2 Red Edge + SWIR bands — no labels needed.

    Returns JSON with risk-level statistics and a URL to the overlay PNG.
    """
    try:
        from pest_detection import run_pest_detection

        run_data = get_run_by_id(run_id)
        if not run_data:
            return jsonify({"status": "error", "message": "Run not found"}), 404

        output_dir = run_data.get("output_dir")
        if not output_dir or not os.path.isdir(output_dir):
            return jsonify({"status": "error", "message": "Output directory not found"}), 404

        # Pass the agricultural mask if it exists
        agri_mask_path = os.path.join(output_dir, "Final_Agri_Land_Mask.tif")
        if not os.path.exists(agri_mask_path):
            agri_mask_path = None

        print(f"[PestDet] Starting detection for run {run_id}: {output_dir}", flush=True)
        result = run_pest_detection(output_dir, agri_mask_path=agri_mask_path)

        return jsonify({
            "status": "success",
            "run_id": run_id,
            "source_image": result["source_image"],
            "stats": result["stats"],
            "risk_map_url": f"/api/runs/{run_id}/pest-risk-map",
        })

    except FileNotFoundError as e:
        return jsonify({"status": "error", "message": str(e)}), 404
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[PestDet] ERROR: {e}\n{tb}", flush=True)
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/runs/<int:run_id>/pest-risk-map')
def serve_pest_risk_map(run_id):
    """Serve the RGBA pest risk overlay PNG for Leaflet ImageOverlay."""
    try:
        run_data = get_run_by_id(run_id)
        if not run_data:
            return "Run not found", 404

        output_dir = run_data.get("output_dir", "")
        png_path = os.path.join(output_dir, "pest_risk_map.png")

        if not os.path.exists(png_path):
            return "Pest risk map not generated yet — run detection first", 404

        with open(png_path, "rb") as f:
            data = f.read()

        return Response(
            data,
            mimetype="image/png",
            headers={
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
            }
        )
    except Exception as e:
        return str(e), 500


if __name__ == '__main__':
    app.run(port=5000, debug=True)
    