import ee
import os
import geemap
import json
import time
import calendar
from datetime import datetime, timedelta
from agri_process import run_agri_extraction

def get_best_image_for_date(aoi, target_date_str):
    """
    Finds the best Sentinel-2 image around target date with minimal cloud cover.
    Tries progressively higher cloud thresholds and wider date windows.
    Returns (image, ist_timestamp_str, thumb_url, cloud_cover, ndvi_avg) or (None, None, None, 0.0, 0.0).
    """
    target_date = datetime.strptime(target_date_str, "%Y-%m-%d")

    if target_date > datetime.now():
        return None, None, None, 0.0, 0.0

    for cloud_threshold in [15, 30, 45]:
        for delta in range(0, 15):
            for sign in [1, -1]:
                if delta == 0 and sign == -1:
                    continue

                current_date = target_date + timedelta(days=delta * sign)
                if current_date > datetime.now():
                    continue

                date_str = current_date.strftime("%Y-%m-%d")
                start_date = ee.Date(date_str)
                end_date = start_date.advance(1, 'day')

                try:
                    collection = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                                 .filterBounds(aoi)
                                 .filterDate(start_date, end_date)
                                 .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_threshold)))

                    if collection.size().getInfo() == 0:
                        continue

                    first_img = ee.Image(collection.first())
                    timestamp = first_img.get('system:time_start').getInfo()
                    dt_ist = datetime.fromtimestamp(timestamp / 1000.0) + timedelta(hours=5, minutes=30)
                    indian_time_str = dt_ist.strftime("%d-%m-%Y_%H-%M")

                    image = collection.mosaic().select(['B4', 'B3', 'B2', 'B8', 'B11', 'B1', 'B5', 'B6', 'B7', 'B8A', 'B9', 'B12'])
                    aoi_mask = ee.Image.constant(1).clip(aoi).mask()
                    image = image.updateMask(aoi_mask).clip(aoi)

                    mask = image.select(['B4', 'B3', 'B2']).gt(0).reduce(ee.Reducer.min())
                    stats = image.select(['B4', 'B3', 'B2']).updateMask(mask).reduceRegion(
                        reducer=ee.Reducer.percentile([5, 95]),
                        geometry=aoi, scale=100, bestEffort=True
                    ).getInfo()

                    low_vals  = [stats.get('B4_p5', 100), stats.get('B3_p5', 100), stats.get('B2_p5', 100)]
                    high_vals = [stats.get('B4_p95', 3000), stats.get('B3_p95', 3000), stats.get('B2_p95', 3000)]
                    avg_low, avg_high = sum(low_vals) / 3, sum(high_vals) / 3
                    if (avg_high - avg_low) < 500:
                        avg_low, avg_high = 100, 3500

                    thumb_url = image.visualize(
                        bands=['B4', 'B3', 'B2'], min=avg_low, max=avg_high, gamma=1.2
                    ).getThumbURL({'dimensions': 256, 'format': 'png'})

                    cloud_pct = first_img.get('CLOUDY_PIXEL_PERCENTAGE').getInfo()
                    if cloud_pct is None:
                        cloud_pct = 5.0
                    
                    # Calculate mean NDVI over the AOI
                    ndvi_img = image.normalizedDifference(['B8', 'B4'])
                    ndvi_mean_res = ndvi_img.reduceRegion(
                        reducer=ee.Reducer.mean(),
                        geometry=aoi,
                        scale=100,
                        bestEffort=True
                    ).getInfo()
                    ndvi_mean = ndvi_mean_res.get('nd', 0.5) if ndvi_mean_res else 0.5
                    if ndvi_mean is None:
                        ndvi_mean = 0.5

                    return image, indian_time_str, thumb_url, float(cloud_pct), float(ndvi_mean)

                except Exception as e:
                    print(f"  Error checking date {date_str}: {e}")
                    continue

    return None, None, None, 0.0, 0.0


