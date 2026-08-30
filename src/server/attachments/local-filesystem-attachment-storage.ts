import "server-only";

import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import type {
  AttachmentScanDecision,
  AttachmentStorage,
  StoredAttachmentDownload,
  StoredAttachmentObject,
} from "./attachment-storage";
import { isExpectedSignature, readPrefix } from "./attachment-signature";

const configurationSchema = z.strictObject({
  root: z.string().trim().min(1),
});

type LocalStorageConfiguration = z.infer<typeof configurationSchema>;

const sidecarSchema = z.strictObject({
  mediaType: z.string().trim().min(1),
});

/**
 * Attachment storage on the box's own disk, for the self-hosted deployment where
 * there is no Vercel Blob.
 *
 * The guarantee matches the Blob adapter's rather than weakening it. That one
 * never scanned for malware either — its terminal decision verifies the declared
 * media type against the file's own signature — and this one runs the same check
 * on the same bytes, through the same shared module.
 */
export class LocalFilesystemAttachmentStorage implements AttachmentStorage {
  constructor(private readonly configuration: LocalStorageConfiguration) {}

  /**
   * Storage keys are generated server-side, but this class holds the file handle
   * and is the last place that can tell a key from a path traversal. Resolve and
   * confirm containment rather than trusting the caller.
   */
  private resolvePath(storageKey: string): string {
    const root = resolve(this.configuration.root);
    const candidate = resolve(join(root, normalize(storageKey)));
    if (!candidate.startsWith(root + sep)) {
      throw new Error("ATTACHMENT_STORAGE_KEY_OUTSIDE_ROOT");
    }
    return candidate;
  }

  /**
   * A filesystem records no content type, but the upload finalisation compares
   * what landed against what was reserved — so what the upload declared has to
   * survive alongside the bytes. A sidecar keeps that comparison meaningful
   * across a restart, which an in-process map would not.
   */
  async putObject(
    storageKey: string,
    bytes: Uint8Array,
    declaredMediaType: string,
  ): Promise<void> {
    const path = this.resolvePath(storageKey);
    await mkdir(dirname(path), { recursive: true });
    // `wx` fails when the file exists. A storage key is reserved once, so a
    // second write to it is a replay or a collision, never an intended
    // overwrite.
    await writeFile(path, bytes, { flag: "wx" });
    await writeFile(
      `${path}.meta.json`,
      JSON.stringify({ mediaType: declaredMediaType }),
      { flag: "w" },
    );
  }

  private async readSidecar(path: string): Promise<string | null> {
    try {
      const parsed = sidecarSchema.safeParse(
        JSON.parse(await readFile(`${path}.meta.json`, "utf8")),
      );
      return parsed.success ? parsed.data.mediaType : null;
    } catch {
      return null;
    }
  }

  async inspectObject(storageKey: string): Promise<StoredAttachmentObject> {
    const path = this.resolvePath(storageKey);
    const stats = await stat(path);
    const mediaType = await this.readSidecar(path);
    if (!mediaType) {
      throw new Error("ATTACHMENT_OBJECT_NOT_FOUND");
    }
    return { byteSize: stats.size, mediaType };
  }

  async getScanDecision(storageKey: string): Promise<AttachmentScanDecision> {
    const path = this.resolvePath(storageKey);
    let declaredMediaType: string | null;
    try {
      await stat(path);
      declaredMediaType = await this.readSidecar(path);
    } catch {
      return "REJECTED";
    }
    if (!declaredMediaType) {
      return "REJECTED";
    }
    const bytes = await readPrefix(this.readStream(path));
    return isExpectedSignature(declaredMediaType, bytes) ? "READY" : "REJECTED";
  }

  async getDownload(storageKey: string): Promise<StoredAttachmentDownload> {
    const path = this.resolvePath(storageKey);
    try {
      await stat(path);
    } catch {
      throw new Error("ATTACHMENT_OBJECT_NOT_FOUND");
    }
    return { stream: this.readStream(path) };
  }

  private readStream(path: string): ReadableStream<Uint8Array> {
    return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  }
}

export function createLocalAttachmentStorageFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LocalFilesystemAttachmentStorage | null {
  if (
    environment.ATTACHMENT_STORAGE_ENABLED?.trim() !== "1" ||
    !environment.ATTACHMENT_STORAGE_DIR?.trim()
  ) {
    return null;
  }
  return new LocalFilesystemAttachmentStorage(
    configurationSchema.parse({ root: environment.ATTACHMENT_STORAGE_DIR }),
  );
}
