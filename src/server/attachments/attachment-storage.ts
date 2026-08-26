import "server-only";

export type StoredAttachmentObject = Readonly<{
  mediaType: string;
  byteSize: number;
}>;

export type StoredAttachmentDownload = Readonly<{
  stream: ReadableStream<Uint8Array>;
}>;

export type AttachmentScanDecision = "PENDING" | "READY" | "REJECTED";

export interface AttachmentStorage {
  inspectObject(storageKey: string): Promise<StoredAttachmentObject>;
  getScanDecision(storageKey: string): Promise<AttachmentScanDecision>;
  getDownload(storageKey: string): Promise<StoredAttachmentDownload>;
}
