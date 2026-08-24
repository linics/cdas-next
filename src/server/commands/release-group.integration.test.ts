import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/client";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import {
  getAuthorizedSubmissionAttachmentDownload,
  SubmissionAttachmentAccessError,
} from "../attachments/submission-attachment-access";
import { createDatabaseClient } from "../db/client";
import {
  FeedbackWorkspaceQueryError,
  getStudentFeedbackWorkspace,
} from "../queries/feedback-workspace";
import { getStudentReleaseWorkspace } from "../queries/submission-workspace";
import type { CommandContext } from "./command-context";
import { ManageReleaseGroupError, saveReleaseGroup } from "./manage-release-group";
import { saveSubmissionWorkingCopy } from "./save-submission-working-copy";
import { startSubmissionResubmission } from "./start-submission-resubmission";
import { reserveSubmissionAttachment } from "./submission-attachment-commands";
import {
  SubmitSubmissionRevisionError,
  submitSubmissionRevision,
} from "./submit-submission-revision";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

function context(actorId: string, now: Date): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => now };
}

async function fixture() {
  if (!database) throw new Error("TEST_DATABASE_URL is required");
  const now = new Date(Date.now() - 1_000);
  const teacherId = randomUUID();
  const studentA = randomUUID();
  const studentB = randomUUID();
  const studentC = randomUUID();
  const classroomId = randomUUID();
  await database.appUser.createMany({ data: [
    { id: teacherId, authSubject: `teacher_${teacherId}`, role: "TEACHER", displayName: "分组教师" },
    { id: studentA, authSubject: `student_${studentA}`, role: "STUDENT", displayName: "甲" },
    { id: studentB, authSubject: `student_${studentB}`, role: "STUDENT", displayName: "乙" },
    { id: studentC, authSubject: `student_${studentC}`, role: "STUDENT", displayName: "丙" },
  ] });
  await database.classroom.create({ data: { id: classroomId, name: "分组班", managerId: teacherId } });
  await database.classroomMembership.createMany({ data: [studentA, studentB, studentC].map((studentId) => ({ classroomId, studentId, joinedAt: new Date(now.getTime() - 60_000) })) });
  const published = await createPublishedActivity(database, { teacherId, classroomId, publishedAt: now });
  return { now, teacherId, studentA, studentB, studentC, releaseId: published.releaseId };
}