def get_monthly_composite(aoi, year, month):
    """
    Fallback for heavily cloud-covered months (e.g. monsoon Jul–Sep).
    Stacks ALL Sentinel-2 images in the month, applies pixel-level SCL cloud
    masking, then takes the median — clouds appear in different positions on
    each pass so the median naturally rejects them.
    Returns (image, label_str, thumb_url, cloud_cover, ndvi_avg) or (None, None, None, 0.0, 0.0).
    """
    last_day = calendar.monthrange(year, month)[1]
    start_date = ee.Date(f"{year}-{month:02d}-01")
    end_date   = ee.Date(f"{year}-{month:02d}-{last_day}").advance(1, 'day')

    try:
        collection = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
                     .filterBounds(aoi)
                     .filterDate(start_date, end_date))

        count = collection.size().getInfo()
        print(f"  --> Monthly composite: {count} scenes available for {year}-{month:02d}", flush=True)
        if count == 0:
            return None, None, None, 0.0, 0.0

        # Pixel-level cloud masking using SCL (Scene Classification Layer)
        def mask_clouds_scl(image):
            scl = image.select('SCL')
            cloud_mask = (scl.neq(3)
                           .And(scl.neq(8))
                           .And(scl.neq(9))
                           .And(scl.neq(10)))
            return image.updateMask(cloud_mask)

        composite = (collection
                     .map(mask_clouds_scl)
                     .select(['B4', 'B3', 'B2', 'B8', 'B11', 'B1', 'B5', 'B6', 'B7', 'B8A', 'B9', 'B12'])
                     .median()
                     .clip(aoi))

        # Label as the 15th of the month
        label = f"15-{month:02d}-{year}_00-00"

        thumb_url = composite.visualize(
            bands=['B4', 'B3', 'B2'], min=100, max=3000, gamma=1.2
        ).getThumbURL({'dimensions': 256, 'format': 'png'})

        cloud_pct = collection.aggregate_mean('CLOUDY_PIXEL_PERCENTAGE').getInfo()
        if cloud_pct is None:
            cloud_pct = 8.0
            
        ndvi_img = composite.normalizedDifference(['B8', 'B4'])
        ndvi_mean_res = ndvi_img.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=aoi,
            scale=100,
            bestEffort=True
        ).getInfo()
        ndvi_mean = ndvi_mean_res.get('nd', 0.5) if ndvi_mean_res else 0.5
        if ndvi_mean is None:
            ndvi_mean = 0.5

        return composite, label, thumb_url, float(cloud_pct), float(ndvi_mean)

    except Exception as e:
        print(f"  Monthly composite error for {year}-{month:02d}: {e}", flush=True)
        return None, None, None, 0.0, 0.0


def flatten_coords(coords):
    """Recursively convert 3D coordinates to 2D for Earth Engine."""
    if isinstance(coords[0], (int, float)):
        return [coords[0], coords[1]]
    return [flatten_coords(c) for c in coords]


