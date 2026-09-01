import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";

vi.mock("server-only", () => ({}));

import {
  getTeacherActivityDashboard,
  getTeacherActivityDraft,
  getTeacherIdentity,
  TeacherActivityQueryError,
} from "./teacher-activity-workspace";

function context(source: CommandContext["source"] = "UI"): CommandContext {
  return {
    actorId: randomUUID(),
    source,
    traceId: randomUUID(),
    clock: () => new Date("2026-08-18T12:00:00.000Z"),
  };
}

function studentDatabaseDouble() {
  const activityDraftFindMany = vi.fn();
  const activityReleaseFindMany = vi.fn();
  const classroomFindMany = vi.fn();
  const database = {
    appUser: {
      findUnique: vi.fn().mockResolvedValue({
        role: "STUDENT",
        displayName: "陈同学",
      }),
    },
    activityDraft: { findMany: activityDraftFindMany },
    activityRelease: { findMany: activityReleaseFindMany },
    classroom: { findMany: classroomFindMany },
  } as unknown as PrismaClient;

  return {
    database,
    activityDraftFindMany,
    activityReleaseFindMany,
    classroomFindMany,
  };
}

describe("teacher workspace root role boundary", () => {
  it("reports a root role mismatch before scanning teacher resources", async () => {
    const fake = studentDatabaseDouble();

    await expect(
      getTeacherActivityDashboard(fake.database, context(), {}),
    ).rejects.toEqual(
      new TeacherActivityQueryError("WRONG_ROLE", "陈同学"),
    );
    expect(fake.activityDraftFindMany).not.toHaveBeenCalled();
    expect(fake.activityReleaseFindMany).not.toHaveBeenCalled();
    expect(fake.classroomFindMany).not.toHaveBeenCalled();
  });

  it("keeps the same root role boundary for Agent reads", async () => {
    const fake = studentDatabaseDouble();

    await expect(
      getTeacherActivityDashboard(fake.database, context("AGENT"), {}),
    ).rejects.toEqual(
      new TeacherActivityQueryError("WRONG_ROLE", "陈同学"),
    );
    expect(fake.activityDraftFindMany).not.toHaveBeenCalled();
    expect(fake.activityReleaseFindMany).not.toHaveBeenCalled();
    expect(fake.classroomFindMany).not.toHaveBeenCalled();
  });

  it("keeps non-root teacher identity checks non-enumerating", async () => {
    const fake = studentDatabaseDouble();

    await expect(
      getTeacherIdentity(fake.database, context(), {}),
    ).rejects.toEqual(new TeacherActivityQueryError("NOT_FOUND"));
  });
});

function teacherDraftDatabaseDouble(ownerId: string) {
  const activityDraftFindUnique = vi.fn().mockResolvedValue({
    id: randomUUID(),
    ownerId,
    status: "READY_FOR_PREVIEW",
    version: 1,
    updatedAt: new Date("2026-08-18T12:00:00.000Z"),
    sealedAt: null,
    release: null,
    revisions: [],
  });
  const database = {
    appUser: {
      findUnique: vi.fn().mockResolvedValue({
        role: "TEACHER",
        displayName: "林老师",
        accountStatus: "ACTIVE",
        school: { status: "ACTIVE" },
      }),
    },
    activityDraft: { findUnique: activityDraftFindUnique },
  } as unknown as PrismaClient;

  return { database, activityDraftFindUnique };
}

describe("teacher activity draft read boundary", () => {
  it("keeps a draft owned by another teacher absent for Agent reads", async () => {
    const agentContext = context("AGENT");
    const fake = teacherDraftDatabaseDouble(randomUUID());

    await expect(
      getTeacherActivityDraft(fake.database, agentContext, {
        draftId: randomUUID(),
      }),
    ).rejects.toEqual(new TeacherActivityQueryError("NOT_FOUND"));
  });

  it("still refuses sources other than the teacher UI and Agent", async () => {
    const fake = teacherDraftDatabaseDouble(randomUUID());

    await expect(
      getTeacherActivityDraft(fake.database, context("SYSTEM"), {
        draftId: randomUUID(),
      }),
    ).rejects.toThrow(TypeError);
    expect(fake.activityDraftFindUnique).not.toHaveBeenCalled();
  });
});
