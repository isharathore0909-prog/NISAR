# ============================================================
# CELL
# ============================================================
# ============================================================
# IMPORTS
# ============================================================

import os
import calendar
import datetime
import time
import glob
import math
import shutil

import numpy as np
import requests

import ee
import geemap

import fiona
import geopandas as gpd

import rasterio
from rasterio.merge import merge
from rasterio.mask import mask as rio_mask
from rasterio.features import rasterize
from rasterio.transform import from_bounds, array_bounds

from shapely.geometry import box, Polygon, MultiPolygon, mapping
from shapely.ops import unary_union
from datetime import timedelta, UTC


# ============================================================
# CELL
# ============================================================
# ============================================================
# EARTH ENGINE INITIALISATION
# ============================================================

SERVICE_ACCOUNT = (
    "biomis@ee-sanskarwork2810.iam.gserviceaccount.com"
)

KEY_PATH = (
    "ee-sanskarwork2810-c8eadb7ac163.json"
)

credentials = ee.ServiceAccountCredentials(
    SERVICE_ACCOUNT,
    KEY_PATH
)

ee.Initialize(credentials)

print("Earth Engine Initialized ✅")


# ============================================================
# CELL
# ============================================================
# ============================================================
# LOAD KML
# ============================================================


# Enable KML
fiona.drvsupport.supported_drivers['KML'] = 'rw'

# ============================================================
# READ KML
# ============================================================

kml_path = r"KML/ajmer.kml"

gdf = gpd.read_file(
    kml_path,
    driver='KML'
)

print("KML Loaded ✅")

print(gdf)

# ============================================================
# CONVERT CRS
# ============================================================

gdf = gdf.to_crs(epsg=4326)

# ============================================================
# REMOVE Z DIMENSION
# ============================================================

def remove_z(geom):

    if geom is None:
        return None

    if geom.geom_type == 'Polygon':

        return Polygon([
            (x, y)
            for x, y, *_ in geom.exterior.coords
        ])

    elif geom.geom_type == 'MultiPolygon':

        polygons = []

        for poly in geom.geoms:

            polygons.append(
                Polygon([
                    (x, y)
                    for x, y, *_ in poly.exterior.coords
                ])
            )

        return MultiPolygon(polygons)

    return geom

gdf["geometry"] = gdf["geometry"].apply(remove_z)

# ============================================================
# FIX INVALID GEOMETRIES
# ============================================================

gdf["geometry"] = gdf.buffer(0)

# ============================================================
# MERGE GEOMETRIES
# ============================================================

merged_geom = unary_union(gdf.geometry)

# ============================================================
# CREATE CLEAN GDF
# ============================================================

clean_gdf = gpd.GeoDataFrame(
    geometry=[merged_geom],
    crs="EPSG:4326"
)

print("\nGeometry Fixed ✅")

# ============================================================
# CONVERT TO EARTH ENGINE
# ============================================================

roi = geemap.geopandas_to_ee(clean_gdf)

print("ROI Converted to Earth Engine ✅")

# ============================================================
# CELL
# ============================================================
# ============================================================
# TILE GRID CREATION
# tile_size_deg : tile edge length in degrees
#   10m imagery (Sentinel-2, SAR) -> 0.03 deg  (~3300 px/tile)
#   30m imagery (Landsat, DEM)     -> 0.09 deg  (~3300 px/tile)
# ============================================================

def create_grid(
    bounds,
    tile_size
):

    xmin, ymin, xmax, ymax = bounds

    rows = np.arange(
        ymin,
        ymax,
        tile_size
    )

    cols = np.arange(
        xmin,
        xmax,
        tile_size
    )

    polygons = []

    for x in cols:
        for y in rows:

            polygons.append(

                box(
                    x,
                    y,
                    x + tile_size,
                    y + tile_size
                )
            )

    grid = gpd.GeoDataFrame(
        geometry=polygons,
        crs="EPSG:4326"
    )

    return grid


def make_grid(tile_size_deg):
    """Intersect a fresh tile grid with the ROI and return it."""

    raw = create_grid(
        gdf.total_bounds,
        tile_size_deg
    )

    clipped = gpd.overlay(
        raw,
        gdf,
        how='intersection'
    )

    return clipped

# ============================================================
# CELL
# ============================================================
# ============================================================
# CREATE TILE GRIDS
# Separate grids per resolution avoids over-tiling 30m data.
# 10m  -> 0.03 deg/tile  (~81 tiles for this ROI)
# 30m  -> 0.09 deg/tile  (~9 tiles for this ROI)
# ============================================================

grid_10m = make_grid(0.03)   # Sentinel-2, SAR

grid_30m = make_grid(0.09)   # Landsat, DEM

# Keep backward-compat name used by existing cells
grid = grid_10m

print(
    "10m grid tiles:",
    len(grid_10m),
    "  |  30m grid tiles:",
    len(grid_30m)
)

# ============================================================
# CELL
# ============================================================
# ============================================================
# CONFIGURATION
# ============================================================

OUTPUT_DIR = r"Satellite Imagery\\Ajmer\\Satellite Data"


# ============================================================
# CURRENT UTC DATE
# ============================================================

analysis_date = datetime.datetime(2026, 2, 15, tzinfo=datetime.timezone.utc)

# ============================================================
# ECOLOGICAL TEMPORAL WINDOW
# ============================================================

window_days = 30

# ============================================================
# LAST 30 DAYS ONLY
# ============================================================

start_window = (
    analysis_date - datetime.timedelta(days=window_days)
).strftime("%Y-%m-%d")