describeWithDatabase("release group shared submissions", () => {
  afterAll(async () => database?.$disconnect());

  it("resolves every member to one shared container and freezes its group", async () => {
    const value = await fixture();
    const group = await saveReleaseGroup(database!, context(value.teacherId, value.now), {
      releaseId: value.releaseId, groupId: null, name: "校园调查组",
      members: [{ studentId: value.studentA, roleLabel: "记录" }, { studentId: value.studentB, roleLabel: "汇报" }],
      idempotencyKey: `group_${randomUUID()}`,
    });
    const initial = await saveSubmissionWorkingCopy(database!, context(value.studentA, value.now), {
      releaseId: value.releaseId, expectedWorkingCopyId: null, expectedWorkingVersion: null,
      textEvidence: "小组共同观察记录", idempotencyKey: `save_${randomUUID()}`,
    });
    const workspace = await getStudentReleaseWorkspace(database!, context(value.studentB, value.now), { releaseId: value.releaseId });
    expect(workspace.group).toMatchObject({
      id: group.groupId,
      name: "校园调查组",
    });
    expect(workspace.group?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          student: expect.objectContaining({ id: value.studentA }),
          roleLabel: "记录",
        }),
        expect.objectContaining({
          student: expect.objectContaining({ id: value.studentB }),
          roleLabel: "汇报",
        }),
      ]),
    );
    expect(workspace.submission?.id).toBe(initial.submissionId);
    expect(workspace.submission?.workingCopy?.textEvidence).toBe("小组共同观察记录");

    const formal = await submitSubmissionRevision(
      database!,
      context(value.studentB, value.now),
      {
        releaseId: value.releaseId,
        expectedWorkingCopyId: initial.workingCopyId,
        expectedWorkingVersion: initial.workingVersion,
        idempotencyKey: `submit_${randomUUID()}`,
      },
    );
    const memberWorkspace = await getStudentReleaseWorkspace(
      database!,
      context(value.studentA, value.now),
      { releaseId: value.releaseId },
    );
    expect(memberWorkspace.submission?.id).toBe(initial.submissionId);
    expect(memberWorkspace.submission?.revisions).toMatchObject([
      { id: formal.revisionId, revisionNumber: 1 },
    ]);
    const resubmission = await startSubmissionResubmission(
      database!,
      context(value.studentA, value.now),
      {
        releaseId: value.releaseId,
        expectedLatestRevisionNumber: formal.revisionNumber,
        idempotencyKey: `resubmit_${randomUUID()}`,
      },
    );
    const attachment = await reserveSubmissionAttachment(database!, context(value.studentB, value.now), {
      releaseId: value.releaseId,
      expectedWorkingCopyId: resubmission.workingCopyId,
      expectedWorkingVersion: resubmission.workingVersion,
      filename: "共同证据.pdf",
      mediaType: "application/pdf",
      byteSize: 1024,
      idempotencyKey: `attachment_${randomUUID()}`,
    });
    expect(await database!.submissionAttachment.findUniqueOrThrow({ where: { id: attachment.attachmentId } })).toMatchObject({ submissionId: initial.submissionId, studentId: value.studentB });
    await database!.submissionAttachment.update({
      where: { id: attachment.attachmentId },
      data: { status: "SCAN_PENDING", uploadedAt: value.now },
    });
    await database!.submissionAttachment.update({
      where: { id: attachment.attachmentId },
      data: { status: "READY", scannedAt: value.now },
    });
    await expect(
      getAuthorizedSubmissionAttachmentDownload(
        database!,
        context(value.studentA, value.now),
        { attachmentId: attachment.attachmentId },
      ),
    ).resolves.toMatchObject({ id: attachment.attachmentId });
    await expect(
      getAuthorizedSubmissionAttachmentDownload(
        database!,
        context(value.studentC, value.now),
        { attachmentId: attachment.attachmentId },
      ),
    ).rejects.toEqual(new SubmissionAttachmentAccessError("NOT_FOUND"));
    await expect(
      getStudentFeedbackWorkspace(
        database!,
        context(value.studentC, value.now),
        { submissionId: initial.submissionId },
      ),
    ).rejects.toEqual(new FeedbackWorkspaceQueryError("NOT_FOUND"));
    await expect(
      submitSubmissionRevision(
        database!,
        context(value.studentC, value.now),
        {
          releaseId: value.releaseId,
          expectedWorkingCopyId: resubmission.workingCopyId,
          expectedWorkingVersion: resubmission.workingVersion + 1,
          idempotencyKey: `submit_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new SubmitSubmissionRevisionError("NO_WORKING_COPY"));
    await expect(saveReleaseGroup(database!, context(value.teacherId, value.now), {
      releaseId: value.releaseId, groupId: group.groupId, name: "改名", members: [{ studentId: value.studentA, roleLabel: "记录" }, { studentId: value.studentB, roleLabel: "汇报" }], idempotencyKey: `group_${randomUUID()}`,
    })).rejects.toEqual(new ManageReleaseGroupError("GROUP_LOCKED"));
    await expect(database!.$executeRaw(Prisma.sql`
      INSERT INTO submissions (id, release_id, student_id, phase_index, latest_revision_number, created_at, updated_at)
      VALUES (${randomUUID()}::uuid, ${value.releaseId}::uuid, ${value.studentA}::uuid, 0, 0, ${value.now}, ${value.now})
    `)).rejects.toThrow(/group member cannot create personal submission/);
  });
});
