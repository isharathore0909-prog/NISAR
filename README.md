# RS-AIMS (Rajasthan Agriculture Information Management System)

A high-fidelity geospatial intelligence platform for automated agriculture land extraction using Google Earth Engine and AI.

## 🚀 Quick Start

### 1. Frontend Setup
```bash
npm install
npm run electron:dev
```

### 2. Backend Setup (Python)
The application uses a local Python virtual environment to run the analysis engine.

```bash
cd python
# Create venv if not exists5
python -m venv venv
# Activate venv
.\venv\Scripts\activate
# Install dependencies
pip install -r requirements.txt
```

### 🌍 Google Earth Engine (GEE)
You must have a valid GEE project ID. Update the `PROJECT_ID` in `python/app.py`:
```python
PROJECT_ID = "your-project-id-here"
```

## 🛠️ Tech Stack
- **Frontend**: React + Vite + Tailwind CSS + Framer Motion
- **Map Engine**: Leaflet + React-Leaflet
- **Backend**: Flask + Python
- **GIS Libraries**: Rasterio, GeoPandas, Shapely
- **Data Source**: Google Earth Engine (Sentinel-2)

## 📁 Key Files
- `python/app.py`: Flask entry point & API.
- `python/download_imagery.py`: Earth Engine download logic (tiered cloud search).
- `python/agri_process.py`: AI extraction logic (Temporal NDVI Analysis).
- `src/pages/Home.jsx`: Modern glassmorphism landing page.
- `src/pages/IntelligenceWorkspace.jsx`: Main mapping and analysis hub.

## ⚠️ Troubleshooting
If you see "Cannot find module" errors in your IDE:
1. Ensure your Python interpreter is set to `python/venv/Scripts/python.exe`.
2. Run `pip install -r requirements.txt` within the activated venv.
3. Restart your IDE or the Python Language Server.
