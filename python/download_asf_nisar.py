"""
NASA Space Apps Challenge: Dancing with the SARs
Automated ASF / NASA Earthdata NISAR Data Downloader
"""

import os
import requests
import json
import getpass

CMR_GRANULES_URL = "https://cmr.earthdata.nasa.gov/search/granules.json"
GCOV_COLLECTION_ID = "C2854338529-ASF"  # NISAR Provisional Geocoded Polarimetric Covariance Product

def search_nisar_granules(collection_id=GCOV_COLLECTION_ID, limit=5):
    """Searches NASA CMR for available NISAR Level-2 GCOV granules."""
    params = {
        "echo_collection_id": collection_id,
        "page_size": limit
    }
    resp = requests.get(CMR_GRANULES_URL, params=params)
    resp.raise_for_status()
    data = resp.json()
    
    granules = []
    for entry in data.get("feed", {}).get("entry", []):
        title = entry.get("title")
        h5_links = [l["href"] for l in entry.get("links", []) if l.get("href", "").endswith(".h5")]
        if h5_links:
            granules.append({"title": title, "url": h5_links[0]})
    return granules

def download_file_with_auth(url, output_path, username, password):
    """Downloads an authenticated NASA Earthdata granule."""
    session = requests.Session()
    session.auth = (username, password)
    
    print(f"Connecting to: {url}...")
    with session.get(url, stream=True) as r:
        if r.status_code == 401:
            raise PermissionError("NASA Earthdata authentication failed. Please check your username/password.")
        r.raise_for_status()
        
        total_size = int(r.headers.get('content-length', 0))
        print(f"Downloading {total_size / (1024*1024):.2f} MB to {output_path}...")
        
        with open(output_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024*1024):
                if chunk:
                    f.write(chunk)
    print(f"Download complete: {output_path}")

if __name__ == "__main__":
    print("=== NASA Earthdata NISAR Granule Search ===")
    granules = search_nisar_granules()
    for idx, g in enumerate(granules):
        print(f"[{idx+1}] {g['title']}")
        print(f"    URL: {g['url']}")
    
    # Prompt for credentials when user wants to download
    print("\nTo download a granule, run this script interactively or set your NASA Earthdata credentials.")

