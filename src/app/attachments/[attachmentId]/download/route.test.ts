import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createStorage: vi.fn(),
  createDownload: vi.fn(),
  createContext: vi.fn(),
  getDatabaseClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock(
  "../../../../server/attachments/vercel-blob-attachment-storage",
  () => ({ createAttachmentStorageFromEnvironment: mocks.createStorage }),
);
vi.mock("../../../../server/attachments/submission-attachment-service", () => ({
  createSubmissionAttachmentDownload: mocks.createDownload,
}));
vi.mock("../../../../server/commands/create-ui-command-context", () => ({
  createUiCommandContext: mocks.createContext,
}));
vi.mock("../../../../server/db/client", () => ({
  getDatabaseClient: mocks.getDatabaseClient,
}));

import { GET } from "./route";

const attachmentId = "10000000-0000-4000-8000-000000000001";

function respondWith(mediaType: string, originalFilename: string) {
  mocks.createDownload.mockResolvedValue({
    attachment: { mediaType, originalFilename },
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
  });
  return GET(new Request("https://example.test/attachments/x/download"), {
    params: Promise.resolve({ attachmentId }),
  });
}

describe("GET /attachments/[attachmentId]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createStorage.mockReturnValue({});
    mocks.createContext.mockResolvedValue({ source: "UI", actorId: "actor" });
  });

  it.each([
    ["image/jpeg", "photo.jpg"],
    ["image/png", "chart.png"],
    ["image/webp", "sheet.webp"],
    ["application/pdf", "report.pdf"],
  ])("offers %s for viewing in place", async (mediaType, filename) => {
    const response = await respondWith(mediaType, filename);

    expect(response.headers.get("content-disposition")).toMatch(/^inline;/u);
    expect(response.headers.get("content-type")).toBe(mediaType);
  });

  it.each([
    ["application/msword", "plan.doc"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "plan.docx",
    ],
  ])("hands %s over as a download", async (mediaType, filename) => {
    const response = await respondWith(mediaType, filename);

    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/u);
  });

  it("never renders a media type it does not recognise", async () => {
    // A format that reached storage before it reached the policy table must not
    // become renderable by default.
    const response = await respondWith("text/html", "note.html");

    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/u);
  });

  it("sandboxes every response, downloads included", async () => {
    // Rendering a student's upload means running their bytes on our origin, and
    // a download can still be opened in a tab — so the header is not conditional
    // on the disposition.
    for (const mediaType of ["application/pdf", "application/msword"]) {
      const policy = (await respondWith(mediaType, "file.bin")).headers.get(
        "content-security-policy",
      );

      expect(policy).toContain("sandbox");
      expect(policy).toContain("object-src 'none'");
    }
  });

  it("keeps the filename intact for a non-ASCII name", async () => {
    const response = await respondWith("application/pdf", "调查记录表.pdf");

    expect(response.headers.get("content-disposition")).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent("调查记录表.pdf")}`,
    );
  });

  it("says nothing about an attachment the actor may not read", async () => {
    const { SubmissionAttachmentAccessError } = await import(
      "../../../../server/attachments/submission-attachment-access"
    );
    mocks.createDownload.mockRejectedValue(
      new SubmissionAttachmentAccessError("NOT_FOUND"),
    );

    const response = await GET(
      new Request("https://example.test/attachments/x/download"),
      { params: Promise.resolve({ attachmentId }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "NOT_FOUND" });
  });

  it("reports storage that is not configured as unavailable, not missing", async () => {
    mocks.createStorage.mockReturnValue(null);

    const response = await GET(
      new Request("https://example.test/attachments/x/download"),
      { params: Promise.resolve({ attachmentId }) },
    );

    expect(response.status).toBe(503);
  });
});
