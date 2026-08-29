import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createStorage: vi.fn(),
  createContext: vi.fn(),
  getDatabaseClient: vi.fn(),
  getWritable: vi.fn(),
  putObject: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../../../server/attachments/attachment-storage-factory", () => ({
  createServerReceivedAttachmentStorage: mocks.createStorage,
}));
vi.mock("../../../server/attachments/submission-attachment-access", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../server/attachments/submission-attachment-access")
  >();
  return {
    ...actual,
    getWritableSubmissionAttachmentStorageRecord: mocks.getWritable,
  };
});
vi.mock("../../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: mocks.createContext,
}));
vi.mock("../../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));

import { AuthenticationError } from "../../../server/auth/current-actor";
import { MAX_ATTACHMENT_BYTES } from "../../../domain/submission/attachment-policy";
import { POST } from "./route";

const attachmentId = "10000000-0000-4000-8000-000000000001";
const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function uploadRequest(file = new File([bytes], "browser-name.png", {
  type: "application/octet-stream",
})) {
  const form = new FormData();
  form.set("attachmentId", attachmentId);
  form.set("file", file);
  return new Request("https://example.test/attachments/receive", {
    method: "POST",
    body: form,
  });
}

describe("POST /attachments/receive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createStorage.mockReturnValue({ putObject: mocks.putObject });
    mocks.createContext.mockResolvedValue({ source: "UI", actorId: "actor" });
    mocks.getDatabaseClient.mockReturnValue({ kind: "database" });
    mocks.getWritable.mockResolvedValue({
      id: attachmentId,
      storageKey: `submissions/${attachmentId}`,
      mediaType: "image/png",
      byteSize: bytes.byteLength,
      status: "UPLOAD_PENDING",
    });
    mocks.putObject.mockResolvedValue(undefined);
  });

  it("authenticates, re-authorizes the reservation, and writes its media type", async () => {
    const response = await POST(uploadRequest());

    expect(response.status).toBe(200);
    expect(mocks.createContext).toHaveBeenCalledOnce();
    expect(mocks.getWritable).toHaveBeenCalledWith(
      { kind: "database" },
      { source: "UI", actorId: "actor" },
      { attachmentId },
    );
    expect(mocks.putObject).toHaveBeenCalledWith(
      `submissions/${attachmentId}`,
      bytes,
      "image/png",
    );
  });

  it("rejects an unauthenticated request before querying the attachment", async () => {
    mocks.createContext.mockRejectedValue(
      new AuthenticationError("UNAUTHENTICATED"),
    );

    const response = await POST(uploadRequest());

    expect(response.status).toBe(404);
    expect(mocks.getWritable).not.toHaveBeenCalled();
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("rejects an ordinary oversized multipart request before parsing it", async () => {
    const response = await POST(
      new Request("https://example.test/attachments/receive", {
        method: "POST",
        headers: {
          "content-length": String(MAX_ATTACHMENT_BYTES + 1024 * 1024 + 1),
        },
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });

  it("does not write bytes that differ from the reservation", async () => {
    mocks.getWritable.mockResolvedValue({
      id: attachmentId,
      storageKey: `submissions/${attachmentId}`,
      mediaType: "image/png",
      byteSize: bytes.byteLength + 1,
      status: "UPLOAD_PENDING",
    });

    const response = await POST(uploadRequest());

    expect(response.status).toBe(409);
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it("reports an unconfigured local backend without reading the request", async () => {
    mocks.createStorage.mockReturnValue(null);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(503);
    expect(mocks.createContext).not.toHaveBeenCalled();
    expect(mocks.getWritable).not.toHaveBeenCalled();
  });
});
