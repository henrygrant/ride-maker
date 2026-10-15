import type { PreparedEdge, SpatialGridIndex } from "./types.js";

const DEFAULT_CELL_SIZE_DEGREES = 0.05; // max accepted edge crosses only a few dozen cells
const METERS_PER_LATITUDE_DEGREE = 111_132;
const EQUATORIAL_METERS_PER_LONGITUDE_DEGREE = 111_320;
const TO_RADIANS = Math.PI / 180;

function cellKey(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}

/**
 * Coordinate-based Amanatides-Woo traversal. It follows the actual fractional
 * endpoint coordinates, visiting both side cells at corner crossings. A line
 * coincident with a grid boundary is added to both adjacent cell strips.
 */
function getIntersectedCells(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  cellSize: number,
): readonly { readonly cx: number; readonly cy: number }[] {
  const dx = endX - startX;
  const dy = endY - startY;
  let cx = Math.floor(startX / cellSize);
  let cy = Math.floor(startY / cellSize);
  const endCellX = Math.floor(endX / cellSize);
  const endCellY = Math.floor(endY / cellSize);
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const tDeltaX = dx === 0 ? Infinity : cellSize / Math.abs(dx);
  const tDeltaY = dy === 0 ? Infinity : cellSize / Math.abs(dy);
  let tMaxX = dx === 0 ? Infinity : (((stepX > 0 ? (cx + 1) * cellSize : cx * cellSize) - startX) / dx);
  let tMaxY = dy === 0 ? Infinity : (((stepY > 0 ? (cy + 1) * cellSize : cy * cellSize) - startY) / dy);
  const cells = new Map<string, { readonly cx: number; readonly cy: number }>();
  const add = (x: number, y: number) => cells.set(cellKey(x, y), { cx: x, cy: y });
  add(cx, cy);

  // Preparation caps edges to one degree and uses a fixed 0.05-degree grid.
  // The loop therefore has a small deterministic upper bound and never truncates.
  while (cx !== endCellX || cy !== endCellY) {
    const epsilon = 1e-12 * Math.max(1, Math.abs(tMaxX), Math.abs(tMaxY));
    if (Math.abs(tMaxX - tMaxY) <= epsilon) {
      add(cx + stepX, cy);
      add(cx, cy + stepY);
      cx += stepX;
      cy += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      add(cx, cy);
    } else if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
      add(cx, cy);
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
      add(cx, cy);
    }
  }

  // Endpoints on a boundary touch the cell on both sides, including when the
  // segment approaches the boundary from the negative direction.
  const addBoundaryNeighbors = (x: number, y: number) => {
    const gx = x / cellSize;
    const gy = y / cellSize;
    const ix = Math.round(gx);
    const iy = Math.round(gy);
    if (Math.abs(gx - ix) < 1e-10) add(ix - 1, Math.floor(gy));
    if (Math.abs(gy - iy) < 1e-10) add(Math.floor(gx), iy - 1);
    if (Math.abs(gx - ix) < 1e-10 && Math.abs(gy - iy) < 1e-10) add(ix - 1, iy - 1);
  };
  addBoundaryNeighbors(startX, startY);
  addBoundaryNeighbors(endX, endY);

  // A line lying exactly on a grid boundary intersects both adjacent strips.
  if (dx === 0 && Math.abs(startX / cellSize - Math.round(startX / cellSize)) < 1e-10) {
    for (const cell of [...cells.values()]) if (cell.cx === Math.floor(startX / cellSize)) add(cell.cx - 1, cell.cy);
  }
  if (dy === 0 && Math.abs(startY / cellSize - Math.round(startY / cellSize)) < 1e-10) {
    for (const cell of [...cells.values()]) if (cell.cy === Math.floor(startY / cellSize)) add(cell.cx, cell.cy - 1);
  }
  return [...cells.values()];
}

export function buildSpatialGridIndex(
  edges: readonly PreparedEdge[],
  cellSizeDegrees = DEFAULT_CELL_SIZE_DEGREES,
): SpatialGridIndex {
  const map = new Map<string, number[]>();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!edge) continue;

    const cells = getIntersectedCells(
      edge.start.longitude,
      edge.start.latitude,
      edge.end.longitude,
      edge.end.latitude,
      cellSizeDegrees,
    );

    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c]!;
      const key = cellKey(cell.cx, cell.cy);
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(edge.edgeIndex);
    }
  }

  return {
    cellSizeDegrees,
    cells: map,
  };
}

export function queryCandidateEdgeIndices(
  index: SpatialGridIndex,
  latitude: number,
  longitude: number,
  radiusMeters: number,
): readonly number[] {
  return queryCandidateEdgeIndicesBounded(index, latitude, longitude, radiusMeters, Number.MAX_SAFE_INTEGER).edgeIndices;
}

export type BoundedCandidateQuery = {
  readonly edgeIndices: readonly number[];
  readonly workCount: number;
  readonly limitExceeded: boolean;
};

/** Counts both empty grid-cell probes and edge-reference enumeration. */
export function queryCandidateEdgeIndicesBounded(
  index: SpatialGridIndex,
  latitude: number,
  longitude: number,
  radiusMeters: number,
  maxWork: number,
): BoundedCandidateQuery {
  const latDelta = radiusMeters / METERS_PER_LATITUDE_DEGREE;
  const metersPerLon = Math.max(
    1000,
    Math.cos(latitude * TO_RADIANS) * EQUATORIAL_METERS_PER_LONGITUDE_DEGREE,
  );
  const lonDelta = radiusMeters / metersPerLon;

  const minCellX = Math.floor(
    (longitude - lonDelta) / index.cellSizeDegrees,
  );
  const maxCellX = Math.floor(
    (longitude + lonDelta) / index.cellSizeDegrees,
  );
  const minCellY = Math.floor(
    (latitude - latDelta) / index.cellSizeDegrees,
  );
  const maxCellY = Math.floor(
    (latitude + latDelta) / index.cellSizeDegrees,
  );

  const seen = new Set<number>();
  const results: number[] = [];
  let workCount = 0;
  let limitExceeded = false;

  for (let cx = minCellX; cx <= maxCellX && !limitExceeded; cx++) {
    for (let cy = minCellY; cy <= maxCellY && !limitExceeded; cy++) {
      if (workCount >= maxWork) {
        limitExceeded = true;
        break;
      }
      workCount++;
      const list = index.cells.get(cellKey(cx, cy));
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        if (workCount >= maxWork) {
          limitExceeded = true;
          break;
        }
        workCount++;
        const edgeIndex = list[i];
        if (edgeIndex !== undefined && !seen.has(edgeIndex)) {
          seen.add(edgeIndex);
          results.push(edgeIndex);
        }
      }
    }
  }

  return { edgeIndices: results, workCount, limitExceeded };
}
