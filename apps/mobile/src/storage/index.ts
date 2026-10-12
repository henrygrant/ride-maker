import { FileSystemInterface } from "./file-system-interface";
import { GpxImportService } from "./import-service";
import { LocalRouteStorage } from "./local-route-storage";
import { ExpoSQLiteRouteDb } from "./sqlite-db";
import type { LocalRouteDb } from "./types";

export * from "./file-system-interface";
export * from "./import-service";
export * from "./local-route-storage";
export * from "./sqlite-db";
export * from "./types";
export * from "./test-observation";

export function createDefaultLocalStorage(options?: {
  db?: LocalRouteDb;
  fs?: FileSystemInterface;
  baseDir?: string;
}): {
  storage: LocalRouteStorage;
  importService: GpxImportService;
  fs: FileSystemInterface;
} {
  let fs = options?.fs;
  if (!fs) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fs = require("expo-file-system/legacy") as FileSystemInterface;
  }

  let db = options?.db;
  if (!db) {
    db = new ExpoSQLiteRouteDb();
  }

  const storage = new LocalRouteStorage(db, fs, options?.baseDir);
  const importService = new GpxImportService(storage, fs);

  return { storage, importService, fs };
}
