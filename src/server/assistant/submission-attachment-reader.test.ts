import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { LanguageModel } from "ai";
import type { PrismaClient } from "../../generated/prisma/client";
import type { AttachmentStorage } from "../attachments/attachment-storage";
import {
  SubmissionAttachmentAccessError,
} from "../attachments/submission-attachment-access";
import type { CommandContext } from "../commands/command-context";
import { supportedAttachmentFormats } from "../../domain/submission/attachment-policy";
import {
  readSubmissionAttachmentsForSuggestion,
  SubmissionAttachmentReaderError,
} from "./submission-attachment-reader";

const database = {} as PrismaClient;
const context: CommandContext = {
  actorId: "10000000-0000-4000-8000-000000000001",
  source: "UI",
  traceId: "attachment-reader-test",
  clock: () => new Date("2026-08-29T12:00:00.000Z"),
};
const config = {
  apiKey: "test-key",
  model: "deepseek-v4-flash",
  attachmentVisionModel: "deepseek-v4-flash-vision-exp",
  approvalSecret: "s".repeat(32),
};
const imageId = "20000000-0000-4000-8000-000000000002";
const pdfId = "30000000-0000-4000-8000-000000000003";
const docId = "40000000-0000-4000-8000-000000000004";
const docxId = "50000000-0000-4000-8000-000000000005";
const scope = {
  submissionId: "60000000-0000-4000-8000-000000000006",
  submissionRevisionId: "70000000-0000-4000-8000-000000000007",
  submissionRevisionNumber: 3,
};

function bytesStream(value = "stored bytes") {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const authorize = vi.fn(async (_database, _context, input) => ({
    id: input.attachmentId,
    storageKey: `submission/${input.attachmentId}`,
    mediaType:
      input.attachmentId === imageId
        ? "image/png"
        : input.attachmentId === pdfId
          ? "application/pdf"
          : input.attachmentId === docxId
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/msword",
    originalFilename: "never-forward-this-name",
  }));
  const storage = {
    getDownload: vi.fn(async () => ({ stream: bytesStream() })),
  } as unknown as AttachmentStorage;
  return {
    storage,
    createStorage: vi.fn(() => storage),
    authorize,
    createVisionModel: vi.fn(() => ({}) as LanguageModel),
    describeImage: vi.fn(async () => "表格显示教学楼差值为 6.7。"),
    extractDocxText: vi.fn(async () => "学生在文档中解释了节水建议。"),
    ...overrides,
  };
}

describe("submission attachment suggestion reader", () => {
  it("re-authorizes every formal attachment and returns only bounded evidence", async () => {
    const deps = dependencies();
    const result = await readSubmissionAttachmentsForSuggestion(
      database,
      context,
      config,
      scope,
      [
        { id: imageId, kind: "IMAGE", mediaType: "image/png" },
        {
          id: docxId,
          kind: "WORD",
          mediaType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
      deps,
    );

    expect(deps.authorize).toHaveBeenCalledTimes(2);
    expect(deps.authorize).toHaveBeenNthCalledWith(
      1,
      database,
      context,
      { attachmentId: imageId, ...scope },
    );
    expect(result).toEqual([
      {
        attachmentId: imageId,
        status: "READABLE",
        method: "VISION",
        content: "表格显示教学楼差值为 6.7。",
        truncated: false,
        note: null,
      },
      {
        attachmentId: docxId,
        status: "READABLE",
        method: "DOCX_TEXT",
        content: "学生在文档中解释了节水建议。",
        truncated: false,
        note: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("never-forward-this-name");
  });

  it("marks PDFs and legacy doc files as unreadable without guessing", async () => {
    const deps = dependencies();
    const result = await readSubmissionAttachmentsForSuggestion(
      database,
      context,
      config,
      scope,
      [
        { id: pdfId, kind: "PDF", mediaType: "application/pdf" },
        { id: docId, kind: "WORD", mediaType: "application/msword" },
      ],
      deps,
    );

    expect(result).toEqual([
      expect.objectContaining({
        attachmentId: pdfId,
        status: "UNREADABLE",
        method: "UNSUPPORTED",
        note: expect.stringContaining("PDF"),
      }),
      expect.objectContaining({
        attachmentId: docId,
        status: "UNREADABLE",
        method: "UNSUPPORTED",
        note: expect.stringContaining(".doc"),
      }),
    ]);
    expect(deps.storage.getDownload).toHaveBeenCalledOnce();
    expect(deps.extractDocxText).not.toHaveBeenCalled();
  });

  // The assistant tells teachers which attachments it can read before anyone
  // opens one, from the format catalogue rather than from this file. If the two
  // ever disagree the assistant promises a reading that never happens.
  it("reads exactly the formats the policy catalogue says it reads", async () => {
    const readable = supportedAttachmentFormats.filter(
      (format) => format.assistantReading !== "NONE",
    );
    const unreadable = supportedAttachmentFormats.filter(
      (format) => format.assistantReading === "NONE",
    );

    expect(unreadable.map((format) => format.mediaType).sort()).toEqual(
      ["application/msword", "application/pdf"].sort(),
    );
    expect(
      readable.every((format) =>
        format.kind === "IMAGE"
          ? format.assistantReading === "VISION"
          : format.assistantReading === "DOCX_TEXT",
      ),
    ).toBe(true);
  });

  it("re-authorizes before reporting unavailable storage", async () => {
    const deps = dependencies({ createStorage: vi.fn(() => null) });
    const result = await readSubmissionAttachmentsForSuggestion(
      database,
      context,
      config,
      scope,
      [{ id: imageId, kind: "IMAGE", mediaType: "image/png" }],
      deps,
    );

    expect(deps.authorize).toHaveBeenCalledOnce();
    expect(result[0]).toMatchObject({
      attachmentId: imageId,
      status: "UNREADABLE",
      method: "FAILED",
    });
  });

  it("turns an attachment authorization failure into resource-level not-found", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => {
        throw new SubmissionAttachmentAccessError("NOT_FOUND");
      }),
    });

    await expect(
      readSubmissionAttachmentsForSuggestion(
        database,
        context,
        config,
        scope,
        [{ id: imageId, kind: "IMAGE", mediaType: "image/png" }],
        deps,
      ),
    ).rejects.toEqual(new SubmissionAttachmentReaderError("NOT_FOUND"));
  });

  it("truncates extracted text by Unicode code point", async () => {
    const deps = dependencies({
      extractDocxText: vi.fn(async () => "水".repeat(12_001)),
    });
    const [result] = await readSubmissionAttachmentsForSuggestion(
      database,
      context,
      config,
      scope,
      [
        {
          id: docxId,
          kind: "WORD",
          mediaType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
      deps,
    );

    expect(result?.status).toBe("READABLE");
    expect(result?.truncated).toBe(true);
    expect([...(result?.content ?? "")]).toHaveLength(12_000);
  });
});