end_window = analysis_date.strftime("%Y-%m-%d")

# ============================================================
# PRINT
# ============================================================

print("Analysis Window:")
print(start_window, "to", end_window)

# ============================================================
# CELL
# ============================================================
def mask_s2_clouds(image):

    qa = image.select('QA60')
    cloud_bit_mask = 1 << 10
    cirrus_bit_mask = 1 << 11

    mask = (
        qa.bitwiseAnd(cloud_bit_mask).eq(0)
        .And(
            qa.bitwiseAnd(cirrus_bit_mask).eq(0)
        )
    )

    return (
        image
        .updateMask(mask)
        .divide(10000)
        .copyProperties(
            image,
            image.propertyNames()
        )
    )

print("Cloud Mask Function Ready ✅")

# ============================================================
# CELL
# ============================================================
# ============================================================
# SENTINEL-2 COLLECTION
# ============================================================

s2 = (

    ee.ImageCollection(
        "COPERNICUS/S2_SR_HARMONIZED"
    )

    .filterBounds(roi)

    .filterDate(
        start_window,
        end_window
    )

    .filter(
        ee.Filter.lt(
            'CLOUDY_PIXEL_PERCENTAGE',
            10
        )
    )

    .map(mask_s2_clouds)
)

print(
    "Sentinel Images:",
    s2.size().getInfo()
)

# ============================================================
# ADD ROI COVERAGE
# ============================================================

roi_area = roi.geometry().area()

def add_coverage(image):

    footprint = image.geometry()

    intersection = footprint.intersection(
        roi.geometry(),
        ee.ErrorMargin(1)
    )

    coverage = (
        intersection.area()
        .divide(roi_area)
        .multiply(100)
    )

    return image.set(
        'ROI_COVERAGE',
        coverage
    )

s2 = s2.map(add_coverage)

# ============================================================
# ADD QUALITY SCORE
# ============================================================

def add_score(image):

    coverage = ee.Number(
        image.get('ROI_COVERAGE')
    )

    cloud = ee.Number(
        image.get('CLOUDY_PIXEL_PERCENTAGE')
    )

    score = (
        coverage.multiply(1000)
        .subtract(cloud)
    )

    return image.set(
        'QUALITY_SCORE',
        score
    )

s2 = s2.map(add_score)

# ============================================================
# SORT BY QUALITY
# ============================================================

s2_sorted = s2.sort(
    'QUALITY_SCORE',
    False
)

best_s2 = s2_sorted.limit(5)

# ============================================================
# MOSAIC FOR COVERAGE
# ============================================================

selected_s2 = (

    best_s2

    .mosaic()

    .select([
        'B1','B2','B3','B4',
        'B5','B6','B7','B8',
        'B8A','B9','B11','B12'
    ])

    .clip(roi.geometry())

    .toFloat()
)

print("Sentinel Ready ✅")

# ============================================================
# CELL
# ============================================================
# ============================================================
# SENTINEL IMAGE DETAILS
# 5 aggregate_array calls (one per property, one round-trip each)
# instead of N*4 individual getInfo() calls.
# ============================================================

# One server-side call per property
time_starts = s2_sorted.aggregate_array('system:time_start').getInfo()
clouds      = s2_sorted.aggregate_array('CLOUDY_PIXEL_PERCENTAGE').getInfo()
qualities   = s2_sorted.aggregate_array('QUALITY_SCORE').getInfo()
coverages   = s2_sorted.aggregate_array('ROI_COVERAGE').getInfo()
ids         = s2_sorted.aggregate_array('system:index').getInfo()

print("\nAVAILABLE SENTINEL-2 IMAGES:\n")

for i, (ts, cl, qs, cov, sid) in enumerate(
    zip(time_starts, clouds, qualities, coverages, ids)
):

    date = datetime.datetime.utcfromtimestamp(
        int(ts) / 1000
    ).strftime('%Y-%m-%d')

    print(f"{i+1}. Date: {date}")
    print(f"   Cloud % : {float(cl):.2f}")
    print(f"   Coverage: {float(cov):.2f}%")
    print(f"   ID      : {sid}")
    print(f"   Quality : {float(qs):.2f}\n")


# ============================================================
# CELL
# ============================================================
# ============================================================
# REFERENCE IMAGE DETAILS  (one round-trip via toDictionary)
# ============================================================

reference_img = ee.Image(s2_sorted.first())

ref_info = reference_img.toDictionary([
    'system:time_start',
    'CLOUDY_PIXEL_PERCENTAGE',
    'ROI_COVERAGE',
]).getInfo()

selected_date = datetime.datetime.utcfromtimestamp(
    int(ref_info['system:time_start']) / 1000
).strftime('%Y-%m-%d')

selected_cloud    = ref_info['CLOUDY_PIXEL_PERCENTAGE']
selected_coverage = ref_info['ROI_COVERAGE']

print("\nREFERENCE SENTINEL IMAGE ✅")
print("Date      :", selected_date)
print("Cloud %   :", round(selected_cloud, 2))
print("Coverage %:", round(selected_coverage, 2))


# ============================================================
# CELL
# ============================================================
landsat = (

    ee.ImageCollection(
        "LANDSAT/LC08/C02/T1_L2"
    )

    .merge(

        ee.ImageCollection(
            "LANDSAT/LC09/C02/T1_L2"
        )

    )

    .filterBounds(roi)

    .filterDate(
        start_window,
        end_window
    )

    .filter(
        ee.Filter.lt(
            "CLOUD_COVER",
            20
        )
    )
)

