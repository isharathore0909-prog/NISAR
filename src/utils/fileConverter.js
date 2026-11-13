
import shp from "shpjs";
import * as toGeoJSON from "@tmcw/togeojson";
import JSZip from "jszip";

export const convertToGeoJSON = async (file) => {
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith(".geojson") || fileName.endsWith(".json")) {
    const text = await file.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error("Invalid JSON/GeoJSON syntax.");
    }
  }

  if (fileName.endsWith(".kml")) {
    const text = await file.text();
    return parseKML(text);
  }

  if (fileName.endsWith(".kmz")) {
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const kmlFile = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith(".kml"));
    if (!kmlFile) throw new Error("No KML file found inside KMZ");
    const kmlText = await kmlFile.async("string");
    return parseKML(kmlText);
  }

  if (fileName.endsWith(".zip")) {
    try {
      const buffer = await file.arrayBuffer();
      return await shp(buffer);
    } catch (err) {
      const msg = err.message || "";
      if (msg.includes("DataView") || msg.includes("offset") || msg.includes("bounds") || msg.includes("outside")) {
        throw new Error("Invalid shapefile ZIP. Ensure the ZIP archive contains all mandatory shapefile components (.shp, .shx, and .dbf) and is not corrupted.");
      }
      throw err;
    }
  }

  throw new Error("Unsupported format. Please upload a KML, KMZ, GeoJSON (.geojson/.json), or a zipped Shapefile (.zip containing .shp, .shx, and .dbf).");
};

const parseKML = (text) => {
  const parser = new DOMParser();
  const kml = parser.parseFromString(text, "text/xml");
  return toGeoJSON.kml(kml);
};
