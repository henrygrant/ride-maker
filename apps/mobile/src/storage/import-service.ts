import {
  GpxParseError,
  MAX_GPX_BYTES,
  calculateRouteDistanceMeters,
  parseGpx,
} from "@ride-maker/gpx";
import type { FileSystemInterface } from "./file-system-interface";
import type { LocalRouteStorage } from "./local-route-storage";
import { GpxImportError, type LocalRouteRecord } from "./types";

export type ImportGpxOptions = {
  filename?: string | undefined;
};

export class GpxImportService {
  constructor(
    private readonly storage: LocalRouteStorage,
    private readonly fs: FileSystemInterface,
  ) {}

  async importFromUri(
    sourceUri: string,
    options: ImportGpxOptions = {},
  ): Promise<LocalRouteRecord> {
    // 1. Storage must be initialized (and orphans reconciled) before any staging work begins
    await this.storage.init();

    // 2. Validate source file accessibility and bounds BEFORE any read or copy operation
    const sourceInfo = await this.fs.getInfoAsync(sourceUri);
    if (!sourceInfo.exists) {
      throw new GpxImportError("Could not access the selected file.");
    }
    if (
      typeof sourceInfo.size !== "number" ||
      !Number.isFinite(sourceInfo.size) ||
      sourceInfo.size < 0
    ) {
      throw new GpxImportError("Could not determine file size.");
    }
    if (sourceInfo.size === 0) {
      throw new GpxImportError("The GPX file is empty.");
    }
    if (sourceInfo.size > MAX_GPX_BYTES) {
      throw new GpxImportError("The GPX file exceeds the 10 MiB limit.");
    }

    const stagingDir = this.storage.getStagingDir();
    const tempId = `staging-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const tempDir = `${stagingDir}/${tempId}`;
    const tempFile = `${tempDir}/input.gpx`;

    let tempDirCreated = false;

    try {
      await this.fs.makeDirectoryAsync(tempDir, { intermediates: true });
      tempDirCreated = true;

      // Copy source to private staging to isolate from source and establish trustworthy size
      if (this.fs.copyAsync) {
        await this.fs.copyAsync({ from: sourceUri, to: tempFile });
      } else {
        const content = await this.fs.readAsStringAsync(sourceUri);
        await this.fs.writeAsStringAsync(tempFile, content);
      }

      // Check size on the private staged copy before reading
      const info = await this.fs.getInfoAsync(tempFile);
      if (!info.exists) {
        throw new GpxImportError("Could not access the selected file.");
      }

      if (typeof info.size !== "number" || !Number.isFinite(info.size) || info.size < 0) {
        throw new GpxImportError("Could not determine file size.");
      }

      if (info.size === 0) {
        throw new GpxImportError("The GPX file is empty.");
      }

      if (info.size > MAX_GPX_BYTES) {
        throw new GpxImportError("The GPX file exceeds the 10 MiB limit.");
      }

      // Read string content for XML parsing only (byte-exact copy is preserved from tempFile)
      let gpxString = await this.fs.readAsStringAsync(tempFile);
      // Strip UTF-8 BOM if present for XML parser without modifying staged bytes
      if (gpxString.charCodeAt(0) === 0xfeff) {
        gpxString = gpxString.slice(1);
      }

      if (/<!DOCTYPE/i.test(gpxString) || /<!ENTITY/i.test(gpxString)) {
        throw new GpxImportError("DTD and entity declarations are not permitted.");
      }

      let document;
      try {
        document = parseGpx(gpxString, {
          ...(options.filename !== undefined ? { filename: options.filename } : {}),
        });
      } catch (cause) {
        if (cause instanceof GpxParseError) {
          throw new GpxImportError(cause.message);
        }
        throw new GpxImportError(
          cause instanceof Error ? cause.message : "Failed to parse GPX document.",
        );
      }

      const distanceMeters = calculateRouteDistanceMeters(document);
      // Note: do not fabricate durationSeconds or summary here per product brief

      const record = await this.storage.saveImportedRoute({
        stagedGpxPath: tempFile,
        document,
        ...(options.filename !== undefined ? { originalFilename: options.filename } : {}),
        distanceMeters,
      });

      return record;
    } finally {
      if (tempDirCreated) {
        try {
          await this.fs.deleteAsync(tempDir, { idempotent: true });
        } catch {
          // Ignore staging cleanup errors
        }
      }

      // Clean up owned picker cache copy ONLY if sourceUri is verified to be under app-private cacheDirectory
      try {
        const cacheRoot = this.fs.cacheDirectory ? normalize(this.fs.cacheDirectory) : null;
        if (
          cacheRoot &&
          (sourceUri.startsWith(`${cacheRoot}/`) || sourceUri === cacheRoot)
        ) {
          await this.fs.deleteAsync(sourceUri, { idempotent: true });
        }
      } catch {
        // Non-fatal if picker cache cleanup fails
      }
    }
  }
}

function normalize(path: string): string {
  return path.replace(/\/+$/u, "");
}