print(
    "Landsat Images:",
    landsat.size().getInfo()
)

landsat_image = (
    landsat
    .sort("CLOUD_COVER")
    .mosaic()
    .clip(roi)
    .unmask(0)
)

print("Landsat Ready ✅")

# ============================================================
# CELL
# ============================================================
# ============================================================
# LANDSAT IMAGE DETAILS  (aggregate_array — 3 round-trips)
# ============================================================

l_time_starts = landsat.aggregate_array('system:time_start').getInfo()
l_clouds      = landsat.aggregate_array('CLOUD_COVER').getInfo()
l_ids         = landsat.aggregate_array('system:index').getInfo()

print("\nAVAILABLE LANDSAT IMAGES:\n")

for i, (ts, cl, sid) in enumerate(
    zip(l_time_starts, l_clouds, l_ids)
):

    date = datetime.datetime.utcfromtimestamp(
        int(ts) / 1000
    ).strftime('%Y-%m-%d')

    print(f"{i+1}. Date: {date}")
    print(f"   Cloud %: {float(cl):.2f}")
    print(f"   ID: {sid}\n")


# ============================================================
# CELL
# ============================================================
# ============================================================
# FINAL LANDSAT MOSAIC  (top-3 by cloud cover)
# ============================================================

top3 = landsat.sort("CLOUD_COVER").limit(3)

landsat_image = (
    top3
    .mosaic()
    .clip(roi)
    .toFloat()
)

# Show mosaic sources in one batch (3 round-trips)
t3_times  = top3.aggregate_array('system:time_start').getInfo()
t3_clouds = top3.aggregate_array('CLOUD_COVER').getInfo()
t3_ids    = top3.aggregate_array('system:index').getInfo()

print("\nLANDSAT MOSAIC SOURCES (top 3 by cloud cover):\n")

for i, (ts, cl, sid) in enumerate(
    zip(t3_times, t3_clouds, t3_ids)
):

    date = datetime.datetime.utcfromtimestamp(
        int(ts) / 1000
    ).strftime('%Y-%m-%d')

    print(f"{i+1}. Date: {date}  Cloud: {float(cl):.2f}%  ID: {sid}")

print("\nLandsat Mosaic Ready ✅")


# ============================================================
# CELL
# ============================================================
# ============================================================
# SENTINEL-1 SAR
# ============================================================

sar = (

    ee.ImageCollection("COPERNICUS/S1_GRD")

    .filterBounds(roi)

    .filterDate(
        start_window,
        end_window
    )

    .filter(
        ee.Filter.eq(
            'instrumentMode',
            'IW'
        )
    )

    .filter(
        ee.Filter.listContains(
            'transmitterReceiverPolarisation',
            'VV'
        )
    )

    .filter(
        ee.Filter.listContains(
            'transmitterReceiverPolarisation',
            'VH'
        )
    )
)

print(
    "SAR Images:",
    sar.size().getInfo()
)

# ============================================================
# MEDIAN COMPOSITE  ->  dB CONVERSION  ->  SPECKLE FILTER
# Fix: use the actual processed vv/vh rather than restarting
# from raw sar.median() which discards zero-value protection.
# ============================================================

sar_median = sar.median()

# --------------------------------------------------------
# VV : protect zeros then convert linear power -> dB
# --------------------------------------------------------

vv_lin = sar_median.select('VV')

vv_lin = vv_lin.where(
    vv_lin.lte(0),
    0.0001
)

vv_db = vv_lin.log10().multiply(10).rename('VV_dB')

# --------------------------------------------------------
# VH : same treatment
# --------------------------------------------------------

vh_lin = sar_median.select('VH')

vh_lin = vh_lin.where(
    vh_lin.lte(0),
    0.0001
)

vh_db = vh_lin.log10().multiply(10).rename('VH_dB')

# --------------------------------------------------------
# COMBINE, SPECKLE-FILTER, CLIP
# --------------------------------------------------------

sar_image = (

    vv_db

    .addBands(vh_db)

    .focal_mean(
        radius=30,
        units='meters'
    )

    .clip(roi.geometry())

    .toFloat()
)

print("SAR Ready \u2705")

# ============================================================
# CELL
# ============================================================
# ============================================================
# SAR IMAGE DETAILS  (aggregate_array — 3 round-trips)
# ============================================================

sar_times  = sar.aggregate_array('system:time_start').getInfo()
sar_orbits = sar.aggregate_array('orbitProperties_pass').getInfo()
sar_ids    = sar.aggregate_array('system:index').getInfo()

print("\nAVAILABLE SAR IMAGES:\n")

for i, (ts, orb, sid) in enumerate(
    zip(sar_times, sar_orbits, sar_ids)
):

    date = datetime.datetime.utcfromtimestamp(
        int(ts) / 1000
    ).strftime('%Y-%m-%d')

    print(f"{i+1}. Date: {date}")
    print(f"   Orbit: {orb}")
    print(f"   ID: {sid}\n")


# ============================================================
# CELL
# ============================================================
# ============================================================
# FINAL SAR IMAGE USED
# ============================================================

selected_sar = (
    sar
    .sort("system:time_start")
    .first()
)

selected_sar = ee.Image(selected_sar)

sar_date = ee.Date(
    selected_sar.get('system:time_start')
).format('YYYY-MM-dd').getInfo()

sar_id = selected_sar.id().getInfo()

sar_orbit = selected_sar.get(
    'orbitProperties_pass'
).getInfo()

