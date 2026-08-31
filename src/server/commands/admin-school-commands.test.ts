import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";

vi.mock("server-only", () => ({}));

import {
  createSchool,
  resetSchoolTeacherInvite,
  setSchoolStatus,
  type SchoolCommandRandomness,
  SchoolAdminCommandError,
} from "./admin-school-commands";
import type { CommandContext } from "./command-context";

const adminId = "00000000-0000-4000-8000-000000000001";
const context: CommandContext = {
  actorId: adminId,
  source: "UI",
  traceId: "admin-school-command-test",
  clock: () => new Date("2026-08-30T00:00:00.000Z"),
};

type StoredSchool = {
  id: string;
  name: string;
  code: string;
  teacherInviteCodeHash: string;
  status: "ACTIVE" | "DISABLED";
};

function databaseWith(options?: {
  actor?: { role: "ADMIN" | "TEACHER"; accountStatus: "ACTIVE" | "DISABLED" } | null;
  schools?: StoredSchool[];
}) {
  const schools = [...(options?.schools ?? [])];
  const idempotency: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  let nextId = 10;
  const client = {
    $transaction: async <T>(work: (transaction: unknown) => Promise<T>) =>
      work(client),
    appUser: {
      findUnique: async () => options?.actor ?? { role: "ADMIN", accountStatus: "ACTIVE" },
    },
    school: {
      findUnique: async ({ where }: { where: { id?: string; code?: string } }) =>
        schools.find((school) =>
          where.id ? school.id === where.id : school.code === where.code,
        ) ?? null,
      create: async ({ data }: { data: Omit<StoredSchool, "id"> }) => {
        const school = {
          ...data,
          id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
        };
        schools.push(school);
        return school;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<StoredSchool> }) => {
        const school = schools.find((item) => item.id === where.id);
        if (!school) throw new Error("school not found");
        Object.assign(school, data);
        return school;
      },
    },
    idempotencyRecord: {
      findUnique: async ({ where }: { where: { actorId_commandName_idempotencyKey: { actorId: string; commandName: string; idempotencyKey: string } } }) => {
        const key = where.actorId_commandName_idempotencyKey;
        return idempotency.find(
          (record) =>
            record.actorId === key.actorId &&
            record.commandName === key.commandName &&
            record.idempotencyKey === key.idempotencyKey,
        ) ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        idempotency.push(data);
        return data;
      },
    },
    actionAudit: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  };
  return { database: client as unknown as PrismaClient, schools, idempotency, audits };
}

const randomness: SchoolCommandRandomness = {
  generateSchoolCode: () => "SCHAB234",
  generateTeacherInvite: () => "secret-invite-must-never-persist",
};

describe("administrator school commands", () => {
  it("creates a school once and returns its invite only on the first response", async () => {
    const fixture = databaseWith();

    const created = await createSchool(
      fixture.database,
      context,
      { name: "实验小学", idempotencyKey: "create-school-001" },
      randomness,
    );
    expect(created).toMatchObject({
      status: "CREATED",
      schoolCode: "SCHAB234",
      teacherInviteCode: "secret-invite-must-never-persist",
    });
    expect(fixture.schools).toHaveLength(1);
    expect(fixture.schools[0].teacherInviteCodeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify({ schools: fixture.schools, idempotency: fixture.idempotency, audits: fixture.audits })).not.toContain("secret-invite-must-never-persist");

    const replay = await createSchool(
      fixture.database,
      context,
      { name: "实验小学", idempotencyKey: "create-school-001" },
      randomness,
    );
    expect(replay).toMatchObject({ status: "EXISTING", teacherInviteCode: null });
    expect(fixture.schools).toHaveLength(1);
  });

  it("invalidates the old invite and treats a repeat reset as already completed", async () => {
    const fixture = databaseWith({
      schools: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          name: "实验小学",
          code: "SCHAB234",
          teacherInviteCodeHash: "0".repeat(64),
          status: "ACTIVE",
        },
      ],
    });
    const reset = await resetSchoolTeacherInvite(
      fixture.database,
      context,
      { schoolId: fixture.schools[0].id, idempotencyKey: "reset-invite-001" },
      randomness,
    );
    expect(reset.teacherInviteCode).toBe("secret-invite-must-never-persist");
    expect(fixture.schools[0].teacherInviteCodeHash).not.toBe("0".repeat(64));

    await expect(
      resetSchoolTeacherInvite(
        fixture.database,
        context,
        { schoolId: fixture.schools[0].id, idempotencyKey: "reset-invite-001" },
        randomness,
      ),
    ).resolves.toMatchObject({ status: "EXISTING", teacherInviteCode: null });
  });

  it("sets school status idempotently and rejects non-admin callers", async () => {
    const school: StoredSchool = {
      id: "00000000-0000-4000-8000-000000000010",
      name: "实验小学",
      code: "SCHAB234",
      teacherInviteCodeHash: "0".repeat(64),
      status: "ACTIVE",
    };
    const fixture = databaseWith({ schools: [school] });
    await expect(
      setSchoolStatus(fixture.database, context, {
        schoolId: school.id,
        status: "DISABLED",
        idempotencyKey: "disable-school-001",
      }),
    ).resolves.toMatchObject({ status: "DISABLED" });

    const teacherFixture = databaseWith({
      actor: { role: "TEACHER", accountStatus: "ACTIVE" },
      schools: [school],
    });
    await expect(
      setSchoolStatus(teacherFixture.database, context, {
        schoolId: school.id,
        status: "DISABLED",
        idempotencyKey: "disable-school-002",
      }),
    ).rejects.toEqual(new SchoolAdminCommandError("FORBIDDEN"));
  });
});
