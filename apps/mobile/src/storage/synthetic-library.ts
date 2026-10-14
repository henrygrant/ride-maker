import type { RouteDocument } from "@ride-maker/domain";
import type { LocalRouteStorage } from "./local-route-storage";

export interface SyntheticRouteDef {
  id: string;
  name: string;
  distanceMeters: number;
  durationSeconds: number;
  points: Array<[number, number]>; // [lat, lon]
}

export const SYNTHETIC_14_LIBRARY_DATA: SyntheticRouteDef[] = [
  {
    id: "synth-route-01",
    name: "Pacific Coast Highway Scenic Vista Route from San Francisco to Santa Cruz with Ocean Overlooks and Headwinds",
    distanceMeters: 125000,
    durationSeconds: 18000,
    points: [
      [37.7749, -122.4194],
      [37.563, -122.511],
      [37.386, -122.404],
      [36.9741, -122.0308],
    ],
  },
  {
    id: "synth-route-02",
    name: "Blue Ridge Parkway High Elevation Ridge Explorer with Extended Rolling Climbs",
    distanceMeters: 85000,
    durationSeconds: 14400,
    points: [
      [35.5951, -82.5515],
      [35.68, -82.42],
      [35.79, -82.26],
      [35.91, -82.05],
    ],
  },
  {
    id: "synth-route-03",
    name: "Cascades Alpine Mountain Pass Circuit Crossing High Alpine Fir Passes",
    distanceMeters: 92000,
    durationSeconds: 15200,
    points: [
      [47.6062, -122.3321],
      [47.53, -121.84],
      [47.42, -121.41],
      [47.33, -121.14],
    ],
  },
  {
    id: "synth-route-04",
    name: "Redwood Empire Coastal Rainforest Corridor Among Ancient Giant Trees",
    distanceMeters: 67000,
    durationSeconds: 11000,
    points: [
      [41.2132, -124.0046],
      [41.31, -124.03],
      [41.45, -124.06],
      [41.58, -124.08],
    ],
  },
  {
    id: "synth-route-05",
    name: "Shenandoah Skyline National Scenic Drive Covering Panoramic Valley Overlooks",
    distanceMeters: 78000,
    durationSeconds: 13500,
    points: [
      [38.8921, -78.192],
      [38.75, -78.29],
      [38.61, -78.38],
      [38.48, -78.47],
    ],
  },
  {
    id: "synth-route-06",
    name: "Finger Lakes Vineyard Ribbon Trail Circling Glacial Lake Shorelines",
    distanceMeters: 54000,
    durationSeconds: 8800,
    points: [
      [42.7284, -76.8791],
      [42.61, -76.89],
      [42.5, -76.91],
      [42.41, -76.93],
    ],
  },
  {
    id: "synth-route-07",
    name: "Great Smoky Foothills Backcountry Loop on Secluded Forest Pathways",
    distanceMeters: 46000,
    durationSeconds: 7900,
    points: [
      [35.7143, -83.5102],
      [35.65, -83.58],
      [35.58, -83.67],
      [35.51, -83.74],
    ],
  },
  {
    id: "synth-route-08",
    name: "Sonoma Valley Wine Country Gravel Traverse Along Oak-Studded Ridges",
    distanceMeters: 61000,
    durationSeconds: 9800,
    points: [
      [38.2919, -122.458],
      [38.38, -122.52],
      [38.46, -122.58],
      [38.55, -122.65],
    ],
  },
  {
    id: "synth-route-09",
    name: "Adirondack High Peaks Wilderness Century Route Around Pristine Lakes",
    distanceMeters: 104000,
    durationSeconds: 16800,
    points: [
      [44.2795, -73.9799],
      [44.18, -73.91],
      [44.07, -73.85],
      [43.96, -73.79],
    ],
  },
  {
    id: "synth-route-10",
    name: "Glacier Gateway Montana Continental Divide Challenge with Sharp Descents",
    distanceMeters: 88000,
    durationSeconds: 14900,
    points: [
      [48.4984, -114.0494],
      [48.61, -113.92],
      [48.72, -113.78],
      [48.81, -113.62],
    ],
  },
  {
    id: "synth-route-11",
    name: "Cape Cod Ocean Shore Coastal Rail Path Along Salt Marshes and Dunes",
    distanceMeters: 41000,
    durationSeconds: 6700,
    points: [
      [41.7056, -70.2286],
      [41.76, -70.12],
      [41.83, -70.02],
      [41.91, -69.97],
    ],
  },
  {
    id: "synth-route-12",
    name: "San Juan Islands Maritime Ferry Loop Connecting Hilly Rural Island Byways",
    distanceMeters: 51000,
    durationSeconds: 8600,
    points: [
      [48.5343, -123.0179],
      [48.59, -123.08],
      [48.66, -123.14],
      [48.71, -123.19],
    ],
  },
  {
    id: "synth-route-13",
    name: "Lake Superior North Shore Iron Range Route Following Rocky Coastline",
    distanceMeters: 97000,
    durationSeconds: 15900,
    points: [
      [46.7867, -92.1005],
      [46.91, -91.88],
      [47.05, -91.66],
      [47.19, -91.43],
    ],
  },
  {
    id: "synth-route-14",
    name: "Columbia River Basin Endurance Circuit Traversed Through Rolling Wheat Valleys",
    distanceMeters: 112000,
    durationSeconds: 17200,
    points: [
      [45.7126, -121.5175],
      [45.68, -121.18],
      [45.62, -120.82],
      [45.54, -120.45],
    ],
  },
];

