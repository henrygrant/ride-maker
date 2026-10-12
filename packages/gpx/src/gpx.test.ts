import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GpxParseError,
  MAX_GEOMETRY_POINTS,
  calculateRouteDistanceMeters,
  distanceBetweenCoordinates,
  parseGpx,
  serializeGpx,
} from "./index";

const loadFixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parseGpx", () => {
  it("imports tracks, segments, metadata, elevation, times, and waypoints", () => {
    const document = parseGpx(loadFixture("multi-segment.gpx"), {
      filename: "fallback-name.gpx",
    });

    expect(document.name).toBe("River loop");
    expect(document.description).toBe("A short test ride");
    expect(document.source).toMatchObject({
      kind: "gpx",
      filename: "fallback-name.gpx",
      creator: "Fixture Creator",
    });
    expect(document.segments).toHaveLength(2);
    expect(document.segments[0]?.points[0]).toMatchObject({
      latitude: 40.7,
      longitude: -74.01,
      elevationMeters: 4.5,
      time: "2026-09-27T12:00:00Z",
    });
    expect(document.controlPoints.map((point) => point.kind)).toEqual([
      "start",
      "finish",
    ]);
    expect(document.waypoints[0]).toMatchObject({
      name: "Coffee",
      description: "Regroup here",
      elevationMeters: 8.2,
    });
  });

  it("imports a GPX route when no track is present", () => {
    const document = parseGpx(loadFixture("route-only.gpx"));

    expect(document.name).toBe("Three stops");
    expect(document.segments).toHaveLength(1);
    expect(document.segments[0]?.points).toHaveLength(3);
    expect(document.controlPoints.map((point) => point.kind)).toEqual([
      "start",
      "via",
      "finish",
    ]);
    expect(document.controlPoints[1]?.name).toBe("Bakery");
  });

  it("preserves separate segments for multiple GPX routes without connecting them", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <name>Leg 1</name>
    <rtept lat="40.7000" lon="-74.0000" />
    <rtept lat="40.7100" lon="-74.0000" />
  </rte>
  <rte>
    <name>Leg 2</name>
    <rtept lat="40.7500" lon="-74.0000" />
    <rtept lat="40.7600" lon="-74.0000" />
  </rte>
</gpx>`;
    const document = parseGpx(xml);
    expect(document.segments).toHaveLength(2);
    expect(document.segments[0]!.points).toHaveLength(2);
    expect(document.segments[1]!.points).toHaveLength(2);
    expect(document.segments[0]!.points[1]!.latitude).toBe(40.71);
    expect(document.segments[1]!.points[0]!.latitude).toBe(40.75);
  });

  it("preserves track geometry and route control points in mixed GPX files", () => {
    const mixedXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Detailed Track</name>
    <trkseg>
      <trkpt lat="40.70" lon="-74.00" />
      <trkpt lat="40.71" lon="-74.00" />
      <trkpt lat="40.72" lon="-74.00" />
    </trkseg>
  </trk>
  <rte>
    <name>Route Cue Points</name>
    <rtept lat="40.70" lon="-74.00"><name>Turn 1</name></rtept>
    <rtept lat="40.72" lon="-74.00"><name>Turn 2</name></rtept>
  </rte>
</gpx>`;
    const document = parseGpx(mixedXml);
    // Geometry comes from track
    expect(document.segments).toHaveLength(1);
    expect(document.segments[0]!.points).toHaveLength(3);
    // Control points come from route
    expect(document.controlPoints).toHaveLength(2);
    expect(document.controlPoints[0]!.name).toBe("Turn 1");
    expect(document.controlPoints[1]!.name).toBe("Turn 2");
  });

  it("falls back to route geometry when track exists but has no points", () => {
    const emptyTrackXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Empty Track</name>
    <trkseg></trkseg>
  </trk>
  <rte>
    <name>Valid Route</name>
    <rtept lat="40.70" lon="-74.00" />
    <rtept lat="40.72" lon="-74.00" />
  </rte>
</gpx>`;
    const document = parseGpx(emptyTrackXml);
    expect(document.name).toBe("Valid Route");
    expect(document.segments).toHaveLength(1);
    expect(document.segments[0]!.points).toHaveLength(2);
    expect(document.controlPoints).toHaveLength(2);
  });

  it("preserves loop routes and input point direction", () => {
    const loopXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Loop Ride</name>
    <trkseg>
      <trkpt lat="40.700" lon="-74.000" />
      <trkpt lat="40.710" lon="-74.000" />
      <trkpt lat="40.710" lon="-74.010" />
      <trkpt lat="40.700" lon="-74.000" />
    </trkseg>
  </trk>
</gpx>`;
    const document = parseGpx(loopXml);
    const points = document.segments[0]!.points;
    expect(points).toHaveLength(4);
    // Preserves exact loop closure
    expect(points[0]!.latitude).toBe(points[3]!.latitude);
    expect(points[0]!.longitude).toBe(points[3]!.longitude);
    // Direction preserved
    expect(points[0]!.latitude).toBe(40.700);
    expect(points[1]!.latitude).toBe(40.710);
    expect(points[2]!.longitude).toBe(-74.010);
  });

  it("falls back to filename and default name when name tags are missing or blank", () => {
    const blankNameXml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>   </name>
    <trkseg>
      <trkpt lat="40.70" lon="-74.00" />
      <trkpt lat="40.71" lon="-74.00" />
    </trkseg>
  </trk>
</gpx>`;
    const withFilename = parseGpx(blankNameXml, { filename: "my-gravel-route.gpx" });
    expect(withFilename.name).toBe("my-gravel-route");

    const noFilename = parseGpx(blankNameXml);
    expect(noFilename.name).toBe("Imported route");
  });

  it("rejects DTD and entity declarations", () => {
    const dtdXml = `<!DOCTYPE gpx [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<gpx version="1.1"><trk><trkseg><trkpt lat="40.7" lon="-74.0"/><trkpt lat="40.8" lon="-74.0"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(dtdXml)).toThrow(GpxParseError);
    expect(() => parseGpx(dtdXml)).toThrow("DTD and entity declarations are not permitted.");
  });

  it("rejects missing, blank, or non-numeric coordinate attributes", () => {
    const missingLat = `<gpx version="1.1"><trk><trkseg><trkpt lon="-74.0"/><trkpt lat="40.8" lon="-74.0"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(missingLat)).toThrow("Missing or blank latitude value");

    const blankLat = `<gpx version="1.1"><trk><trkseg><trkpt lat="" lon="-74.0"/><trkpt lat="40.8" lon="-74.0"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(blankLat)).toThrow("Missing or blank latitude value");

    const whitespaceLat = `<gpx version="1.1"><trk><trkseg><trkpt lat="   " lon="-74.0"/><trkpt lat="40.8" lon="-74.0"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(whitespaceLat)).toThrow("Missing or blank latitude value");

    const nonNumericLon = `<gpx version="1.1"><trk><trkseg><trkpt lat="40.7" lon="abc"/><trkpt lat="40.8" lon="-74.0"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(nonNumericLon)).toThrow("Invalid longitude value");
  });

  it("rejects out-of-range coordinates", () => {
    const outOfRangeLat = `<gpx version="1.1"><trk><trkseg><trkpt lat="95.0" lon="-74.0"/><trkpt lat="40.8" lon="-74.0"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(outOfRangeLat)).toThrow("Invalid latitude value");

    const outOfRangeLon = `<gpx version="1.1"><trk><trkseg><trkpt lat="40.7" lon="195.0"/><trkpt lat="40.8" lon="-74.0"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(outOfRangeLon)).toThrow("Invalid longitude value");
  });

  it("rejects files without usable geometry (fewer than two distinct points)", () => {
    const onePoint = `<gpx version="1.1"><trk><trkseg><trkpt lat="40.7" lon="-74.0"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(onePoint)).toThrow("requires at least two distinct points");

    const identicalPoints = `<gpx version="1.1"><trk><trkseg><trkpt lat="40.7" lon="-74.0"/><trkpt lat="40.7" lon="-74.0"/></trkseg></trk></gpx>`;
    expect(() => parseGpx(identicalPoints)).toThrow("requires at least two distinct points");
  });

  it("enforces exact 100,000 points limit boundary", () => {
    // Fast generator with custom point count (ensuring 2 distinct points for valid geometry)
    const generatePts = (count: number) => {
      return (
        `<gpx version="1.1"><trk><trkseg><trkpt lat="40.7" lon="-74.0"/><trkpt lat="40.8" lon="-74.0"/>` +
        `<trkpt lat="40.8" lon="-74.0"/>`.repeat(Math.max(0, count - 2)) +
        `</trkseg></trk></gpx>`
      );
    };

    // Exactly 100,000 points parses successfully
    const doc100k = parseGpx(generatePts(100_000));
    expect(doc100k.segments[0]!.points).toHaveLength(MAX_GEOMETRY_POINTS);

    // 100,001 points is rejected
    expect(() => parseGpx(generatePts(100_001))).toThrow(
      "Route exceeds the maximum limit of 100,000 points.",
    );
  }, 30000);

  it("rejects malformed and empty GPX files", () => {
    expect(() => parseGpx("<gpx><trk>")).toThrow(GpxParseError);
    expect(() => parseGpx('<gpx version="1.1"></gpx>')).toThrow(
      "does not contain a track or route",
    );
  });
});

describe("distanceBetweenCoordinates & calculateRouteDistanceMeters", () => {
  it("calculates accurate geodesic distance for known test cases including antimeridian", () => {
    // 1. One degree of longitude along the equator:
    // Earth radius = 6,371,000m -> circumference = 2 * PI * 6,371,000 ~ 40,030,173.6m
    // 1 deg = 40,030,173.6 / 360 ~ 111,194.9m
    const equator1Deg = distanceBetweenCoordinates(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );
    expect(equator1Deg).toBeCloseTo(111_195, -1);

    // 2. Antimeridian crossing: from 179.9° to -179.9° (0.2° difference) along equator
    // Distance should be ~22,239m, NOT ~40,000,000m!
    const antimeridianDist = distanceBetweenCoordinates(
      { latitude: 0, longitude: 179.9 },
      { latitude: 0, longitude: -179.9 },
    );
    expect(antimeridianDist).toBeCloseTo(22_239, -1);
    expect(antimeridianDist).toBeLessThan(25_000);

    // 3. Long leg: 60 degrees along a meridian from equator to latitude 60°
    // 60 / 360 * 2 * PI * 6,371,000 ~ 6,671,697m
    const longLeg = distanceBetweenCoordinates(
      { latitude: 0, longitude: 0 },
      { latitude: 60, longitude: 0 },
    );
    expect(longLeg).toBeCloseTo(6_671_697, -3);
  });

  it("sums distances within segments and excludes gaps between segments", () => {
    const document = parseGpx(loadFixture("multi-segment.gpx"));
    const totalDistance = calculateRouteDistanceMeters(document);

    const d1 = distanceBetweenCoordinates(
      document.segments[0]!.points[0]!,
      document.segments[0]!.points[1]!,
    );
    const d2 = distanceBetweenCoordinates(
      document.segments[1]!.points[0]!,
      document.segments[1]!.points[1]!,
    );
    const gap = distanceBetweenCoordinates(
      document.segments[0]!.points[1]!,
      document.segments[1]!.points[0]!,
    );

    expect(totalDistance).toBeCloseTo(d1 + d2, 1);
    expect(totalDistance).not.toBeCloseTo(d1 + d2 + gap, 1);
  });
});

describe("serializeGpx", () => {
  it("round-trips the standard route data through GPX", () => {
    const original = parseGpx(loadFixture("multi-segment.gpx"));
    const xml = serializeGpx(original);
    const roundTripped = parseGpx(xml);

    expect(xml).toContain('version=\"1.1\"');
    expect(xml).toContain('creator=\"Ride Maker\"');
    expect(roundTripped.name).toBe(original.name);
  });
});
