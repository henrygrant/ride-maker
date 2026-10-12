import { describe, expect, it } from "vitest";
import { InMemoryFileSystem, InMemoryRouteDb, LocalRouteStorage, SavedRouteCorruptError, createDefaultLocalStorage } from "./index";
import { parseGpx } from "@ride-maker/gpx";

const GPX = '<gpx><trk><name>Review ride</name><trkseg><trkpt lat="40" lon="-74"/><trkpt lat="40.01" lon="-74"/></trkseg></trk></gpx>';

async function setup() {
  const fs = new InMemoryFileSystem();
  const db = new InMemoryRouteDb();
  const { storage, importService } = createDefaultLocalStorage({ fs, db });
  await storage.init();
  const source = `${fs.documentDirectory}source.gpx`;
  await fs.writeAsStringAsync(source, GPX);
  return { fs, db, storage, importService, source };
}

describe("Sol task003 storage acceptance regressions", () => {
  it("removes partial assets when the second write fails", async () => {
    const { fs, storage, importService, source } = await setup();
    const write = fs.writeAsStringAsync.bind(fs);
    fs.writeAsStringAsync = async (path, content, options) => {
      if (path.endsWith('/route.json')) throw new Error('simulated full disk');
      return write(path, content, options);
    };
    await expect(importService.importFromUri(source)).rejects.toThrow('simulated full disk');
    expect(await storage.listRoutes()).toHaveLength(0);
    expect(await fs.readDirectoryAsync(`${storage.getBaseDir()}/data`)).toEqual([]);
  });

  it("rejects syntactically valid snapshots with broken segment contents", async () => {
    const { fs, storage, importService, source } = await setup();
    const record = await importService.importFromUri(source);
    const doc = JSON.parse(await fs.readAsStringAsync(record.snapshotPath));
    doc.segments = [null];
    await fs.writeAsStringAsync(record.snapshotPath, JSON.stringify(doc));
    await expect(storage.getRoute(record.id)).rejects.toThrow(SavedRouteCorruptError);
  });

  it("cleans interrupted uncommitted data assets without removing a healthy ride", async () => {
    const { fs, db, storage, importService, source } = await setup();
    const healthy = await importService.importFromUri(source);
    const interrupted = `${storage.getBaseDir()}/data/route-interrupted`;
    await fs.makeDirectoryAsync(interrupted, { intermediates: true });
    await fs.writeAsStringAsync(`${interrupted}/original.gpx`, GPX);
    const reopened = new LocalRouteStorage(db, fs);
    await reopened.init();
    expect((await fs.getInfoAsync(interrupted)).exists).toBe(false);
    expect((await reopened.getRoute(healthy.id)).record.id).toBe(healthy.id);
  });

  it("can import before any list/init call", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const { storage, importService } = createDefaultLocalStorage({ fs, db });
    const source = `${fs.documentDirectory}source.gpx`;
    await fs.writeAsStringAsync(source, GPX);
    const record = await importService.importFromUri(source);
    expect((await storage.getRoute(record.id)).originalGpx).toBe(GPX);
  });
});


describe("Sol task003 round2 recovery regressions", () => {
  it("can retry initialization after a transient database error", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    let attempts = 0;
    db.init = async () => {
      attempts++;
      if (attempts === 1) throw new Error("temporarily unavailable");
    };
    const storage = new LocalRouteStorage(db, fs);
    await expect(storage.init()).rejects.toThrow("temporarily unavailable");
    await expect(storage.init()).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it("does not deadlock saving before initialization", async () => {
    const fs = new InMemoryFileSystem();
    const db = new InMemoryRouteDb();
    const storage = new LocalRouteStorage(db, fs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const completed = storage.saveImportedRoute({
        gpxContent: GPX, document: parseGpx(GPX), distanceMeters: 1112,
      }).then(() => "saved");
      const timeout = new Promise<string>(resolve => { timer = setTimeout(() => resolve("deadlocked"), 100); });
      expect(await Promise.race([completed, timeout])).toBe("saved");
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  it("rejects malformed maneuver data before the UI builds its navigation track", async () => {
    const { fs, storage, importService, source } = await setup();
    const record = await importService.importFromUri(source);
    const doc = JSON.parse(await fs.readAsStringAsync(record.snapshotPath));
    doc.maneuvers = [null];
    await fs.writeAsStringAsync(record.snapshotPath, JSON.stringify(doc));
    await expect(storage.getRoute(record.id)).rejects.toThrow(SavedRouteCorruptError);
  });
});


describe("Sol immutable saved import", () => {
  it("rejects a repeated ID before overwriting a healthy route's assets", async () => {
    const { fs, storage, importService, source } = await setup();
    const record = await importService.importFromUri(source);
    const beforeOriginal = await fs.readAsStringAsync(record.originalGpxPath);
    const beforeSnapshot = await fs.readAsStringAsync(record.snapshotPath);
    const document = parseGpx(GPX);
    document.id = record.id;
    document.name = "Replacement must not overwrite";
    await expect(storage.saveImportedRoute({
      document, gpxContent: GPX.replace("Review ride", "Changed"), distanceMeters: 999,
    })).rejects.toThrow("already exists");
    expect(await fs.readAsStringAsync(record.originalGpxPath)).toBe(beforeOriginal);
    expect(await fs.readAsStringAsync(record.snapshotPath)).toBe(beforeSnapshot);
    expect((await storage.getRoute(record.id)).record.name).toBe(record.name);
  });
});
