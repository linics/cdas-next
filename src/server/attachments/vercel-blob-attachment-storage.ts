import "server-only";

import { get, head } from "@vercel/blob";
import { z } from "zod";
import type {
  AttachmentScanDecision,
  AttachmentStorage,
  StoredAttachmentDownload,
  StoredAttachmentObject,
} from "./attachment-storage";

const configurationSchema = z.strictObject({
  storeId: z.string().trim().min(1),
});

type VercelBlobStorageConfiguration = z.infer<typeof configurationSchema>;
type BlobHead = typeof head;
type BlobGet = typeof get;

const signatureLength = 12;

function hasPrefix(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function isExpectedSignature(mediaType: string, bytes: Uint8Array): boolean {
  switch (mediaType) {
    case "image/jpeg":
      return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return (
        hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        hasPrefix(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
      );
    case "application/pdf":
      return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "application/msword":
      return hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]);
    default:
      return false;
  }
}

async function readPrefix(
  stream: ReadableStream<Uint8Array>,
  maximumBytes = signatureLength,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maximumBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maximumBytes - total;
      const chunk = value.slice(0, remaining);
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Private Blob adapter. `SCAN_PENDING` is retained as the persisted state name
 * for backwards compatibility; its terminal decision verifies declared object
 * metadata and the allowed file signature, not malware scanning.
 */
export class VercelBlobAttachmentStorage implements AttachmentStorage {
  constructor(
    private readonly configuration: VercelBlobStorageConfiguration,
    private readonly blobHead: BlobHead = head,
    private readonly blobGet: BlobGet = get,
  ) {}

  async inspectObject(storageKey: string): Promise<StoredAttachmentObject> {
    const result = await this.blobHead(storageKey, {
      storeId: this.configuration.storeId,
    });
    return {
      byteSize: result.size,
      mediaType: result.contentType,
    };
  }

  async getScanDecision(
    storageKey: string,
  ): Promise<AttachmentScanDecision> {
    const result = await this.blobGet(storageKey, {
      access: "private",
      storeId: this.configuration.storeId,
      useCache: false,
    });
    if (!result || result.statusCode !== 200) {
      return "REJECTED";
    }
    const bytes = await readPrefix(result.stream);
    return isExpectedSignature(result.blob.contentType, bytes)
      ? "READY"
      : "REJECTED";
  }

  async getDownload(storageKey: string): Promise<StoredAttachmentDownload> {
    const result = await this.blobGet(storageKey, {
      access: "private",
      storeId: this.configuration.storeId,
      useCache: false,
    });
    if (!result || result.statusCode !== 200) {
      throw new Error("ATTACHMENT_OBJECT_NOT_FOUND");
    }
    return { stream: result.stream };
  }
}

export function createAttachmentStorageFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AttachmentStorage | null {
  if (
    environment.ATTACHMENT_STORAGE_ENABLED?.trim() !== "1" ||
    !environment.BLOB_STORE_ID?.trim()
  ) {
    return null;
  }
  const configuration = configurationSchema.parse({
    storeId: environment.BLOB_STORE_ID,
  });
  return new VercelBlobAttachmentStorage(configuration);
}
