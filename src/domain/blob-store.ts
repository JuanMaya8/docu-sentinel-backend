import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Minimal key→text store. Two implementations: memory (tests) and one-file-per-key on disk. */
export interface BlobStore {
  read(key: string): Promise<string | null>;
  write(key: string, data: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(suffix: string): Promise<string[]>;
}

const SAFE_KEY = /^[A-Za-z0-9_.-]+$/;

export class MemoryBlobStore implements BlobStore {
  private readonly map = new Map<string, string>();
  async read(key: string): Promise<string | null> { return this.map.get(key) ?? null; }
  async write(key: string, data: string): Promise<void> { this.map.set(key, data); }
  async remove(key: string): Promise<void> { this.map.delete(key); }
  async list(suffix: string): Promise<string[]> { return [...this.map.keys()].filter((k) => k.endsWith(suffix)); }
}

export class FileBlobStore implements BlobStore {
  private ready: Promise<void> | null = null;
  constructor(private readonly dir: string) {}

  private async init(): Promise<void> {
    this.ready ??= mkdir(this.dir, { recursive: true }).then(() => undefined);
    return this.ready;
  }
  private path(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes('..')) throw new Error(`Clave de almacenamiento inválida: ${key}`);
    return join(this.dir, key);
  }
  async read(key: string): Promise<string | null> {
    await this.init();
    try {
      return await readFile(this.path(key), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  /** atomic: write to a temp file then rename, so a crash never leaves half a JSON */
  async write(key: string, data: string): Promise<void> {
    await this.init();
    const target = this.path(key);
    const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, target);
  }
  async remove(key: string): Promise<void> {
    await this.init();
    await rm(this.path(key), { force: true });
  }
  async list(suffix: string): Promise<string[]> {
    await this.init();
    return (await readdir(this.dir)).filter((f) => f.endsWith(suffix) && !f.endsWith('.tmp'));
  }
}
