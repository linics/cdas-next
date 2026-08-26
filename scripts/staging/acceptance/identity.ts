import {
  evaluateAcceptanceReadiness,
  type AcceptanceEnvironment,
} from "./contracts";

export type AcceptanceIdentityClient = Readonly<{
  users: Readonly<{
    getUser(userId: string): Promise<Readonly<{ id: string }>>;
  }>;
  signInTokens: Readonly<{
    createSignInToken(input: Readonly<{ userId: string; expiresInSeconds: number }>): Promise<Readonly<{ id: string; token: string; userId: string }>>;
    revokeSignInToken(tokenId: string): Promise<unknown>;
  }>;
}>;

export type IdentityCheck = Readonly<{ code: string; status: "PASS" }>;

export async function verifyAcceptanceIdentities(
  environment: AcceptanceEnvironment,
  client: AcceptanceIdentityClient,
): Promise<readonly IdentityCheck[]> {
  if (evaluateAcceptanceReadiness(environment, { requireBypassSecret: false }).status !== "PASS") {
    throw new Error("STAGING_ACCEPTANCE_READINESS_FAILED");
  }
  const teacherId = environment.STAGING_TEST_TEACHER_CLERK_ID?.trim() ?? "";
  const studentId = environment.STAGING_TEST_STUDENT_CLERK_ID?.trim() ?? "";
  const otherStudentId = environment.STAGING_TEST_OTHER_STUDENT_CLERK_ID?.trim() ?? "";
  const otherTeacherId = environment.STAGING_TEST_OTHER_TEACHER_CLERK_ID?.trim() ?? "";
  const [teacher, student, otherStudent, otherTeacher] = await Promise.all([
    client.users.getUser(teacherId),
    client.users.getUser(studentId),
    client.users.getUser(otherStudentId),
    client.users.getUser(otherTeacherId),
  ]);
  if (teacher.id !== teacherId || student.id !== studentId || otherStudent.id !== otherStudentId || otherTeacher.id !== otherTeacherId) {
    throw new Error("STAGING_ACCEPTANCE_IDENTITY_MISMATCH");
  }

  for (const userId of [teacherId, studentId, otherStudentId, otherTeacherId]) {
    const ticket = await client.signInTokens.createSignInToken({
      userId,
      expiresInSeconds: 60,
    });
    const valid = Boolean(ticket.id && ticket.token && ticket.userId === userId);
    if (ticket.id) {
      await client.signInTokens.revokeSignInToken(ticket.id);
    }
    if (!valid) {
      throw new Error("STAGING_ACCEPTANCE_TICKET_CAPABILITY_INVALID");
    }
  }

  return [
    { code: "TEACHER_IDENTITY_EXISTS", status: "PASS" },
    { code: "STUDENT_IDENTITY_EXISTS", status: "PASS" },
    { code: "OTHER_STUDENT_IDENTITY_EXISTS", status: "PASS" },
    { code: "OTHER_TEACHER_IDENTITY_EXISTS", status: "PASS" },
    { code: "TEACHER_TICKET_CAPABILITY", status: "PASS" },
    { code: "STUDENT_TICKET_CAPABILITY", status: "PASS" },
    { code: "OTHER_STUDENT_TICKET_CAPABILITY", status: "PASS" },
    { code: "OTHER_TEACHER_TICKET_CAPABILITY", status: "PASS" },
  ];
}