def run_satellite_download(aoi_geojson, season, season_year, output_dir, skip_extraction=False):
    """
    Main entry point for downloading satellite imagery and running AI extraction.
    Strategy:
      1. Try to find a clear single-day image near each target date (±15 days, up to 45% cloud).
      2. If no clear image found, fall back to a cloud-masked monthly median composite.
      3. Each calendar month is composited at most once to avoid duplicate files.
    Yields JSON progress updates for SSE.
    """
    start_total_time = time.time()
    processed_count  = 0
    output_dir = os.path.normpath(output_dir)

    # ── 1. Parse AOI ─────────────────────────────────────────────────────────
    try:
        if isinstance(aoi_geojson, dict):
            if aoi_geojson.get('type') == 'FeatureCollection':
                for feature in aoi_geojson.get('features', []):
                    if 'geometry' in feature and feature['geometry']:
                        feature['geometry']['coordinates'] = flatten_coords(feature['geometry']['coordinates'])
                aoi = ee.FeatureCollection(aoi_geojson).geometry()
            else:
                geom_dict = aoi_geojson.get('geometry', aoi_geojson)
                geom_dict['coordinates'] = flatten_coords(geom_dict['coordinates'])
                aoi = ee.Geometry(geom_dict)
        else:
            aoi = aoi_geojson
    except Exception as e:
        yield json.dumps({"status": "error", "message": f"Geometry Parsing Error: {str(e)}"})
        return

    os.makedirs(output_dir, exist_ok=True)

    # ── 2. Build target date list ─────────────────────────────────────────────
    season_map = {
        'rabi':   [(season_year,     m) for m in [10, 11, 12]] +
                  [(season_year + 1, m) for m in [1,  2,  3,  4]],
        'kharif': [(season_year,     m) for m in [6,  7,  8,  9, 10]],
        'zaid':   [(season_year,     m) for m in [3,  4,  5,  6]],
    }
    months      = season_map.get(season.lower(), [])
    target_days = [5, 20]

    now = datetime.now()
    active_target_dates = []
    for year, month in months:
        for day in target_days:
            try:
                dt = datetime(year, month, day)
                if dt <= now:
                    active_target_dates.append(dt.strftime("%Y-%m-%d"))
            except ValueError:
                continue

    total_expected = len(active_target_dates)
    if total_expected == 0:
        yield json.dumps({"status": "error", "message": "No historical dates found for the selected season."})
        return

    yield json.dumps({"status": "starting", "message": f"Starting {season.upper()} {season_year} Analysis"})

    print(f"\n[RS-AIMS] Starting {season.upper()} {season_year} Analysis Pipeline...")
    print(f"[RS-AIMS] Target timeline contains {total_expected} historical windows.\n")

    # ── 3. Download loop ──────────────────────────────────────────────────────
    successfully_downloaded = 0
    composited_months = set()   # track months already covered by a composite

    for target_date_str in active_target_dates:

        # ETR estimate
        etr = "Calculating..."
        if processed_count > 0:
            avg_time   = (time.time() - start_total_time) / processed_count
            rem_secs   = int(avg_time * (total_expected - processed_count))
            etr        = f"{rem_secs // 60}m {rem_secs % 60}s"

        target_dt = datetime.strptime(target_date_str, "%Y-%m-%d")
        month_key = (target_dt.year, target_dt.month)

        print(f"[>] Searching for valid imagery on {target_date_str}...", flush=True)
        yield json.dumps({"status": "searching", "target_date": target_date_str, "etr": etr})

        # ── 3a. Try single clear image ────────────────────────────────────────
        res = get_best_image_for_date(aoi, target_date_str)
        image, time_ist, thumb_url, cloud_pct, ndvi_mean = res

        # ── 3b. Fallback: monthly median composite ────────────────────────────
        if image is None:
            if month_key not in composited_months:
                month_label = target_dt.strftime("%B %Y")
                print(f"  --> No clear image found. Building cloud-free composite for {month_label}...", flush=True)
                yield json.dumps({
                    "status": "compositing",
                    "target_date": target_date_str,
                    "message": f"Cloud cover detected — building monthly composite for {month_label}",
                    "etr": etr
                })

                res_comp = get_monthly_composite(
                    aoi, target_dt.year, target_dt.month
                )
                image, time_ist, thumb_url, cloud_pct, ndvi_mean = res_comp

                if image:
                    composited_months.add(month_key)
                    print(f"  --> Composite ready: {time_ist}", flush=True)
                else:
                    print(f"  --> Composite also failed for {month_label}.", flush=True)
                    yield json.dumps({
                        "status": "failed",
                        "message": f"No data available for {month_label}",
                        "target_date": target_date_str,
                        "etr": etr
                    })
                    processed_count += 1
                    continue
            else:
                # Month already has a composite — skip this duplicate target date
                print(f"  --> Month {target_dt.strftime('%B %Y')} already composited, skipping.", flush=True)
                processed_count += 1
                continue

        # ── 3c. Download whatever image/composite we have ─────────────────────
        filename = f"{season.upper()}_{time_ist}.tif"
        filepath = os.path.join(output_dir, filename)

        print(f"  --> Downloading {filename}...", flush=True)
        yield json.dumps({
            "status": "downloading",
            "target_date": target_date_str,
            "actual_date": time_ist,
            "thumb": thumb_url,
            "cloud_cover": cloud_pct,
            "ndvi_avg": ndvi_mean,
            "etr": etr
        })

        try:
            geemap.ee_export_image(
                image.unmask(0),
                filename=filepath,
                scale=10,
                region=aoi,
                file_per_band=False
            )
            successfully_downloaded += 1
            print(f"  --> Successfully saved {filename}!\n", flush=True)
            yield json.dumps({
                "status": "completed",
                "target_date": target_date_str,
                "actual_date": time_ist,
                "filename": filename,
                "thumb": thumb_url,
                "cloud_cover": cloud_pct,
                "ndvi_avg": ndvi_mean,
                "etr": etr
            })
        except Exception as e:
            print(f"  --> ERROR exporting {filename}: {str(e)}\n", flush=True)
            yield json.dumps({"status": "failed", "message": f"Export Error: {str(e)}", "target_date": target_date_str})

        processed_count += 1

    # ── 4. Run Agriculture Extraction ─────────────────────────────────────────
    if successfully_downloaded < 2:
        yield json.dumps({"status": "error", "message": "Insufficient images found (Need at least 2 for temporal analysis)."})
        return

    yield json.dumps({"status": "finished", "message": "Satellite acquisition complete."})
    
    if skip_extraction:
        return
        
    yield json.dumps({"status": "processing", "message": f"Running {season.upper()} AI Extraction..."})

    try:
        result = None
        for update in run_agri_extraction(output_dir, season=season, aoi_geojson=aoi_geojson):
            if isinstance(update, dict) and update.get("status") == "success":
                result = update
            elif isinstance(update, dict) and update.get("status") == "error":
                yield json.dumps(update)
                return
            else:
                yield json.dumps(update)

        if result and result.get("status") == "success":
            yield json.dumps({
                "status": "completed_all",
                "message": "AI Extraction Successful",
                "mask_path": result["mask_path"],
                "pixel_count": result["pixel_count"]
              })
        else:
            yield json.dumps({"status": "error", "message": "AI Extraction failed to return results."})
    except Exception as e:
        import traceback
        print(f"Extraction Error: {e}\n{traceback.format_exc()}")
        yield json.dumps({"status": "error", "message": f"Processing Error: {str(e)}"})


if __name__ == "__main__":
    pass