print("\nSELECTED SAR IMAGE ✅")
print("Date:", sar_date)
print("Orbit:", sar_orbit)
print("ID:", sar_id)

# ============================================================
# CELL
# ============================================================
dem = ee.Image(
    "USGS/SRTMGL1_003"
).clip(roi)

print("DEM Ready ✅")

# ============================================================
# CELL
# ============================================================
print(
    selected_s2.bandNames().getInfo()
)

print(
    selected_s2.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=roi,
        scale=10,
        maxPixels=1e13
    ).getInfo()
)

# ============================================================
# CELL
# ============================================================
Map = geemap.Map()

rgb_vis = {
    'bands': ['B4', 'B3', 'B2'],
    'min': 0,
    'max': 0.3
}

Map.centerObject(roi, 11)

Map.addLayer(
    selected_s2,
    rgb_vis,
    "Sentinel RGB"
)

Map.addLayer(
    roi,
    {},
    "ROI"
)

Map

# ============================================================
# CELL
# ============================================================
# ============================================================
# NOTE: .toFloat() is already applied inside each sensor cell.
# This cell is kept as a safety pass for DEM (static Image).
# ============================================================

dem = dem.toFloat()


# ============================================================
# CELL
# ============================================================
# ============================================================
# TILE DOWNLOAD FUNCTION
# Retries up to 3 times with exponential back-off.
# ============================================================


def download_tile(
    image,
    geom,
    output_path,
    scale
):

    url = image.getDownloadURL({

        'region': geom.__geo_interface__,

        'scale': scale,

        'crs': 'EPSG:4326',

        'format': 'GEO_TIFF'
    })

    max_retries = 3

    for attempt in range(1, max_retries + 1):

        try:

            response = requests.get(url, timeout=120)

            if response.status_code == 200:

                with open(output_path, 'wb') as f:

                    f.write(response.content)

                print(f"Downloaded: {output_path}")

                return

            else:

                raise RuntimeError(
                    f"HTTP {response.status_code}"
                )

        except Exception as e:

            wait = 2 ** attempt

            if attempt < max_retries:

                print(
                    f"Retry {attempt}/{max_retries} "
                    f"({e}) waiting {wait}s "
                    f"-> {output_path}"
                )

                time.sleep(wait)

            else:

                print(
                    f"FAILED after {max_retries} attempts: "
                    f"{output_path} ({e})"
                )

# ============================================================
# CELL
# ============================================================
# ============================================================
# TILE EXPORT ENGINE
# Improvements:
#   - Accepts a grid parameter (10m vs 30m)
#   - Clears stale tile folder before downloading
#   - Skips if final output already exists
#   - Uses try/finally to guarantee file handle cleanup
# ============================================================

def export_tiled_image(
    image,
    name,
    scale,
    tile_grid=None
):

    # ========================================================
    # RESOLVE GRID
    # ========================================================

    active_grid = tile_grid if tile_grid is not None else grid

    # ========================================================
    # OUTPUT PATH
    # ========================================================

    output_dir  = OUTPUT_DIR
    os.makedirs(output_dir, exist_ok=True)
    final_output = os.path.join(output_dir, f"{name}.tif")

    # ========================================================
    # SKIP IF EXISTS
    # ========================================================

    if os.path.exists(final_output):

        print(
            f"Skipped (already exists): {final_output}"
        )

        return

    # ========================================================
    # CLEAR + CREATE TILE FOLDER
    # ========================================================

    tile_folder = f"{name}_tiles"

    if os.path.exists(tile_folder):

        shutil.rmtree(tile_folder)

    os.makedirs(tile_folder)

    # ========================================================
    # DOWNLOAD TILES
    # ========================================================

    for idx, row in active_grid.iterrows():

        tile_path = os.path.join(
            tile_folder,
            f"tile_{idx}.tif"
        )

        download_tile(
            image,
            row.geometry,
            tile_path,
            scale
        )

    # ========================================================
    # MERGE TILES  (try/finally guarantees handle cleanup)
    # ========================================================

    tif_files = [

        f for f in glob.glob(
            f"{tile_folder}/*.tif"
        )

        if os.path.getsize(f) > 1000
    ]

    if not tif_files:

        print(f"ERROR: no valid tiles for {name}")

        shutil.rmtree(tile_folder)

        return

    src_files = [rasterio.open(f) for f in tif_files]

    try:

        mosaic, out_transform = merge(src_files)

        out_meta = src_files[0].meta.copy()

        out_meta.update({

            "height"   : mosaic.shape[1],

            "width"    : mosaic.shape[2],

            "transform": out_transform,

            "compress" : "lzw",

            "tiled"    : True
        })

        with rasterio.open(
            final_output,
            "w",
            **out_meta
        ) as dest:

            dest.write(mosaic)

        print(f"Merged: {final_output}")

    finally:

        # Always close handles, even if merge raised an exception
        for src in src_files:
            src.close()

    # ========================================================
    # DELETE TILES
    # ========================================================

    shutil.rmtree(tile_folder)

    print(f"Removed: {tile_folder}")

# ============================================================
# CELL
# ============================================================
# ============================================================
# EXPORT ALL DATASETS
# Sentinel-2 and SAR use grid_10m (0.03 deg tiles)
# Landsat and DEM use grid_30m (0.09 deg tiles)
# ============================================================

export_tiled_image(
    selected_s2,
    "Sentinel2_Image",
    10,
    tile_grid=grid_10m
)

export_tiled_image(
    landsat_image,
    "Landsat_Image",
    30,
    tile_grid=grid_30m
)

