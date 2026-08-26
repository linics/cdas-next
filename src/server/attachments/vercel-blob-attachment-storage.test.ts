import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createAttachmentStorageFromEnvironment,
  VercelBlobAttachmentStorage,
} from "./vercel-blob-attachment-storage";

function streamFor(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

describe("Vercel Blob attachment storage", () => {
  it("stays disabled until both attachment storage and its Blob store are configured", () => {
    expect(createAttachmentStorageFromEnvironment({})).toBeNull();
    expect(
      createAttachmentStorageFromEnvironment({ ATTACHMENT_STORAGE_ENABLED: "1" }),
    ).toBeNull();
    expect(
      createAttachmentStorageFromEnvironment({
        ATTACHMENT_STORAGE_ENABLED: "1",
        BLOB_STORE_ID: "store-test",
      }),
    ).toBeInstanceOf(VercelBlobAttachmentStorage);
  });

  it("inspects private Blob metadata and verifies allowed signatures", async () => {
    const blobHead = vi.fn().mockResolvedValue({
      size: 12,
      contentType: "image/png",
    });
    const blobGet = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        stream: streamFor([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        blob: { contentType: "image/png" },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        stream: streamFor([0x25, 0x50, 0x44, 0x46, 0x2d]),
        blob: { contentType: "image/png" },
      });
    const storage = new VercelBlobAttachmentStorage(
      { storeId: "store-test" },
      blobHead,
      blobGet,
    );

    await expect(storage.inspectObject("submissions/a/b")).resolves.toEqual({
      byteSize: 12,
      mediaType: "image/png",
    });
    await expect(storage.getScanDecision("submissions/a/b")).resolves.toBe("READY");
    await expect(storage.getScanDecision("submissions/a/c")).resolves.toBe("REJECTED");
    expect(blobHead).toHaveBeenCalledWith("submissions/a/b", { storeId: "store-test" });
    expect(blobGet).toHaveBeenCalledWith("submissions/a/b", {
      access: "private",
      storeId: "store-test",
      useCache: false,
    });
  });

  it.each([
    ["image/jpeg", [0xff, 0xd8, 0xff]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]],
    ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ["application/msword", [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", [0x50, 0x4b, 0x03, 0x04]],
  ])("accepts the expected %s signature", async (mediaType, bytes) => {
    const storage = new VercelBlobAttachmentStorage(
      { storeId: "store-test" },
      vi.fn(),
      vi.fn().mockResolvedValue({
        statusCode: 200,
        stream: streamFor(bytes),
        blob: { contentType: mediaType },
      }),
    );
    await expect(storage.getScanDecision("object-key")).resolves.toBe("READY");
  });

  it("streams private downloads without returning a Blob URL", async () => {
    const stream = streamFor([1, 2, 3]);
    const storage = new VercelBlobAttachmentStorage(
      { storeId: "store-test" },
      vi.fn(),
      vi.fn().mockResolvedValue({
        statusCode: 200,
        stream,
        blob: { contentType: "application/pdf" },
      }),
    );
    await expect(storage.getDownload("object-key")).resolves.toEqual({ stream });
  });
});
