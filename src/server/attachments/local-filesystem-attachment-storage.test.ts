import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createLocalAttachmentStorageFromEnvironment,
  LocalFilesystemAttachmentStorage,
} from "./local-filesystem-attachment-storage";

const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const storageKey = "submissions/abc/def";

let root: string;
let storage: LocalFilesystemAttachmentStorage;

async function drain(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
  }
  return total;
}

describe("LocalFilesystemAttachmentStorage", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cdas-attachments-"));
    storage = new LocalFilesystemAttachmentStorage({ root });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores bytes and reports back what the upload declared", async () => {
    await storage.putObject(storageKey, pngBytes, "image/png");

    // The finalize step compares this against the reservation, so a filesystem
    // that forgot the declared type would make that comparison meaningless.
    await expect(storage.inspectObject(storageKey)).resolves.toEqual({
      byteSize: pngBytes.byteLength,
      mediaType: "image/png",
    });
  });

  it("survives a restart, because the declared type lives beside the bytes", async () => {
    await storage.putObject(storageKey, pngBytes, "image/png");

    const restarted = new LocalFilesystemAttachmentStorage({ root });

    await expect(restarted.inspectObject(storageKey)).resolves.toMatchObject({
      mediaType: "image/png",
    });
  });

  it("accepts bytes whose signature matches the declared type", async () => {
    await storage.putObject(storageKey, pngBytes, "image/png");

    await expect(storage.getScanDecision(storageKey)).resolves.toBe("READY");
  });

  it("rejects a file renamed into a type it is not", async () => {
    // The whole point of the check: a PNG uploaded as a PDF must not pass.
    await storage.putObject(storageKey, pngBytes, "application/pdf");

    await expect(storage.getScanDecision(storageKey)).resolves.toBe("REJECTED");
  });

  it("rejects an object whose declared type was never recorded", async () => {
    await writeFile(join(root, "orphan"), pngBytes);

    await expect(storage.getScanDecision("orphan")).resolves.toBe("REJECTED");
  });

  it("rejects a key with nothing behind it", async () => {
    await expect(storage.getScanDecision(storageKey)).resolves.toBe("REJECTED");
  });

  it("streams the stored bytes back", async () => {
    await storage.putObject(storageKey, pngBytes, "image/png");

    const { stream } = await storage.getDownload(storageKey);

    await expect(drain(stream)).resolves.toBe(pngBytes.byteLength);
  });

  it("refuses to overwrite a key that was already written", async () => {
    await storage.putObject(storageKey, pngBytes, "image/png");

    // A key is reserved once. A second write is a replay or a collision, and
    // silently replacing a student's evidence would be the worst response.
    await expect(
      storage.putObject(storageKey, pngBytes, "image/png"),
    ).rejects.toThrow();
    await expect(readFile(join(root, storageKey))).resolves.toHaveLength(
      pngBytes.byteLength,
    );
  });

  it.each([
    ["../escape"],
    ["submissions/../../escape"],
    ["submissions/./../../etc/passwd"],
  ])("refuses to resolve %s outside its root", async (key) => {
    await expect(storage.getDownload(key)).rejects.toThrow(
      "ATTACHMENT_STORAGE_KEY_OUTSIDE_ROOT",
    );
  });

  it("reports no download for a key that was never stored", async () => {
    await expect(storage.getDownload(storageKey)).rejects.toThrow(
      "ATTACHMENT_OBJECT_NOT_FOUND",
    );
  });
});

describe("createLocalAttachmentStorageFromEnvironment", () => {
  it("stays off until both the switch and a directory are set", () => {
    expect(createLocalAttachmentStorageFromEnvironment({})).toBeNull();
    expect(
      createLocalAttachmentStorageFromEnvironment({
        ATTACHMENT_STORAGE_ENABLED: "1",
      }),
    ).toBeNull();
    expect(
      createLocalAttachmentStorageFromEnvironment({
        ATTACHMENT_STORAGE_DIR: "/var/tmp/cdas",
      }),
    ).toBeNull();
  });

  it("comes up when the deployment asked for it", () => {
    expect(
      createLocalAttachmentStorageFromEnvironment({
        ATTACHMENT_STORAGE_ENABLED: "1",
        ATTACHMENT_STORAGE_DIR: "/var/tmp/cdas",
      }),
    ).toBeInstanceOf(LocalFilesystemAttachmentStorage);
  });
});
