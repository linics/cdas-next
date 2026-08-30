import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  attachmentUploadStrategy,
  createAttachmentStorage,
} from "./attachment-storage-factory";
import { LocalFilesystemAttachmentStorage } from "./local-filesystem-attachment-storage";
import { VercelBlobAttachmentStorage } from "./vercel-blob-attachment-storage";

const local = {
  ATTACHMENT_STORAGE_ENABLED: "1",
  ATTACHMENT_STORAGE_DIR: "/var/tmp/cdas-attachments",
};
const blob = {
  ATTACHMENT_STORAGE_ENABLED: "1",
  BLOB_STORE_ID: "store_abc123",
};

describe("attachment storage selection", () => {
  it("takes bytes through the app when the backend is a local disk", () => {
    // There is nothing to presign against, so the browser cannot write directly.
    expect(attachmentUploadStrategy(local)).toBe("server-received");
    expect(createAttachmentStorage(local)).toBeInstanceOf(
      LocalFilesystemAttachmentStorage,
    );
  });

  it("lets the browser write straight to Blob when that is the backend", () => {
    expect(attachmentUploadStrategy(blob)).toBe("presigned");
    expect(createAttachmentStorage(blob)).toBeInstanceOf(
      VercelBlobAttachmentStorage,
    );
  });

  it("prefers the local disk when a deployment is given both", () => {
    // A box handed an attachment directory is meant to use it. Quietly sending
    // student files to a remote store instead would put them somewhere the
    // operator did not choose.
    const both = { ...local, ...blob };

    expect(attachmentUploadStrategy(both)).toBe("server-received");
    expect(createAttachmentStorage(both)).toBeInstanceOf(
      LocalFilesystemAttachmentStorage,
    );
  });

  it("reports no strategy at all when neither backend is configured", () => {
    // The surface uses this to say attachments are off rather than to offer a
    // picker that cannot work.
    expect(attachmentUploadStrategy({})).toBeNull();
    expect(createAttachmentStorage({})).toBeNull();
    expect(
      attachmentUploadStrategy({ ATTACHMENT_STORAGE_ENABLED: "1" }),
    ).toBeNull();
  });

  it("stays off when the switch is off, whatever else is configured", () => {
    expect(
      attachmentUploadStrategy({
        ...local,
        ...blob,
        ATTACHMENT_STORAGE_ENABLED: "0",
      }),
    ).toBeNull();
  });
});
