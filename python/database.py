import sqlite3
import os
import json
import base64

DB_PATH = os.path.join(os.path.dirname(__file__), "agri_land.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Enable foreign keys
    cursor.execute("PRAGMA foreign_keys = ON")
    
    # Create runs table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            boundary_name TEXT,
            season TEXT,
            year INTEGER,
            output_dir TEXT UNIQUE,
            mask_path TEXT,
            class_path TEXT,
            composite_path TEXT,
            boundary_path TEXT,
            composite_png_path TEXT,
            classification_png_path TEXT,
            ndvi_png_path TEXT,
            ndwi_png_path TEXT,
            composite_png BLOB,
            classification_png BLOB,
            ndvi_png BLOB,
            ndwi_png BLOB,
            aoi_geojson TEXT,
            total_area REAL,
            crop_area REAL,
            non_crop_area REAL,
            ndvi_min REAL,
            ndvi_max REAL,
            ndvi_mean REAL,
            ndwi_min REAL,
            ndwi_max REAL,
            ndwi_mean REAL,
            vwc_mean REAL,
            stress_mean REAL,
            temp_mean REAL,
            weather_data TEXT,
            run_type TEXT DEFAULT 'agri',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Run migration in case table was created previously without PNG paths/blobs
    try:
        cursor.execute("ALTER TABLE runs ADD COLUMN composite_png_path TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE runs ADD COLUMN classification_png_path TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE runs ADD COLUMN ndvi_png_path TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE runs ADD COLUMN ndwi_png_path TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE runs ADD COLUMN composite_png BLOB")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE runs ADD COLUMN classification_png BLOB")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE runs ADD COLUMN ndvi_png BLOB")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE runs ADD COLUMN ndwi_png BLOB")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE runs ADD COLUMN weather_data TEXT")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE runs ADD COLUMN run_type TEXT DEFAULT 'agri'")
    except sqlite3.OperationalError:
        pass
        
    for col in ["ndvi_min", "ndvi_max", "ndvi_mean", "ndwi_min", "ndwi_max", "ndwi_mean", "vwc_mean", "stress_mean", "temp_mean"]:
        try:
            cursor.execute(f"ALTER TABLE runs ADD COLUMN {col} REAL")
        except sqlite3.OperationalError:
            pass
    
    # Create crop_stats table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS crop_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER,
            crop_name TEXT,
            code INTEGER,
            pixels INTEGER,
            area_ha REAL,
            area_acres REAL,
            percentage REAL,
            yield_t_ha REAL,
            est_yield_tonnes REAL,
            biomass REAL,
            ndvi_peak REAL,
            growth_rate REAL,
            stress_factor REAL,
            color_hex TEXT,
            FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE
        )
    ''')
    
    conn.commit()
    conn.close()
    print("Database initialized successfully at", DB_PATH)

def save_or_update_run(boundary_name, season, year, output_dir, aoi_geojson, stats, crop_stats_data, ndvi_stats=None, ndwi_stats=None, weather_data=None, run_type="agri"):
    """
    Saves a run and its crop stats to the database. If the output_dir already exists,
    it updates the existing run and replaces its crop stats.
    """
    init_db()  # Ensure database and tables exist
    conn = get_db_connection()
    cursor = conn.cursor()
    
    aoi_str = json.dumps(aoi_geojson) if isinstance(aoi_geojson, dict) else aoi_geojson
    weather_str = json.dumps(weather_data) if isinstance(weather_data, (dict, list)) else weather_data
    
    # Parse stats values
    ndvi_min_val = ndvi_stats.get("min") if ndvi_stats else None
    ndvi_max_val = ndvi_stats.get("max") if ndvi_stats else None
    ndvi_mean_val = ndvi_stats.get("mean") if ndvi_stats else None
    
    ndwi_min_val = ndwi_stats.get("min") if ndwi_stats else None
    ndwi_max_val = ndwi_stats.get("max") if ndwi_stats else None
    ndwi_mean_val = ndwi_stats.get("mean") if ndwi_stats else None
    
    vwc_mean_val = ndwi_stats.get("vwc") if ndwi_stats else None
    stress_mean_val = ndwi_stats.get("stress") if ndwi_stats else None
    temp_mean_val = ndwi_stats.get("temp") if ndwi_stats else None
    
    if ndwi_mean_val is not None:
        if vwc_mean_val is None:
            vwc_mean_val = round(max(min(45.0 + (ndwi_mean_val * 50.0), 50.0), 10.0), 1)
        if stress_mean_val is None:
            stress_mean_val = round(max(min(1.0 - (vwc_mean_val - 10.0) / 40.0, 1.0), 0.0), 2)
    if temp_mean_val is None:
        month_temp_baselines = {
            "rabi": 22.0, "kharif": 31.0, "zaid": 35.0
        }
        base_temp = month_temp_baselines.get(season.lower(), 25.0)
        ndvi_avg = ndvi_mean_val if ndvi_mean_val is not None else 0.3
        vwc_avg = vwc_mean_val if vwc_mean_val is not None else 25.0
        temp_mean_val = round(base_temp + (-5.0 * ndvi_avg) + (-4.0 * (vwc_avg - 10.0) / 40.0 + 2.0), 1)
    
    # Compute relative/absolute paths for land extraction outputs
    mask_path = os.path.join(output_dir, "LULC_Refined.tif" if run_type == "lulc" else "Final_Agri_Land_Mask.tif")
    class_path = os.path.join(output_dir, "LULC_Refined.tif" if run_type == "lulc" else "Crop_Classification.tif")
    composite_path = os.path.join(output_dir, "Seasonal_Median_Composite.tif")
    boundary_path = os.path.join(output_dir, "Final_Agri_Land_Boundary.geojson")
    composite_png_path = os.path.join(output_dir, "Seasonal_Median_Composite.png")
    classification_png_path = os.path.join(output_dir, "LULC_Map.png" if run_type == "lulc" else "Crop_Classification.png")
    ndvi_png_path = os.path.join(output_dir, "NDVI_Max.png")
    ndwi_png_path = os.path.join(output_dir, "NDWI_Min.png")
    
    # Ensure they are normalized paths
    mask_path = os.path.normpath(mask_path)
    class_path = os.path.normpath(class_path)
    composite_path = os.path.normpath(composite_path)
    boundary_path = os.path.normpath(boundary_path)
    composite_png_path = os.path.normpath(composite_png_path)
    classification_png_path = os.path.normpath(classification_png_path)
    ndvi_png_path = os.path.normpath(ndvi_png_path)
    ndwi_png_path = os.path.normpath(ndwi_png_path)
    
    # Read binary bytes of the pre-generated PNGs to save as BLOBs
    composite_png_bytes = None
    if os.path.exists(composite_png_path):
        try:
            with open(composite_png_path, 'rb') as f:
                composite_png_bytes = f.read()
        except Exception as e:
            print(f"Error reading composite PNG file: {e}")

    classification_png_bytes = None
    if os.path.exists(classification_png_path):
        try:
            with open(classification_png_path, 'rb') as f:
                classification_png_bytes = f.read()
        except Exception as e:
            print(f"Error reading classification PNG file: {e}")

    ndvi_png_bytes = None
    if os.path.exists(ndvi_png_path):
        try:
            with open(ndvi_png_path, 'rb') as f:
                ndvi_png_bytes = f.read()
        except Exception as e:
            print(f"Error reading NDVI PNG file: {e}")

    ndwi_png_bytes = None
    if os.path.exists(ndwi_png_path):
        try:
            with open(ndwi_png_path, 'rb') as f:
                ndwi_png_bytes = f.read()
        except Exception as e:
            print(f"Error reading NDWI PNG file: {e}")
            
    try:
        # Check if run already exists
        cursor.execute("SELECT id FROM runs WHERE output_dir = ?", (output_dir,))
        row = cursor.fetchone()
        
        if row:
            run_id = row['id']
            # Fetch existing values to preserve them if not provided now
            cursor.execute("SELECT aoi_geojson, weather_data, composite_png, classification_png, ndvi_png, ndwi_png FROM runs WHERE id = ?", (run_id,))
            existing = cursor.fetchone()
            if existing:
                try:
                    if not aoi_str or aoi_str == "null" or aoi_str == "None":
                        aoi_str = existing['aoi_geojson']
                except Exception:
                    try:
                        if not aoi_str or aoi_str == "null" or aoi_str == "None":
                            aoi_str = existing[0]
                    except Exception:
                        pass
                
                try:
                    if not weather_str or weather_str == "null" or weather_str == "None":
                        weather_str = existing['weather_data']
                except Exception:
                    try:
                        if not weather_str or weather_str == "null" or weather_str == "None":
                            weather_str = existing[1]
                    except Exception:
                        pass
                
                try:
                    if not composite_png_bytes:
                        composite_png_bytes = existing['composite_png']
                except Exception:
                    try:
                        if not composite_png_bytes:
                            composite_png_bytes = existing[2]
                    except Exception:
                        pass
                
                try:
                    if not classification_png_bytes:
                        classification_png_bytes = existing['classification_png']
                except Exception:
                    try:
                        if not classification_png_bytes:
                            classification_png_bytes = existing[3]
                    except Exception:
                        pass

                try:
                    if not ndvi_png_bytes:
                        ndvi_png_bytes = existing['ndvi_png']
                except Exception:
                    try:
                        if not ndvi_png_bytes:
                            ndvi_png_bytes = existing[4]
                    except Exception:
                        pass

                try:
                    if not ndwi_png_bytes:
                        ndwi_png_bytes = existing['ndwi_png']
                except Exception:
                    try:
                        if not ndwi_png_bytes:
                            ndwi_png_bytes = existing[5]
                    except Exception:
                        pass

            # Update runs table
            cursor.execute('''
                UPDATE runs
                SET boundary_name = ?, season = ?, year = ?, aoi_geojson = ?,
                    mask_path = ?, class_path = ?, composite_path = ?, boundary_path = ?,
                    composite_png_path = ?, classification_png_path = ?, ndvi_png_path = ?, ndwi_png_path = ?,
                    composite_png = ?, classification_png = ?, ndvi_png = ?, ndwi_png = ?,
                    total_area = ?, crop_area = ?, non_crop_area = ?,
                    ndvi_min = ?, ndvi_max = ?, ndvi_mean = ?, ndwi_min = ?, ndwi_max = ?, ndwi_mean = ?,
                    vwc_mean = ?, stress_mean = ?, temp_mean = ?, weather_data = ?, run_type = ?
                WHERE id = ?
            ''', (boundary_name, season, year, aoi_str,
                  mask_path, class_path, composite_path, boundary_path,
                  composite_png_path, classification_png_path, ndvi_png_path, ndwi_png_path,
                  composite_png_bytes, classification_png_bytes, ndvi_png_bytes, ndwi_png_bytes,
                  stats.get('total_area'), stats.get('crop_area'), stats.get('non_crop_area'),
                  ndvi_min_val, ndvi_max_val, ndvi_mean_val, ndwi_min_val, ndwi_max_val, ndwi_mean_val,
                  vwc_mean_val, stress_mean_val, temp_mean_val, weather_str, run_type,
                  run_id))
            
            # Delete existing crop stats
            cursor.execute("DELETE FROM crop_stats WHERE run_id = ?", (run_id,))
        else:
            # Insert into runs table
            cursor.execute('''
                INSERT INTO runs (
                    boundary_name, season, year, output_dir, mask_path, class_path, composite_path, boundary_path,
                    composite_png_path, classification_png_path, ndvi_png_path, ndwi_png_path,
                    composite_png, classification_png, ndvi_png, ndwi_png,
                    aoi_geojson, total_area, crop_area, non_crop_area,
                    ndvi_min, ndvi_max, ndvi_mean, ndwi_min, ndwi_max, ndwi_mean,
                    vwc_mean, stress_mean, temp_mean, weather_data, run_type
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (boundary_name, season, year, output_dir, mask_path, class_path, composite_path, boundary_path,
                  composite_png_path, classification_png_path, ndvi_png_path, ndwi_png_path,
                  composite_png_bytes, classification_png_bytes, ndvi_png_bytes, ndwi_png_bytes,
                  aoi_str, stats.get('total_area'), stats.get('crop_area'), stats.get('non_crop_area'),
                  ndvi_min_val, ndvi_max_val, ndvi_mean_val, ndwi_min_val, ndwi_max_val, ndwi_mean_val,
                  vwc_mean_val, stress_mean_val, temp_mean_val, weather_str, run_type))
            run_id = cursor.lastrowid
            
        # Insert new crop stats
        if crop_stats_data and 'crops' in crop_stats_data:
            for crop_name, info in crop_stats_data['crops'].items():
                color_hex = info.get('color_hex')
                if not color_hex:
                    try:
                        from lulc_intelligence import LULC_CLASSES
                        code = info.get('code')
                        if code in LULC_CLASSES:
                            color_hex = LULC_CLASSES[code][1]
                    except Exception:
                        pass
                cursor.execute('''
                    INSERT INTO crop_stats (
                        run_id, crop_name, code, pixels, area_ha, area_acres, percentage,
                        yield_t_ha, est_yield_tonnes, biomass, ndvi_peak, growth_rate, stress_factor, color_hex
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    run_id,
                    crop_name,
                    info.get('code'),
                    info.get('pixels'),
                    info.get('area_ha'),
                    info.get('area_acres'),
                    info.get('percentage'),
                    info.get('yield_t_ha'),
                    info.get('est_yield_tonnes'),
                    info.get('biomass'),
                    info.get('ndvi_peak'),
                    info.get('growth_rate'),
                    info.get('stress_factor'),
                    color_hex
                ))

        # Also insert LULC stats if combined
        if run_type == "combined":
            lulc_stats_path = os.path.join(output_dir, "lulc_stats.json")
            if os.path.exists(lulc_stats_path):
                try:
                    with open(lulc_stats_path) as f:
                        lulc_data = json.load(f)
                        if lulc_data and 'crops' in lulc_data:
                            for crop_name, info in lulc_data['crops'].items():
                                color_hex = info.get('color_hex')
                                if not color_hex:
                                    try:
                                        from lulc_intelligence import LULC_CLASSES
                                        code = info.get('code')
                                        if code in LULC_CLASSES:
                                            color_hex = LULC_CLASSES[code][1]
                                    except Exception:
                                        pass
                                cursor.execute('''
                                    INSERT INTO crop_stats (
                                        run_id, crop_name, code, pixels, area_ha, area_acres, percentage,
                                        yield_t_ha, est_yield_tonnes, biomass, ndvi_peak, growth_rate, stress_factor, color_hex
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                ''', (
                                    run_id,
                                    crop_name,
                                    info.get('code'),
                                    info.get('pixels'),
                                    info.get('area_ha'),
                                    info.get('area_acres'),
                                    info.get('percentage'),
                                    info.get('yield_t_ha'),
                                    info.get('est_yield_tonnes'),
                                    info.get('biomass'),
                                    info.get('ndvi_peak'),
                                    info.get('growth_rate'),
                                    info.get('stress_factor'),
                                    color_hex
                                ))
                except Exception as e_lulc_db:
                    print(f"Error saving LULC stats to database: {e_lulc_db}")
        
        conn.commit()
        print(f"Run saved successfully (ID: {run_id}, Name: {boundary_name})")
        return run_id
    except Exception as e:
        conn.rollback()
        print(f"Error saving run to database: {e}")
        raise e
    finally:
        conn.close()

def get_all_runs():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM runs ORDER BY created_at DESC")
    rows = cursor.fetchall()
    
    runs = []
    for r in rows:
        cols = r.keys()
        runs.append({
            "id": r["id"],
            "boundary_name": r["boundary_name"],
            "season": r["season"],
            "year": r["year"],
            "output_dir": r["output_dir"],
            "mask_path": r["mask_path"],
            "class_path": r["class_path"],
            "composite_path": r["composite_path"],
            "boundary_path": r["boundary_path"],
            "composite_png_path": r["composite_png_path"] if "composite_png_path" in cols else None,
            "classification_png_path": r["classification_png_path"] if "classification_png_path" in cols else None,
            "ndvi_png_path": r["ndvi_png_path"] if "ndvi_png_path" in cols else None,
            "ndwi_png_path": r["ndwi_png_path"] if "ndwi_png_path" in cols else None,
            "aoi_geojson": json.loads(r["aoi_geojson"]) if r["aoi_geojson"] else None,
            "total_area": r["total_area"],
            "crop_area": r["crop_area"],
            "non_crop_area": r["non_crop_area"],
            "run_type": r["run_type"] if "run_type" in cols else "agri",
            "weather_data": json.loads(r["weather_data"]) if ("weather_data" in cols and r["weather_data"]) else None,
            "created_at": r["created_at"]
        })
    conn.close()
    return runs

def get_run_by_id(run_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM runs WHERE id = ?", (run_id,))
    r = cursor.fetchone()
    
    if not r:
        conn.close()
        return None
        
    cursor.execute("SELECT * FROM crop_stats WHERE run_id = ?", (run_id,))
    c_rows = cursor.fetchall()
    
    crops = {}
    lulc_crops = {}
    run_type_db = r["run_type"] if "run_type" in r.keys() else "agri"
    
    for c in c_rows:
        crop_data = {
            "code": c["code"],
            "pixels": c["pixels"],
            "area_ha": c["area_ha"],
            "area_acres": c["area_acres"],
            "percentage": c["percentage"],
            "yield_t_ha": c["yield_t_ha"],
            "base_yield_t_ha": c["yield_t_ha"],
            "est_yield_tonnes": c["est_yield_tonnes"],
            "biomass": c["biomass"],
            "ndvi_peak": c["ndvi_peak"],
            "growth_rate": c["growth_rate"],
            "stress_factor": c["stress_factor"],
            "color_hex": c["color_hex"]
        }
        if run_type_db == "lulc":
            crops[c["crop_name"]] = crop_data
        elif run_type_db == "combined":
            if c["code"] in [1, 2, 3, 4, 5]:
                crops[c["crop_name"]] = crop_data
            else:
                lulc_crops[c["crop_name"]] = crop_data
        else:
            crops[c["crop_name"]] = crop_data
        
    # Read the GeoJSON from boundary_path if it exists, otherwise return None
    geojson_data = None
    if r["boundary_path"] and os.path.exists(r["boundary_path"]):
        try:
            with open(r["boundary_path"], 'r') as f:
                geojson_data = json.load(f)
        except Exception as e:
            print(f"Error reading GeoJSON boundary file: {e}")
            
    cols = r.keys()
    
    comp_blob = r["composite_png"] if "composite_png" in cols else None
    class_blob = r["classification_png"] if "classification_png" in cols else None
    ndvi_blob = r["ndvi_png"] if "ndvi_png" in cols else None
    ndwi_blob = r["ndwi_png"] if "ndwi_png" in cols else None
    comp_b64 = base64.b64encode(comp_blob).decode('utf-8') if comp_blob else None
    class_b64 = base64.b64encode(class_blob).decode('utf-8') if class_blob else None
    ndvi_b64 = base64.b64encode(ndvi_blob).decode('utf-8') if ndvi_blob else None
    ndwi_b64 = base64.b64encode(ndwi_blob).decode('utf-8') if ndwi_blob else None
    
    run_data = {
        "id": r["id"],
        "boundary_name": r["boundary_name"],
        "season": r["season"],
        "year": r["year"],
        "output_dir": r["output_dir"],
        "mask_path": r["mask_path"],
        "class_path": r["class_path"],
        "composite_path": r["composite_path"],
        "boundary_path": r["boundary_path"],
        "composite_png_path": r["composite_png_path"] if "composite_png_path" in cols else None,
        "classification_png_path": r["classification_png_path"] if "classification_png_path" in cols else None,
        "ndvi_png_path": r["ndvi_png_path"] if "ndvi_png_path" in cols else None,
        "ndwi_png_path": r["ndwi_png_path"] if "ndwi_png_path" in cols else None,
        "composite_png_base64": comp_b64,
        "classification_png_base64": class_b64,
        "ndvi_png_base64": ndvi_b64,
        "ndwi_png_base64": ndwi_b64,
        "aoi_geojson": json.loads(r["aoi_geojson"]) if r["aoi_geojson"] else None,
        "geojson": geojson_data,
        "run_type": run_type_db,
        "stats": {
            "total_area": r["total_area"],
            "crop_area": r["crop_area"],
            "non_crop_area": r["non_crop_area"],
            "unit": "ha"
        },
        "ndvi_stats": {
            "min": r["ndvi_min"] if "ndvi_min" in cols and r["ndvi_min"] is not None else -0.218,
            "max": r["ndvi_max"] if "ndvi_max" in cols and r["ndvi_max"] is not None else 0.814,
            "mean": r["ndvi_mean"] if "ndvi_mean" in cols and r["ndvi_mean"] is not None else 0.329
        },
        "ndwi_stats": {
            "min": r["ndwi_min"] if "ndwi_min" in cols and r["ndwi_min"] is not None else -0.719,
            "max": r["ndwi_max"] if "ndwi_max" in cols and r["ndwi_max"] is not None else 0.385,
            "mean": r["ndwi_mean"] if "ndwi_mean" in cols and r["ndwi_mean"] is not None else -0.395,
            "vwc": r["vwc_mean"] if "vwc_mean" in cols and r["vwc_mean"] is not None else 25.0,
            "stress": r["stress_mean"] if "stress_mean" in cols and r["stress_mean"] is not None else 0.62,
            "temp": r["temp_mean"] if "temp_mean" in cols and r["temp_mean"] is not None else 26.3
        },
        "crop_stats": {
            "season": r["season"],
            "crops": crops
        },
        "lulc_stats": {
            "season": r["season"],
            "crops": lulc_crops
        } if run_type_db == "combined" else None,
        "weather_data": json.loads(r["weather_data"]) if ("weather_data" in cols and r["weather_data"]) else None,
        "created_at": r["created_at"]
    }
    conn.close()
    return run_data

def delete_run(run_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id FROM runs WHERE id = ?", (run_id,))
        row = cursor.fetchone()
        if not row:
            return False
            
        cursor.execute("DELETE FROM runs WHERE id = ?", (run_id,))
        cursor.execute("DELETE FROM crop_stats WHERE run_id = ?", (run_id,))
        conn.commit()
        return True
    except Exception as e:
        conn.rollback()
        print(f"Error deleting run {run_id}: {e}")
        raise e
    finally:
        conn.close()
