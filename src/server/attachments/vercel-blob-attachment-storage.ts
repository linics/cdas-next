import "server-only";

import { get, head } from "@vercel/blob";
import { z } from "zod";
import type {
  AttachmentScanDecision,
  AttachmentStorage,
  StoredAttachmentDownload,
  StoredAttachmentObject,
} from "./attachment-storage";
import { isExpectedSignature, readPrefix } from "./attachment-signature";

const configurationSchema = z.strictObject({
  storeId: z.string().trim().min(1),
});

type VercelBlobStorageConfiguration = z.infer<typeof configurationSchema>;
type BlobHead = typeof head;
type BlobGet = typeof get;

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
