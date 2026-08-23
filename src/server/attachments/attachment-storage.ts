import "server-only";

export type AttachmentUploadRequest = Readonly<{
  storageKey: string;
  mediaType: string;
  byteSize: number;
}>;

export type AttachmentUploadTarget = Readonly<{
  url: string;
  headers: Readonly<Record<string, string>>;
  expiresAt: string;
}>;

export type StoredAttachmentObject = Readonly<{
  mediaType: string;
  byteSize: number;
}>;

export type AttachmentScanDecision = "PENDING" | "READY" | "REJECTED";

export interface AttachmentStorage {
  createUploadTarget(
    request: AttachmentUploadRequest,
  ): Promise<AttachmentUploadTarget>;
  inspectObject(storageKey: string): Promise<StoredAttachmentObject>;
  getScanDecision(storageKey: string): Promise<AttachmentScanDecision>;
  createDownloadUrl(input: Readonly<{
    storageKey: string;
    mediaType: string;
    filename: string;
  }>): Promise<string>;
}