export function buildSyntheticRouteDocument(def: SyntheticRouteDef): RouteDocument {
  const points = def.points.map(([lat, lon]) => ({ latitude: lat, longitude: lon }));
  const startPt = points[0]!;
  const finishPt = points[points.length - 1]!;

  return {
    schemaVersion: 1,
    id: def.id,
    name: def.name,
    source: { kind: "new" },
    segments: [
      {
        id: `${def.id}-seg-0`,
        points,
      },
    ],
    controlPoints: [
      {
        id: "start",
        kind: "start",
        name: "Start Location",
        latitude: startPt.latitude,
        longitude: startPt.longitude,
      },
      {
        id: "finish",
        kind: "finish",
        name: "Finish Location",
        latitude: finishPt.latitude,
        longitude: finishPt.longitude,
      },
    ],
    waypoints: [],
    maneuvers: [
      {
        id: `${def.id}-m-0`,
        segmentIndex: 0,
        shapeIndex: 0,
        instruction: "Depart start point.",
        verbalInstruction: `Depart on ${def.name.slice(0, 30)}`,
        latitude: startPt.latitude,
        longitude: startPt.longitude,
      },
      {
        id: `${def.id}-m-1`,
        segmentIndex: 0,
        shapeIndex: points.length - 1,
        instruction: "Arrive at finish.",
        verbalInstruction: "You have arrived at your destination.",
        latitude: finishPt.latitude,
        longitude: finishPt.longitude,
      },
    ],
    summary: {
      distanceMeters: def.distanceMeters,
      durationSeconds: def.durationSeconds,
    },
  };
}

/**
 * Seeds 14 synthetic routes into local storage with predictable, descending
 * createdAt timestamps strictly compatible with SQLite `createdAt DESC` ordering.
 *
 * - synth-route-01 (Pacific Coast Highway) has the latest timestamp (+120s), so it appears at top.
 * - synth-route-14 (Columbia River Basin) has the oldest timestamp (-14 days), appearing at bottom.
 * - Does not overwrite existing routes or imported fixtures.
 */
export async function seedSyntheticLibrary(storage: LocalRouteStorage): Promise<void> {
  const baseTime = Date.now();

  for (let i = 0; i < SYNTHETIC_14_LIBRARY_DATA.length; i++) {
    const def = SYNTHETIC_14_LIBRARY_DATA[i]!;

    // Skip if already in database
    const existing = await storage.getRoute(def.id).catch(() => null);
    if (existing) continue;

    // Explicitly ordered timestamp:
    // i === 0 (Pacific): baseTime + 120s (so it is strictly newer than created route)
    // i >= 1: baseTime - (i * 86_400_000) (descending into the past)
    const createdAt =
      i === 0
        ? new Date(baseTime + 120_000).toISOString()
        : new Date(baseTime - i * 86_400_000).toISOString();

    const doc = buildSyntheticRouteDocument(def);
    await storage.saveCreatedRoute(doc, { createdAt });
  }
}