export_tiled_image(
    sar_image,
    "SAR_Image",
    10,
    tile_grid=grid_10m
)

export_tiled_image(
    dem,
    "DEM_30m",
    30,
    tile_grid=grid_30m
)

print(
    "\nALL DOWNLOADS COMPLETE \u2705"
)

# ============================================================
# CELL
# ============================================================
# ============================================================
# EXTENDED SENSOR ACQUISITION HELPERS
# ============================================================
# True scissor-cut clipping:
#
#   Problem: A 250m MODIS pixel is a fixed-size square. If the
#   polygon edge cuts through it, the pixel still extends beyond
#   the boundary because rasters are always rectangular grids.
#
#   Solution: Resample the coarse data to 10m resolution (same
#   as Sentinel-2) using nearest-neighbour, THEN apply the
#   polygon mask. At 10m, the pixel edges follow the polygon
#   boundary within 10m precision — visually identical to a
#   vector clip. The output has the EXACT same extent as the
#   Sentinel-2 image.
#
#   This is how professional GIS tools (ArcGIS Extract by Mask,
#   QGIS Clip Raster by Mask Layer) achieve clean polygon clips.
# ============================================================

from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds as tfm_from_bounds

coarse_dir = OUTPUT_DIR
os.makedirs(coarse_dir, exist_ok=True)

_aoi_geom = clean_gdf.geometry.iloc[0]

# Target resolution for the resampled output (metres)
# 10m matches Sentinel-2 so all layers align perfectly
TARGET_RES_M = 10

# Convert to degrees (approximate at this latitude)
_lat_c = (_aoi_geom.bounds[1] + _aoi_geom.bounds[3]) / 2.0
_m_per_deg = 111320.0 * math.cos(math.radians(_lat_c))
_target_res_deg = TARGET_RES_M / _m_per_deg

# Target grid dimensions from AOI bounds
_xmin, _ymin, _xmax, _ymax = _aoi_geom.bounds
_target_w = int(math.ceil((_xmax - _xmin) / _target_res_deg))
_target_h = int(math.ceil((_ymax - _ymin) / _target_res_deg))
_target_transform = tfm_from_bounds(_xmin, _ymin, _xmax, _ymax, _target_w, _target_h)

print(f'  Target grid: {_target_w}x{_target_h} px @ {TARGET_RES_M}m')
print(f'  AOI bounds : {[round(v,5) for v in _aoi_geom.bounds]}')

# Pre-compute the mask at target resolution (once)
_target_mask = rasterize(
    [(_aoi_geom, 1)],
    out_shape=(_target_h, _target_w),
    transform=_target_transform,
    fill=0,
    dtype='uint8',
    all_touched=True
).astype(bool)

print(f'  Mask pixels inside AOI: {int(np.sum(_target_mask)):,}')


def _hard_clip(output_path):
    """
    Resample to 10m target grid, then apply polygon mask.
    Result has EXACT same extent as Sentinel-2 output.
    """
    tmp = output_path + '._tmp.tif'

    with rasterio.open(output_path) as src:
        src_data = src.read().astype(np.float32)
        src_crs  = src.crs
        src_transform = src.transform
        n_bands  = src.count

    # Resample each band to target grid (nearest neighbour)
    resampled = np.zeros((n_bands, _target_h, _target_w), dtype=np.float32)

    for b in range(n_bands):
        reproject(
            source=src_data[b],
            destination=resampled[b],
            src_transform=src_transform,
            src_crs=src_crs,
            dst_transform=_target_transform,
            dst_crs=src_crs,
            resampling=Resampling.nearest
        )

    # Apply polygon mask — outside = NaN
    resampled[:, ~_target_mask] = np.nan

    # Write output
    out_meta = {
        'driver'   : 'GTiff',
        'height'   : _target_h,
        'width'    : _target_w,
        'count'    : n_bands,
        'dtype'    : 'float32',
        'crs'      : src_crs,
        'transform': _target_transform,
        'nodata'   : np.nan,
        'compress' : 'lzw',
    }

    with rasterio.open(tmp, 'w', **out_meta) as dst:
        dst.write(resampled)

    shutil.move(tmp, output_path)

    print(
        f'  Clipped: {os.path.basename(output_path):<42}  '
        f'{_target_w}x{_target_h} px @ {TARGET_RES_M}m'
    )


def download_single(image, name, scale, out_dir=None):
    """Download and resample+clip to exact AOI polygon at 10m."""

    target_dir  = out_dir if out_dir else coarse_dir
    output_path = os.path.join(target_dir, f'{name}.tif')

    if os.path.exists(output_path):
        print(f'Skipped (already exists): {output_path}')
        return

    roi_geom = clean_gdf.geometry.iloc[0]

    # Download at native resolution (all pixels touching ROI)
    download_tile(
        image.clip(roi.geometry()),
        roi_geom, output_path, scale
    )

    # Resample to 10m + hard polygon mask
    if os.path.exists(output_path):
        _hard_clip(output_path)


print('Extended acquisition helpers ready \u2705')
print(f'  Mode: resample to {TARGET_RES_M}m + hard polygon mask')


# ============================================================
# CELL
# ============================================================
# ============================================================
# MODIS
# ============================================================
# Products downloaded
#   MOD09GQ  - Surface Reflectance 250m  (bands 1 & 2)
#   MOD11A1  - Land Surface Temperature 1km  (day + night)
#   MOD13Q1  - Vegetation Indices 250m  (NDVI, EVI - 16-day)
#   MCD43A4  - BRDF-corrected surface reflectance 500m
#   MOD44B   - Vegetation Continuous Fields 250m (tree cover)
# ============================================================

