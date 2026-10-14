async function sha256Hex(content: string): Promise<string> {
  const buffer = new TextEncoder().encode(content);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
import { describe, expect, it, vi } from "vitest";
import {
  GpxImportError,
  InMemoryFileSystem,
  InMemoryRouteDb,
  LocalRouteStorage,
  SavedRouteCorruptError,
  SavedRouteNotFoundError,
  createDefaultLocalStorage,
  type LocalRouteDb,
} from "./index";

const VALID_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Morning Loop</name>
    <trkseg>
      <trkpt lat="40.7128" lon="-74.0060" />
      <trkpt lat="40.7138" lon="-74.0070" />
    </trkseg>
  </trk>
</gpx>`;

const SEGMENTED_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Segmented Ride</name>
    <trkseg>
      <trkpt lat="40.7000" lon="-74.0000" />
      <trkpt lat="40.7100" lon="-74.0000" />
    </trkseg>
    <trkseg>
      <trkpt lat="40.7500" lon="-74.0000" />
      <trkpt lat="40.7600" lon="-74.0000" />
    </trkseg>
  </trk>
</gpx>`;

describe("LocalRouteStorage & GpxImportService", () => {
  it("successfully imports, durably writes assets, commits SQLite row, and preserves original GPX bytes", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { storage, importService } = createDefaultLocalStorage({ fs, db });

    const sourceUri = `${fs.documentDirectory}test-upload.gpx`;
    await fs.writeAsStringAsync(sourceUri, VALID_GPX);

    const record = await importService.importFromUri(sourceUri, {
      filename: "test-upload.gpx",
    });

    expect(record.name).toBe("Morning Loop");
    expect(record.segmentCount).toBe(1);
    expect(record.pointCount).toBe(2);
    expect(record.distanceMeters).toBeGreaterThan(0);

    // Verify DB record
    const listed = await storage.listRoutes();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(record.id);

    // Verify loaded route and exact byte preservation
    const loaded = await storage.getRoute(record.id);
    expect(loaded.record.id).toBe(record.id);
    expect(loaded.document.name).toBe("Morning Loop");
    expect(loaded.originalGpx).toBe(VALID_GPX);
  });

  it("preserves exact byte hash for UTF-8 BOM and non-ASCII native content", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { storage, importService } = createDefaultLocalStorage({ fs, db });

    // UTF-8 BOM + Non-ASCII characters (German umlauts, french accents, emojis)
    const bomGpx = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="BOM Test 🚴‍♀️" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>München Über Berg Straße — Café René</name>
    <trkseg>
      <trkpt lat="48.1351" lon="11.5820" />
      <trkpt lat="48.1375" lon="11.5755" />
    </trkseg>
  </trk>
</gpx>`;

    const sourceUri = `${fs.documentDirectory}bom-intl.gpx`;
    await fs.writeAsStringAsync(sourceUri, bomGpx);

    const record = await importService.importFromUri(sourceUri, {
      filename: "bom-intl.gpx",
    });

    const loaded = await storage.getRoute(record.id);
    expect(loaded.document.name).toBe("München Über Berg Straße — Café René");

    const sourceHash = await sha256Hex(bomGpx);
    const loadedHash = await sha256Hex(loaded.originalGpx);
    expect(loadedHash).toBe(sourceHash);
  });

  it("calculates distance without bridging gaps in segmented GPX", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { importService } = createDefaultLocalStorage({ fs, db });

    const sourceUri = `${fs.documentDirectory}segmented.gpx`;
    await fs.writeAsStringAsync(sourceUri, SEGMENTED_GPX);

    const record = await importService.importFromUri(sourceUri);
    expect(record.segmentCount).toBe(2);
    expect(record.pointCount).toBe(4);

    // Segment 1 is 0.0100 deg lat ~ 1111.9m
    // Segment 2 is 0.0100 deg lat ~ 1111.9m
    // Total distance should be ~2223.9m, NOT ~6670m!
    expect(record.distanceMeters).toBeCloseTo(2223.9, -1);
    expect(record.distanceMeters).toBeLessThan(3000);
  });

  it("rolls back written files if database commit fails", async () => {
    const fs = new InMemoryFileSystem();
    const failingDb: LocalRouteDb = {
      init: async () => {},
      insertRoute: async () => {
        throw new Error("Simulated SQLite write error");
      },
      updateRouteName: async () => {},
      listRoutes: async () => [],
      getRoute: async () => null,
      deleteRoute: async () => {},
      close: async () => {},
    };

    const { importService } = createDefaultLocalStorage({ fs, db: failingDb });
    const sourceUri = `${fs.documentDirectory}rollback.gpx`;
    await fs.writeAsStringAsync(sourceUri, VALID_GPX);

    await expect(importService.importFromUri(sourceUri)).rejects.toThrow(
      "Simulated SQLite write error",
    );

    // Verify no files remain under storage data
    const docFiles = Array.from(fs["files"].keys());
    const dataFiles = docFiles.filter((f) => f.includes("/local_routes/data/"));
    expect(dataFiles).toHaveLength(0);
  });

  it("cleans staging orphans on storage initialization", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const storage = new LocalRouteStorage(db, fs);

    // Simulate an interrupted import leaving files in _staging
    const orphanDir = `${storage.getStagingDir()}/stale-temp`;
    await fs.makeDirectoryAsync(orphanDir, { intermediates: true });
    await fs.writeAsStringAsync(`${orphanDir}/stale.gpx`, "orphaned bytes");

    expect((await fs.getInfoAsync(`${orphanDir}/stale.gpx`)).exists).toBe(true);

    // Initialize storage
    await storage.init();

    // Verify stale staging files were cleaned
    expect((await fs.getInfoAsync(`${orphanDir}/stale.gpx`)).exists).toBe(false);
  });

  it("throws actionable SavedRouteCorruptError when snapshot is corrupt without breaking other routes", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { storage, importService } = createDefaultLocalStorage({ fs, db });

    // Save route 1
    const uri1 = `${fs.documentDirectory}r1.gpx`;
    await fs.writeAsStringAsync(uri1, VALID_GPX);
    const r1 = await importService.importFromUri(uri1);

    // Save route 2
    const uri2 = `${fs.documentDirectory}r2.gpx`;
    await fs.writeAsStringAsync(uri2, VALID_GPX);
    const r2 = await importService.importFromUri(uri2);

    // Corrupt snapshot of route 1
    await fs.writeAsStringAsync(r1.snapshotPath, "invalid json {}");

    // Route 1 throws actionable SavedRouteCorruptError
    await expect(storage.getRoute(r1.id)).rejects.toThrow(SavedRouteCorruptError);
    await expect(storage.getRoute(r1.id)).rejects.toThrow(
      "Could not open saved route: route data is missing or corrupted.",
    );

    // Route 2 still loads normally!
    const loaded2 = await storage.getRoute(r2.id);
    expect(loaded2.record.id).toBe(r2.id);
    expect(loaded2.document.name).toBe("Morning Loop");
  });

  it("throws SavedRouteCorruptError when snapshot or original GPX is missing from disk", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { storage, importService } = createDefaultLocalStorage({ fs, db });

    const uri = `${fs.documentDirectory}missing-test.gpx`;
    await fs.writeAsStringAsync(uri, VALID_GPX);
    const record = await importService.importFromUri(uri);

    // Delete snapshot
    await fs.deleteAsync(record.snapshotPath);
    await expect(storage.getRoute(record.id)).rejects.toThrow(SavedRouteCorruptError);

    // Restore snapshot, delete original GPX
    await fs.writeAsStringAsync(record.snapshotPath, JSON.stringify({
      schemaVersion: 1,
      id: record.id,
      name: "Test",
      source: { kind: "gpx" },
      segments: [{ id: "s1", points: [{ latitude: 40, longitude: -74 }, { latitude: 40.1, longitude: -74 }] }],
      controlPoints: [],
      waypoints: [],
      maneuvers: [],
    }));
    await fs.deleteAsync(record.originalGpxPath);
    await expect(storage.getRoute(record.id)).rejects.toThrow(SavedRouteCorruptError);
  });

  it("rejects unsupported local record versions and mismatched IDs", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { storage, importService } = createDefaultLocalStorage({ fs, db });

    const uri = `${fs.documentDirectory}version-test.gpx`;
    await fs.writeAsStringAsync(uri, VALID_GPX);
    const record = await importService.importFromUri(uri);

    // Mismatched ID inside snapshot
    const snap = JSON.parse(await fs.readAsStringAsync(record.snapshotPath));
    snap.id = "different-route-id";
    await fs.writeAsStringAsync(record.snapshotPath, JSON.stringify(snap));
    await expect(storage.getRoute(record.id)).rejects.toThrow(SavedRouteCorruptError);

    // Restore ID, update DB version to unsupported
    snap.id = record.id;
    await fs.writeAsStringAsync(record.snapshotPath, JSON.stringify(snap));
    const rawDbRecord = (await db.getRoute(record.id))!;
    await db.insertRoute({ ...rawDbRecord, version: 999 });
    await expect(storage.getRoute(record.id)).rejects.toThrow("Unsupported local route record version: 999");
  });

  it("throws SavedRouteNotFoundError when route id is not in database", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { storage } = createDefaultLocalStorage({ fs, db });

    await expect(storage.getRoute("non-existent-id")).rejects.toThrow(
      SavedRouteNotFoundError,
    );
  });

  it("rejects files with missing or nonfinite size without reading", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { importService } = createDefaultLocalStorage({ fs, db });

    const uri = `${fs.documentDirectory}nonfinite.gpx`;
    await fs.writeAsStringAsync(uri, VALID_GPX);

    // Mock getInfoAsync to return undefined size
    const origGetInfo = fs.getInfoAsync.bind(fs);
    fs.getInfoAsync = async (path) => {
      const res = await origGetInfo(path);
      return { exists: res.exists, ...(res.isDirectory !== undefined ? { isDirectory: res.isDirectory } : {}) };
    };

    const readSpy = vi.spyOn(fs, "readAsStringAsync");

    await expect(importService.importFromUri(uri)).rejects.toThrow(
      "Could not determine file size.",
    );
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("rejects files with negative size without reading", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { importService } = createDefaultLocalStorage({ fs, db });

    const uri = `${fs.documentDirectory}negative.gpx`;
    await fs.writeAsStringAsync(uri, VALID_GPX);

    const origGetInfo = fs.getInfoAsync.bind(fs);
    fs.getInfoAsync = async (path) => {
      const res = await origGetInfo(path);
      return { exists: res.exists, size: -1, ...(res.isDirectory !== undefined ? { isDirectory: res.isDirectory } : {}) };
    };

    const readSpy = vi.spyOn(fs, "readAsStringAsync");

    await expect(importService.importFromUri(uri)).rejects.toThrow(
      "Could not determine file size.",
    );
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("accepts file at the exact 10 MiB limit boundary", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { storage, importService } = createDefaultLocalStorage({ fs, db });

    // Build a valid GPX document of exactly 10 * 1024 * 1024 bytes (10,485,760 bytes)
    const exact10MiB = 10 * 1024 * 1024;
    const prefix = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Boundary"><trk><name>10MiB Boundary Ride</name><trkseg><trkpt lat="40.71" lon="-74.00"/><trkpt lat="40.72" lon="-74.00"/></trkseg></trk><!-- `;
    const suffix = ` --></gpx>`;
    const paddingLength = exact10MiB - (prefix.length + suffix.length);
    const paddedContent = prefix + "A".repeat(paddingLength) + suffix;
    expect(paddedContent.length).toBe(exact10MiB);

    const sourceUri = `${fs.documentDirectory}exact-10mib.gpx`;
    await fs.writeAsStringAsync(sourceUri, paddedContent);

    const record = await importService.importFromUri(sourceUri);
    expect(record.name).toBe("10MiB Boundary Ride");
    expect((await storage.getRoute(record.id)).record.id).toBe(record.id);
  });

  it("rejects file exceeding the 10 MiB limit by 1 byte before parsing without reading", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { importService } = createDefaultLocalStorage({ fs, db });

    // 10 MiB + 1 byte
    const oversizedLength = 10 * 1024 * 1024 + 1;
    const oversizedContent = "A".repeat(oversizedLength);
    const sourceUri = `${fs.documentDirectory}oversized-by-one.gpx`;
    await fs.writeAsStringAsync(sourceUri, oversizedContent);

    const readSpy = vi.spyOn(fs, "readAsStringAsync");

    await expect(importService.importFromUri(sourceUri)).rejects.toThrow(GpxImportError);
    await expect(importService.importFromUri(sourceUri)).rejects.toThrow(
      "The GPX file exceeds the 10 MiB limit.",
    );
    expect(readSpy).not.toHaveBeenCalled();
  });

  it("rejects empty files", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { importService } = createDefaultLocalStorage({ fs, db });

    const sourceUri = `${fs.documentDirectory}empty.gpx`;
    await fs.writeAsStringAsync(sourceUri, "");

    await expect(importService.importFromUri(sourceUri)).rejects.toThrow(
      "The GPX file is empty.",
    );
  });

  it("rejects files with DTD or entity declarations", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { importService } = createDefaultLocalStorage({ fs, db });

    const dtdContent = `<!DOCTYPE gpx [ <!ENTITY test "attack"> ]><gpx></gpx>`;
    const sourceUri = `${fs.documentDirectory}dtd.gpx`;
    await fs.writeAsStringAsync(sourceUri, dtdContent);

    await expect(importService.importFromUri(sourceUri)).rejects.toThrow(
      "DTD and entity declarations are not permitted.",
    );
  });

  it("rejects single-point GPX files", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { importService } = createDefaultLocalStorage({ fs, db });

    const singlePointGpx = `<gpx version="1.1"><trk><trkseg><trkpt lat="40.7" lon="-74.0"/></trkseg></trk></gpx>`;
    const sourceUri = `${fs.documentDirectory}single.gpx`;
    await fs.writeAsStringAsync(sourceUri, singlePointGpx);

    await expect(importService.importFromUri(sourceUri)).rejects.toThrow(
      "requires at least two distinct points",
    );
  });

  it("cleans picker cache files only when verified under app-private cache directory", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { importService } = createDefaultLocalStorage({ fs, db });

    // File 1: inside cache directory
    const cachedPickerUri = `${fs.cacheDirectory}picker-temp-1.gpx`;
    await fs.writeAsStringAsync(cachedPickerUri, VALID_GPX);
    await importService.importFromUri(cachedPickerUri);
    expect((await fs.getInfoAsync(cachedPickerUri)).exists).toBe(false);

    // File 2: outside cache directory with "/cache/" substring in path
    const externalUri = `${fs.documentDirectory}other/cache/user-external-ride.gpx`;
    await fs.makeDirectoryAsync(`${fs.documentDirectory}other/cache`, { intermediates: true });
    await fs.writeAsStringAsync(externalUri, VALID_GPX);
    await importService.importFromUri(externalUri);
    expect((await fs.getInfoAsync(externalUri)).exists).toBe(true);
  });

  it("preserves valid existing route assets if a repeated save or ID collision fails", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { storage, importService } = createDefaultLocalStorage({ fs, db });

    const sourceUri = `${fs.documentDirectory}ride1.gpx`;
    await fs.writeAsStringAsync(sourceUri, VALID_GPX);
    const existing = await importService.importFromUri(sourceUri);

    // Verify existing assets exist
    expect((await fs.getInfoAsync(existing.originalGpxPath)).exists).toBe(true);
    expect((await fs.getInfoAsync(existing.snapshotPath)).exists).toBe(true);

    // Attempt to save again with the same ID, but make DB insert fail
    const insertOrig = db.insertRoute.bind(db);
    db.insertRoute = async (rec) => {
      if (rec.id === existing.id) throw new Error("Unique constraint violation");
      return insertOrig(rec);
    };

    const existingLoaded = await storage.getRoute(existing.id);
    await expect(
      storage.saveImportedRoute({
        gpxContent: VALID_GPX,
        document: existingLoaded.document,
        distanceMeters: existing.distanceMeters,
      }),
    ).rejects.toThrow("already exists");

    // Existing route assets must NOT have been deleted!
    expect((await fs.getInfoAsync(existing.originalGpxPath)).exists).toBe(true);
    expect((await fs.getInfoAsync(existing.snapshotPath)).exists).toBe(true);
    const reloaded = await storage.getRoute(existing.id);
    expect(reloaded.record.id).toBe(existing.id);
  });

  it("createDefaultLocalStorage throws when native modules are unavailable instead of silently falling back", () => {
    // Calling without options in this environment (where expo-file-system is not installed natively) throws
    expect(() => createDefaultLocalStorage()).toThrow();
  });
});
