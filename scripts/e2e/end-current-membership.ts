import { createDatabaseClient } from "../../src/server/db/client";
import {
  requireE2eRunMarker,
  resolveE2eDatabaseUrl,
} from "./environment";

async function main(): Promise<void> {
  const marker = requireE2eRunMarker();
  const database = createDatabaseClient(resolveE2eDatabaseUrl());

  try {
    const draft = await database.activityDraft.findFirst({
      where: { title: { contains: marker } },
      orderBy: { createdAt: "desc" },
      select: {
        release: {
          select: {
            status: true,
            publishedAt: true,
            classroomId: true,
            submissions: {
              take: 1,
              select: { studentId: true },
            },
          },
        },
      },
    });
    const release = draft?.release;
    const studentId = release?.submissions[0]?.studentId;
    if (!release || release.status !== "ACTIVE" || !studentId) {
      throw new Error("E2E_ACTIVE_RELEASE_WITH_SUBMISSION_REQUIRED");
    }

    const membership = await database.classroomMembership.findFirst({
      where: {
        classroomId: release.classroomId,
        studentId,
        endedAt: null,
      },
      orderBy: { joinedAt: "desc" },
      select: { id: true, joinedAt: true },
    });
    if (!membership) {
      throw new Error("E2E_CURRENT_MEMBERSHIP_REQUIRED");
    }

    const endedAt = new Date(
      Math.max(Date.now(), release.publishedAt.getTime() + 1),
    );
    if (endedAt <= membership.joinedAt) {
      throw new Error("E2E_MEMBERSHIP_END_INVALID");
    }
    const updated = await database.classroomMembership.updateMany({
      where: { id: membership.id, endedAt: null },
      data: { endedAt },
    });
    if (updated.count !== 1) {
      throw new Error("E2E_MEMBERSHIP_END_CONCURRENT_WRITE");
    }

    process.stdout.write(
      `${JSON.stringify({ ok: true, historicalMembership: true })}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: {
        code:
          error instanceof Error
            ? error.message
            : "E2E_MEMBERSHIP_FIXTURE_FAILED",
      },
    })}\n`,
  );
  process.exitCode = 1;
});