print("Preparing MODIS products...")

# --------------------------------------------------------
# MOD09GQ : Surface Reflectance 250m
# --------------------------------------------------------

modis_sr = (
    ee.ImageCollection("MODIS/061/MOD09GQ")
    .filterBounds(roi)
    .filterDate(start_window, end_window)
    .select(["sur_refl_b01", "sur_refl_b02"])   # Red, NIR
    .mean()
)

download_single(modis_sr, "MODIS_SR_250m", 250)

# --------------------------------------------------------
# MOD11A1 : Land Surface Temperature 1km
# --------------------------------------------------------

modis_lst = (
    ee.ImageCollection("MODIS/061/MOD11A1")
    .filterBounds(roi)
    .filterDate(start_window, end_window)
    .select(["LST_Day_1km", "LST_Night_1km", "QC_Day"])
    .mean()
)

download_single(modis_lst, "MODIS_LST_1km", 1000)

# --------------------------------------------------------
# MOD13Q1 : Vegetation Indices 250m  (16-day product)
# Widen window to 32 days to guarantee at least one image
# --------------------------------------------------------

vi_start = (
    analysis_date - datetime.timedelta(days=32)
).strftime("%Y-%m-%d")

modis_vi = (
    ee.ImageCollection("MODIS/061/MOD13Q1")
    .filterBounds(roi)
    .filterDate(vi_start, end_window)
    .select(["NDVI", "EVI", "SummaryQA"])
    .mean()
)

download_single(modis_vi, "MODIS_VI_250m", 250)

# --------------------------------------------------------
# MCD43A4 : BRDF-corrected Reflectance 500m
# --------------------------------------------------------

modis_brdf = (
    ee.ImageCollection("MODIS/061/MCD43A4")
    .filterBounds(roi)
    .filterDate(start_window, end_window)
    .select([
        "Nadir_Reflectance_Band1",   # Red
        "Nadir_Reflectance_Band2",   # NIR
        "Nadir_Reflectance_Band3",   # Blue
        "Nadir_Reflectance_Band6",   # SWIR-1
        "Nadir_Reflectance_Band7",   # SWIR-2
    ])
    .mean()
)

download_single(modis_brdf, "MODIS_BRDF_500m", 500)

# --------------------------------------------------------
# MOD44B : Vegetation Continuous Fields 250m
# Annual product — use most recent year available
# --------------------------------------------------------

modis_vcf = (
    ee.ImageCollection("MODIS/061/MOD44B")
    .filterBounds(roi)
    .sort("system:time_start", False)
    .first()
    .select(["Percent_Tree_Cover", "Percent_NonTree_Vegetation", "Percent_NonVegetated"])
)

download_single(modis_vcf, "MODIS_VCF_250m", 250)

print("\nMODIS downloads complete \u2705")


# ============================================================
# CELL
# ============================================================
# ============================================================
# VIIRS  (Visible Infrared Imaging Radiometer Suite)
# ============================================================
# Collections : NASA/VIIRS/002/*  (v001 NOAA prefix deprecated)
# Band names verified against live GEE catalogue Jan 2026.
#   VNP09GA   - Surface Reflectance 500m  (daily)
#   VNP21A1D  - Land Surface Temperature 1km  (day)
#   VNP13A1   - Vegetation Indices 500m  (16-day)
#   VNP46A2   - Night-time Lights 500m  (daily)
# ============================================================

print("Preparing VIIRS products...")

# --------------------------------------------------------
# VNP09GA  : Surface Reflectance 500m
# M3=Blue  M4=Green  M5=Red  M7=NIR  M10=SWIR-1  M11=SWIR-2
# --------------------------------------------------------

viirs_sr = (
    ee.ImageCollection("NASA/VIIRS/002/VNP09GA")
    .filterBounds(roi)
    .filterDate(start_window, end_window)
    .select(["M3", "M4", "M5", "M7", "M10", "M11", "QF1"])
    .mean()
)

download_single(viirs_sr, "VIIRS_SR_500m", 500)

# --------------------------------------------------------
# VNP21A1D : Daytime LST 1km
# --------------------------------------------------------

viirs_lst = (
    ee.ImageCollection("NASA/VIIRS/002/VNP21A1D")
    .filterBounds(roi)
    .filterDate(start_window, end_window)
    .select(["LST_1KM", "QC", "Emis_14", "Emis_15", "Emis_16"])
    .mean()
)

download_single(viirs_lst, "VIIRS_LST_1km", 1000)

# --------------------------------------------------------
# VNP13A1  : Vegetation Indices 500m  (16-day)
# --------------------------------------------------------

viirs_vi = (
    ee.ImageCollection("NASA/VIIRS/002/VNP13A1")
    .filterBounds(roi)
    .filterDate(vi_start, end_window)
    .select(["NDVI", "EVI", "EVI2", "NIR_reflectance", "pixel_reliability"])
    .mean()
)

download_single(viirs_vi, "VIIRS_VI_500m", 500)

# --------------------------------------------------------
# VNP46A2  : Night-time Lights 500m  (gap-filled DNB)
# --------------------------------------------------------

viirs_ntl = (
    ee.ImageCollection("NASA/VIIRS/002/VNP46A2")
    .filterBounds(roi)
    .filterDate(start_window, end_window)
    .select(["Gap_Filled_DNB_BRDF_Corrected_NTL", "Mandatory_Quality_Flag", "QF_Cloud_Mask"])
    .mean()
)

