import os
# Bypasses local PostgreSQL PROJ database layout version mismatch
venv_proj_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "venv", "Lib", "site-packages", "rasterio", "proj_data"))
if os.path.exists(venv_proj_path):
    os.environ['PROJ_LIB'] = venv_proj_path

import json
import numpy as np
import rasterio
from rasterio.transform import from_origin
import geopandas as gpd
from shapely.geometry import Polygon

from cropping_intensity_intelligence import run_cropping_intensity_analysis

def create_mock_tif(path, width, height, value_generator, transform, crs):
    data = value_generator(height, width).astype(np.uint8)
    meta = {
        'driver': 'GTiff',
        'dtype': 'uint8',
        'nodata': 0,
        'width': width,
        'height': height,
        'count': 1,
        'crs': crs,
        'transform': transform
    }
    with rasterio.open(path, 'w', **meta) as dst:
        dst.write(data, 1)

def run_test():
    print("=== STARTING CROPPING INTENSITY VERIFICATION ===")
    
    # 1. Create a workspace directory and seasonal mock folders
    test_dir = os.path.normpath(os.path.join(os.path.dirname(__file__), "test_runs"))
    os.makedirs(test_dir, exist_ok=True)
    
    boundary_name = "TestRegion"
    year = 2024
    
    # Paths
    kharif_dir = os.path.join(test_dir, f"{boundary_name}_Kharif_{year}")
    rabi_dir = os.path.join(test_dir, f"{boundary_name}_Rabi_{year}")
    zaid_dir = os.path.join(test_dir, f"{boundary_name}_Zaid_{year}")
    annual_dir = os.path.join(test_dir, f"{boundary_name}_Annual_{year}")
    
    os.makedirs(kharif_dir, exist_ok=True)
    os.makedirs(rabi_dir, exist_ok=True)
    os.makedirs(zaid_dir, exist_ok=True)
    os.makedirs(annual_dir, exist_ok=True)
    
    # 2. Define spatial reference
    # EPSG:32643 (UTM 43N, typical for Central/West India, e.g. Rajasthan)
    crs = "EPSG:32643"
    # Transform origin (minx, maxy)
    transform = from_origin(600000, 3000000, 10, 10) # 10m pixel size
    width, height = 200, 200
    
    # Create mock boundary
    minx, miny = 600000, 3000000 - height * 10
    maxx, maxy = 600000 + width * 10, 3000000
    poly = Polygon([(minx, miny), (minx, maxy), (maxx, maxy), (maxx, miny), (minx, miny)])
    gdf_boundary = gpd.GeoDataFrame(geometry=[poly], crs=crs)
    boundary_path = os.path.join(test_dir, "boundary.geojson")
    gdf_boundary.to_file(boundary_path, driver="GeoJSON")
    
    # 3. Create mock seasonal maps
    # Kharif: Active in left half of agricultural baseline, Rice(1) & Cotton(2)
    def kharif_mask_gen(h, w):
        mask = np.zeros((h, w), dtype=np.uint8)
        # 1 = active agri inside boundary
        mask[10:190, 10:190] = 1
        return mask
        
    def kharif_class_gen(h, w):
        crops = np.zeros((h, w), dtype=np.uint8)
        # Left half of agri is Rice (1), right half is Cotton (2)
        crops[10:190, 10:100] = 1
        crops[10:190, 100:190] = 2
        return crops

    create_mock_tif(os.path.join(kharif_dir, "Final_Agri_Land_Mask.tif"), width, height, kharif_mask_gen, transform, crs)
    create_mock_tif(os.path.join(kharif_dir, "Crop_Classification.tif"), width, height, kharif_class_gen, transform, crs)
    
    # Rabi: Active in top half of agricultural baseline, Wheat(1) & Mustard(2)
    def rabi_mask_gen(h, w):
        mask = np.zeros((h, w), dtype=np.uint8)
        mask[10:100, 10:190] = 1 # Only top half is active in Rabi
        return mask
        
    def rabi_class_gen(h, w):
        crops = np.zeros((h, w), dtype=np.uint8)
        crops[10:100, 10:100] = 1 # Wheat
        crops[10:100, 100:190] = 2 # Mustard
        return crops

    create_mock_tif(os.path.join(rabi_dir, "Final_Agri_Land_Mask.tif"), width, height, rabi_mask_gen, transform, crs)
    create_mock_tif(os.path.join(rabi_dir, "Crop_Classification.tif"), width, height, rabi_class_gen, transform, crs)
    
    # Zaid: Active in small bottom-left section, Vegetables(1)
    def zaid_mask_gen(h, w):
        mask = np.zeros((h, w), dtype=np.uint8)
        mask[120:180, 20:80] = 1 # Active in bottom left
        return mask
        
    def zaid_class_gen(h, w):
        crops = np.zeros((h, w), dtype=np.uint8)
        crops[120:180, 20:80] = 1 # Vegetables
        return crops

    create_mock_tif(os.path.join(zaid_dir, "Final_Agri_Land_Mask.tif"), width, height, zaid_mask_gen, transform, crs)
    create_mock_tif(os.path.join(zaid_dir, "Crop_Classification.tif"), width, height, zaid_class_gen, transform, crs)
    
    # 4. Trigger cropping intensity analysis generator
    print("Generating Cropping Intensity Map & Crop Rotation patterns...")
    for step in run_cropping_intensity_analysis(boundary_path, annual_dir, year):
        parsed = json.loads(step)
        print(f"[{parsed.get('status').upper()}] {parsed.get('message')}")
        
    # 5. Verify file outputs
    refined_tif = os.path.join(annual_dir, "LULC_Refined.tif")
    rotation_tif = os.path.join(annual_dir, "Crop_Rotation.tif")
    stats_json = os.path.join(annual_dir, "crop_stats.json")
    report_txt = os.path.join(annual_dir, "LULC_Extraction_Report.txt")
    
    assert os.path.exists(refined_tif), "Error: LULC_Refined.tif missing"
    assert os.path.exists(rotation_tif), "Error: Crop_Rotation.tif missing"
    assert os.path.exists(stats_json), "Error: crop_stats.json missing"
    assert os.path.exists(report_txt), "Error: LULC_Extraction_Report.txt missing"
    
    # Print out summary statistics
    with open(stats_json) as sf:
        stats = json.load(sf)
        
    print("\n=== VERIFICATION SUCCESSFUL ===")
    print(f"Total Ag area: {sum(c['area_ha'] for c in stats['crops'].values() if c['code'] <= 4)} ha")
    print("Intensity breakdown:")
    for cname, info in stats['crops'].items():
        if info['code'] <= 4:
            print(f"  - {cname}: {info['area_ha']} ha ({info['percentage']}%)")
            
    print("Rotation patterns discovered:")
    for pat, info in stats['rotation_stats'].items():
        print(f"  - {pat}: {info['area_ha']} ha ({info['percentage']}%)")
        
    print("Farms count:", len(stats.get("farm_stats", [])))
    print("Villages count:", len(stats.get("village_stats", {})))
    print("Blocks count:", len(stats.get("block_stats", {})))
    print("Districts count:", len(stats.get("district_stats", {})))

if __name__ == "__main__":
    run_test()
