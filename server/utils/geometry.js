import wellknown from 'wellknown';

export class GeometryParser {
  static parseWKT(wktString) {
    try {
      if (!wktString || typeof wktString !== 'string') {
        return null;
      }

      const trimmed = wktString.trim();
      if (!trimmed) {
        return null;
      }

      const geojson = wellknown.parse(trimmed);
      return geojson;
    } catch (error) {
      console.error('Error parsing WKT:', error);
      return null;
    }
  }

  static parseGeoJSON(geojsonString) {
    try {
      if (typeof geojsonString === 'object') {
        return geojsonString;
      }

      if (typeof geojsonString === 'string') {
        const parsed = JSON.parse(geojsonString);
        if (parsed.type && (parsed.coordinates || parsed.geometries)) {
          return parsed;
        }
      }

      return null;
    } catch (error) {
      console.error('Error parsing GeoJSON:', error);
      return null;
    }
  }

  static parseLatLng(lat, lng) {
    try {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);

      if (isNaN(latitude) || isNaN(longitude)) {
        return null;
      }

      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return null;
      }

      return {
        type: 'Point',
        coordinates: [longitude, latitude]
      };
    } catch (error) {
      console.error('Error parsing lat/lng:', error);
      return null;
    }
  }

  static autoDetectGeometry(value, latColumn = null, lngColumn = null, record = null) {
    if (!value && (!latColumn || !lngColumn || !record)) {
      return null;
    }

    if (latColumn && lngColumn && record) {
      const lat = record[latColumn];
      const lng = record[lngColumn];
      if (lat && lng) {
        return this.parseLatLng(lat, lng);
      }
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (trimmed.startsWith('POINT') ||
          trimmed.startsWith('LINESTRING') ||
          trimmed.startsWith('POLYGON') ||
          trimmed.startsWith('MULTIPOINT') ||
          trimmed.startsWith('MULTILINESTRING') ||
          trimmed.startsWith('MULTIPOLYGON')) {
        return this.parseWKT(trimmed);
      }

      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return this.parseGeoJSON(trimmed);
      }
    }

    if (typeof value === 'object' && value.type) {
      return value;
    }

    return null;
  }

  static toWKT(geojson) {
    try {
      if (!geojson || !geojson.type) {
        return null;
      }

      return wellknown.stringify(geojson);
    } catch (error) {
      console.error('Error converting to WKT:', error);
      return null;
    }
  }

  static validateGeometry(geometry) {
    if (!geometry || !geometry.type) {
      return false;
    }

    const validTypes = [
      'Point', 'LineString', 'Polygon',
      'MultiPoint', 'MultiLineString', 'MultiPolygon',
      'GeometryCollection'
    ];

    if (!validTypes.includes(geometry.type)) {
      return false;
    }

    if (geometry.type !== 'GeometryCollection' && !geometry.coordinates) {
      return false;
    }

    if (geometry.type === 'GeometryCollection' && !Array.isArray(geometry.geometries)) {
      return false;
    }

    return true;
  }

  static getBounds(geometry) {
    if (!geometry || !this.validateGeometry(geometry)) {
      return null;
    }

    const coords = this.extractCoordinates(geometry);
    if (!coords || coords.length === 0) {
      return null;
    }

    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);

    return {
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats)
    };
  }

  static extractCoordinates(geometry) {
    if (!geometry) return [];

    switch (geometry.type) {
      case 'Point':
        return [geometry.coordinates];
      case 'LineString':
      case 'MultiPoint':
        return geometry.coordinates;
      case 'Polygon':
      case 'MultiLineString':
        return geometry.coordinates.flat();
      case 'MultiPolygon':
        return geometry.coordinates.flat(2);
      case 'GeometryCollection':
        return geometry.geometries.flatMap(g => this.extractCoordinates(g));
      default:
        return [];
    }
  }
}