download_single(viirs_ntl, "VIIRS_NTL_500m", 500)

print("\nVIIRS downloads complete ✅")


# ============================================================
# CELL
# ============================================================
# ============================================================
# SENTINEL-5P  TROPOMI  (Atmospheric Chemistry)
# ============================================================
# Products downloaded  (all at native ~1113m resolution)
#   NO2   - Tropospheric column  mol/m2
#   CO    - Total column         mol/m2
#   O3    - Total column         mol/m2
#   SO2   - Total column         mol/m2
#   CH4   - Methane column       ppb
#   AER_AI - Absorbing Aerosol Index (PM2.5 proxy)
#   HCHO  - Formaldehyde column  mol/m2 (fire/vegetation proxy)
# ============================================================

print("Preparing Sentinel-5P products...")


S5P_SCALE = 1000   # native ~1113m -> download at 1km

s5p_layers = {
    "S5P_NO2"   : ("COPERNICUS/S5P/NRTI/L3_NO2",    "NO2_column_number_density"),
    "S5P_CO"    : ("COPERNICUS/S5P/NRTI/L3_CO",     "CO_column_number_density"),
    "S5P_O3"    : ("COPERNICUS/S5P/NRTI/L3_O3",     "O3_column_number_density"),
    "S5P_SO2"   : ("COPERNICUS/S5P/NRTI/L3_SO2",    "SO2_column_number_density"),
    "S5P_CH4"   : ("COPERNICUS/S5P/OFFL/L3_CH4",   "CH4_column_volume_mixing_ratio_dry_air"),
    "S5P_AAI"   : ("COPERNICUS/S5P/NRTI/L3_AER_AI", "absorbing_aerosol_index"),
    "S5P_HCHO"  : ("COPERNICUS/S5P/NRTI/L3_HCHO",  "tropospheric_HCHO_column_number_density"),
}

for name, (collection, band) in s5p_layers.items():

    image = (
        ee.ImageCollection(collection)
        .filterBounds(roi)
        .filterDate(start_window, end_window)
        .select(band)
        .mean()
    )

    download_single(image, name, S5P_SCALE)

print("\nSentinel-5P downloads complete \u2705")


# ============================================================
# CELL
# ============================================================
# ============================================================
# SMAP  (Soil Moisture Active Passive)
# ============================================================
# Collections verified against live GEE catalogue:
#   SPL3SMP_E/006  - Enhanced L3 passive SM 9km  (AM + PM)
#   SPL4SMGP/008   - L4 surface & root-zone SM 9km (model-assimilated)
# ============================================================

print("Preparing SMAP products...")

# --------------------------------------------------------
# SPL3SMP_E/006 : Passive Soil Moisture  9km  (AM + PM)
# --------------------------------------------------------

smap_passive = (
    ee.ImageCollection("NASA/SMAP/SPL3SMP_E/006")
    .filterBounds(roi)
    .filterDate(start_window, end_window)
    .select([
        "soil_moisture_am",          # AM soil moisture  m3/m3
        "soil_moisture_pm",          # PM soil moisture  m3/m3
        "vegetation_water_content_am",
        "retrieval_qual_flag_am",
        "soil_moisture_am_anomaly",
        "soil_moisture_pm_anomaly",
    ])
    .mean()
)

download_single(smap_passive, "SMAP_Passive_SM_9km", 9000)

# --------------------------------------------------------
# SPL4SMGP/008 : Root-zone SM  9km  (model-assimilated)
# Rich product: surface/root-zone/profile SM + ET + runoff
# --------------------------------------------------------

smap_rootzone = (
    ee.ImageCollection("NASA/SMAP/SPL4SMGP/008")
    .filterBounds(roi)
    .filterDate(start_window, end_window)
    .select([
        "sm_surface",                # 0-5 cm   m3/m3
        "sm_rootzone",               # 0-100 cm m3/m3
        "sm_profile",                # full profile m3/m3
        "surface_temp",              # K
        "land_evapotranspiration_flux",
        "overland_runoff_flux",
        "sm_surface_anomaly",
    ])
    .mean()
)

download_single(smap_rootzone, "SMAP_RootZone_SM_9km", 9000)

print("\nSMAP downloads complete ✅")


# ============================================================
# CELL
# ============================================================
# ============================================================
# GPM / TRMM  (Precipitation)
# ============================================================
# GPM IMERG V07   - Half-hourly 0.1 deg  (2000-present)
#   30-day accumulated total + mean rate
# TRMM 3B43 V7    - Monthly 0.25 deg  (1998-2015 only)
#   TRMM ended April 2015. For 2026 analysis dates we use
#   the same calendar month from 2014 as a climatological
#   baseline comparison.
# ============================================================

print("Preparing GPM / TRMM products...")

# --------------------------------------------------------
# GPM IMERG V07 : 30-day accumulated precipitation
# Bands: precipitation, precipitationUncal, randomError
# --------------------------------------------------------

gpm_accum = (
    ee.ImageCollection("NASA/GPM_L3/IMERG_V07")
    .filterBounds(roi)
    .filterDate(start_window, end_window)
    .select(["precipitation", "precipitationUncal", "randomError"])
    .sum()
)

download_single(gpm_accum, "GPM_Precipitation_30day", 11132)

# --------------------------------------------------------
# GPM IMERG V07 : Mean rate + liquid phase fraction
# --------------------------------------------------------

