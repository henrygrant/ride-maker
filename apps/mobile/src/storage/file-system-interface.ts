export interface FileSystemInterface {
  documentDirectory: string | null;
  cacheDirectory?: string | null | undefined;
  getInfoAsync(
    fileUri: string,
  ): Promise<{ exists: boolean; size?: number | undefined; isDirectory?: boolean | undefined }>;
  makeDirectoryAsync(
    fileUri: string,
    options?: { intermediates?: boolean },
  ): Promise<void>;
  readAsStringAsync(
    fileUri: string,
    options?: { encoding?: "utf8" | "base64" },
  ): Promise<string>;
  writeAsStringAsync(
    fileUri: string,
    contents: string,
    options?: { append?: boolean; encoding?: "utf8" | "base64" },
  ): Promise<void>;
  deleteAsync(
    fileUri: string,
    options?: { idempotent?: boolean },
  ): Promise<void>;
  copyAsync?(options: { from: string; to: string }): Promise<void>;
  moveAsync?(options: { from: string; to: string }): Promise<void>;
  readDirectoryAsync?(fileUri: string): Promise<string[]>;
}

export class InMemoryFileSystem implements FileSystemInterface {
  readonly documentDirectory: string | null = "file:///data/user/0/net.thg3.ridemaker/files/";
  readonly cacheDirectory: string | null = "file:///data/user/0/net.thg3.ridemaker/cache/";
  private files = new Map<string, string>();
  private directories = new Set<string>();

  constructor() {
    if (this.documentDirectory) {
      this.directories.add(normalize(this.documentDirectory));
    }
    if (this.cacheDirectory) {
      this.directories.add(normalize(this.cacheDirectory));
    }
  }

  async getInfoAsync(
    fileUri: string,
  ): Promise<{ exists: boolean; size?: number; isDirectory?: boolean }> {
    const norm = normalize(fileUri);
    if (this.files.has(norm)) {
      const content = this.files.get(norm)!;
      return {
        exists: true,
        size: new TextEncoder().encode(content).length,
        isDirectory: false,
      };
    }
    if (this.directories.has(norm)) {
      return { exists: true, isDirectory: true };
    }
    return { exists: false };
  }

  async makeDirectoryAsync(
    fileUri: string,
    _options?: { intermediates?: boolean },
  ): Promise<void> {
    const norm = normalize(fileUri);
    this.directories.add(norm);
  }

  async readAsStringAsync(
    fileUri: string,
    options?: { encoding?: "utf8" | "base64" },
  ): Promise<string> {
    const norm = normalize(fileUri);
    const content = this.files.get(norm);
    if (content === undefined) {
      throw new Error(`File not found: ${fileUri}`);
    }
    if (options?.encoding === "base64") {
      return btoa(unescape(encodeURIComponent(content)));
    }
    return content;
  }

  async writeAsStringAsync(
    fileUri: string,
    contents: string,
    options?: { append?: boolean; encoding?: "utf8" | "base64" },
  ): Promise<void> {
    const norm = normalize(fileUri);
    let str = contents;
    if (options?.encoding === "base64") {
      str = decodeURIComponent(escape(atob(contents)));
    }
    if (options?.append) {
      const existing = this.files.get(norm) ?? "";
      this.files.set(norm, existing + str);
    } else {
      this.files.set(norm, str);
    }
  }

  async deleteAsync(
    fileUri: string,
    _options?: { idempotent?: boolean },
  ): Promise<void> {
    const norm = normalize(fileUri);
    this.files.delete(norm);
    this.directories.delete(norm);
    for (const key of Array.from(this.files.keys())) {
      if (key.startsWith(norm + "/") || key.startsWith(norm)) {
        this.files.delete(key);
      }
    }
    for (const dir of Array.from(this.directories)) {
      if (dir.startsWith(norm + "/") || dir.startsWith(norm)) {
        this.directories.delete(dir);
      }
    }
  }

  async copyAsync(options: { from: string; to: string }): Promise<void> {
    const normFrom = normalize(options.from);
    const content = this.files.get(normFrom);
    if (content === undefined) {
      throw new Error(`File not found: ${options.from}`);
    }
    const normTo = normalize(options.to);
    this.files.set(normTo, content);
  }

  async moveAsync(options: { from: string; to: string }): Promise<void> {
    const normFrom = normalize(options.from);
    const content = this.files.get(normFrom);
    if (content === undefined) {
      throw new Error(`File not found: ${options.from}`);
    }
    const normTo = normalize(options.to);
    this.files.set(normTo, content);
    this.files.delete(normFrom);
  }

  async readDirectoryAsync(fileUri: string): Promise<string[]> {
    const norm = normalize(fileUri).replace(/\/+$/u, "");
    const results = new Set<string>();
    for (const f of this.files.keys()) {
      if (f.startsWith(norm + "/")) {
        const rel = f.slice(norm.length + 1).split("/")[0]!;
        results.add(rel);
      }
    }
    for (const d of this.directories) {
      if (d !== norm && d.startsWith(norm + "/")) {
        const rel = d.slice(norm.length + 1).split("/")[0]!;
        results.add(rel);
      }
    }
    return Array.from(results);
  }
}

function normalize(path: string): string {
  return path.replace(/\/+$/u, "");
}
