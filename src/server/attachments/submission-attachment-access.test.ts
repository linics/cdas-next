import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
import {
  getAuthorizedCurrentRevisionAttachmentDownload,
  SubmissionAttachmentAccessError,
} from "./submission-attachment-access";

const actorId = "10000000-0000-4000-8000-000000000001";
const attachmentId = "20000000-0000-4000-8000-000000000002";
const submissionId = "30000000-0000-4000-8000-000000000003";
const submissionRevisionId = "40000000-0000-4000-8000-000000000004";
const context: CommandContext = {
  actorId,
  source: "UI",
  traceId: "current-revision-attachment-access-test",
  clock: () => new Date("2026-08-29T12:00:00.000Z"),
};

function databaseFor(role: "TEACHER" | "STUDENT") {
  const findFirst = vi.fn(async () => ({
    id: attachmentId,
    storageKey: `submission/${attachmentId}`,
    mediaType: "image/png",
    originalFilename: "evidence.png",
  }));
  const database = {
    appUser: {
      findUnique: vi.fn(async () => ({
        role,
        accountStatus: "ACTIVE",
        schoolId: "50000000-0000-4000-8000-000000000005",
        school: { status: "ACTIVE" },
      })),
    },
    submissionAttachment: { findFirst },
  } as unknown as PrismaClient;
  return { database, findFirst };
}

describe("current formal revision attachment authorization", () => {
  it("binds teacher access to the exact still-current formal revision", async () => {
    const { database, findFirst } = databaseFor("TEACHER");

    await expect(
      getAuthorizedCurrentRevisionAttachmentDownload(database, context, {
        attachmentId,
        submissionId,
        submissionRevisionId,
        submissionRevisionNumber: 3,
      }),
    ).resolves.toMatchObject({ id: attachmentId });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: attachmentId,
          submissionId,
          revisions: {
            some: expect.objectContaining({
              submissionRevisionId,
              submissionRevision: expect.objectContaining({
                revisionNumber: 3,
                submission: expect.objectContaining({
                  id: submissionId,
                  latestRevisionNumber: 3,
                }),
              }),
            }),
          },
        }),
      }),
    );
  });

  it("rejects a student before looking up the attachment", async () => {
    const { database, findFirst } = databaseFor("STUDENT");

    await expect(
      getAuthorizedCurrentRevisionAttachmentDownload(database, context, {
        attachmentId,
        submissionId,
        submissionRevisionId,
        submissionRevisionNumber: 3,
      }),
    ).rejects.toEqual(new SubmissionAttachmentAccessError("FORBIDDEN"));
    expect(findFirst).not.toHaveBeenCalled();
  });
});