gpm_mean = (
    ee.ImageCollection("NASA/GPM_L3/IMERG_V07")
    .filterBounds(roi)
    .filterDate(start_window, end_window)
    .select([
        "precipitation",
        "probabilityLiquidPrecipitation",
        "MWprecipitation",
        "IRprecipitation",
    ])
    .mean()
)

download_single(gpm_mean, "GPM_Precipitation_Mean", 11132)

# --------------------------------------------------------
# TRMM 3B43 V7 : Historical climatological baseline
# TRMM ended April 2015 -> use same calendar month from 2014
# --------------------------------------------------------

trmm_year  = 2014

trmm_month = analysis_date.month

trmm_start = f"{trmm_year}-{trmm_month:02d}-01"


last_day = calendar.monthrange(trmm_year, trmm_month)[1]

trmm_end = f"{trmm_year}-{trmm_month:02d}-{last_day:02d}"

print(f"TRMM climatological window: {trmm_start} to {trmm_end}")

trmm = (
    ee.ImageCollection("TRMM/3B43V7")
    .filterBounds(roi)
    .filterDate(trmm_start, trmm_end)
    .select(["precipitation", "relativeError"])
    .mean()
)

n_trmm = trmm.bandNames().size().getInfo()

if n_trmm > 0:
    download_single(trmm, "TRMM_Climatology_2014", 27832)
else:
    print("TRMM: no images found for window, skipping")

print("\nGPM / TRMM downloads complete ✅")


# ============================================================
# CELL
# ============================================================
# ============================================================
# GEDI  (Global Ecosystem Dynamics Investigation  LiDAR)
# ============================================================
# Note: GEDI MONTHLY products store quality flags as PER-PIXEL
# raster bands, NOT as image-level collection properties.
# Collection-level .filter() on these flags drops all images.
# Quality masking is applied at the pixel level using .updateMask()
# inside a .map() call instead.
#
# Date window: 2022-2023 (MONTHLY products available in GEE)
# ============================================================

print("Preparing GEDI LiDAR products...")

gedi_start = "2022-01-01"
gedi_end   = "2023-12-31"

# --------------------------------------------------------
# GEDI L2A : Canopy height
# quality_flag & sensitivity are pixel bands -> mask per pixel
# --------------------------------------------------------

def mask_l2a(img):
    return img.updateMask(
        img.select("quality_flag").eq(1)
        .And(img.select("sensitivity").gt(0.95))
    )

gedi_l2a = (
    ee.ImageCollection("LARSE/GEDI/GEDI02_A_002_MONTHLY")
    .filterBounds(roi)
    .filterDate(gedi_start, gedi_end)
    .map(mask_l2a)
    .select(["rh98", "rh75", "rh50", "rh25",
             "elev_highestreturn", "elev_lowestmode",
             "quality_flag", "sensitivity"])
    .mean()
)

download_single(gedi_l2a, "GEDI_L2A_CanopyHeight_25m", 25)

# --------------------------------------------------------
# GEDI L2B : Canopy cover & plant area index
# --------------------------------------------------------

def mask_l2b(img):
    return img.updateMask(
        img.select("l2b_quality_flag").eq(1)
    )

gedi_l2b = (
    ee.ImageCollection("LARSE/GEDI/GEDI02_B_002_MONTHLY")
    .filterBounds(roi)
    .filterDate(gedi_start, gedi_end)
    .map(mask_l2b)
    .select(["cover", "pai", "fhd_normal",
             "pgap_theta", "l2b_quality_flag"])
    .mean()
)

download_single(gedi_l2b, "GEDI_L2B_CanopyCover_25m", 25)

# --------------------------------------------------------
# GEDI L4A : Above-ground biomass (shot-level)
# --------------------------------------------------------

def mask_l4a(img):
    return img.updateMask(
        img.select("l4_quality_flag").eq(1)
        .And(img.select("l2_quality_flag").eq(1))
    )

gedi_l4a = (
    ee.ImageCollection("LARSE/GEDI/GEDI04_A_002_MONTHLY")
    .filterBounds(roi)
    .filterDate(gedi_start, gedi_end)
    .map(mask_l4a)
    .select(["agbd", "agbd_se", "agbd_pi_lower", "agbd_pi_upper",
             "l4_quality_flag", "sensitivity"])
    .mean()
)

download_single(gedi_l4a, "GEDI_L4A_Biomass_25m", 25)

# --------------------------------------------------------
# GEDI L4B : Gridded mean AGB 1km (static single Image)
# --------------------------------------------------------

gedi_l4b = (
    ee.Image("LARSE/GEDI/GEDI04_B_002")
    .select(["MU", "SE", "V1", "V2", "QF", "PS"])
)

download_single(gedi_l4b, "GEDI_L4B_Biomass_1km", 1000)

print("\nGEDI LiDAR downloads complete ✅")


# ============================================================
# CELL
# ============================================================
# ============================================================
# ACQUISITION SUMMARY
# ============================================================


target_dir = coarse_dir

all_tifs = sorted(
    f for f in os.listdir(target_dir)
    if f.endswith(".tif")
)

print(f"\n{'FILE':<45} {'SIZE (MB)':>10}")
print("-" * 57)

total_mb = 0

for fname in all_tifs:

    fpath = os.path.join(target_dir, fname)
    mb    = os.path.getsize(fpath) / 1_048_576
    total_mb += mb

    print(f"{fname:<45} {mb:>10.2f}")

print("-" * 57)
print(f"{'TOTAL':<45} {total_mb:>10.2f} MB")
print(f"\nTotal files : {len(all_tifs)}")
print("\nALL SENSOR ACQUISITIONS COMPLETE \u2705")


