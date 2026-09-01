/** RFC 4122 UUID reserved by the school-organization migration. */
export const legacySchoolId = "c0de0000-0000-4000-8000-00000000c0de";

/** Generator-legal public code for the backfill school. Not `LEGACY01`. */
export const legacySchoolCode = "SCHARCHX";

export function legacySchoolUserFields(): {
  schoolId: typeof legacySchoolId;
  legacyProfile: true;
} {
  return { schoolId: legacySchoolId, legacyProfile: true };
}

export function applyLegacySchoolToUserData<
  T extends {
    role?: "ADMIN" | "TEACHER" | "STUDENT";
    schoolId?: string | null;
    legacyProfile?: boolean;
  },
>(data: T): T {
  if (data.role === "ADMIN" || data.schoolId) {
    return data;
  }
  if (data.role === "TEACHER" || data.role === "STUDENT") {
    return {
      ...data,
      schoolId: data.schoolId ?? legacySchoolId,
      legacyProfile: data.legacyProfile ?? true,
    };
  }
  return data;
}

export function applyLegacySchoolToClassroomData<
  T extends { schoolId?: string | null },
>(data: T): T {
  if (data.schoolId) {
    return data;
  }
  return { ...data, schoolId: legacySchoolId };
}
