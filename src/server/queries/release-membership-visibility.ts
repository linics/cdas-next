export type ReleaseVisibilityWindow = Readonly<{
  status: "ACTIVE" | "CLOSED" | "ARCHIVED";
  publishedAt: Date;
  closedAt: Date | null;
}>;

export type MembershipVisibilityWindow = Readonly<{
  joinedAt: Date;
  endedAt: Date | null;
}>;

function isValidDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function hasValidMembershipWindow(
  membership: MembershipVisibilityWindow,
): boolean {
  return (
    isValidDate(membership.joinedAt) &&
    (membership.endedAt === null ||
      (isValidDate(membership.endedAt) &&
        membership.endedAt > membership.joinedAt))
  );
}

export function membershipOverlapsRelease(
  membership: MembershipVisibilityWindow,
  release: ReleaseVisibilityWindow,
  now: Date,
): boolean {
  if (
    !hasValidMembershipWindow(membership) ||
    !isValidDate(release.publishedAt) ||
    !isValidDate(now) ||
    !["ACTIVE", "CLOSED", "ARCHIVED"].includes(release.status)
  ) {
    return false;
  }

  const remainedAfterPublication =
    membership.endedAt === null ||
    membership.endedAt > release.publishedAt;
  if (!remainedAfterPublication) {
    return false;
  }

  if (release.status === "ACTIVE") {
    return (
      release.publishedAt <= now && membership.joinedAt <= now
    );
  }

  if (
    release.closedAt === null ||
    !isValidDate(release.closedAt) ||
    release.closedAt <= release.publishedAt
  ) {
    return false;
  }

  return membership.joinedAt < release.closedAt;
}

export function membershipIsCurrent(
  membership: MembershipVisibilityWindow,
  now: Date,
): boolean {
  return (
    hasValidMembershipWindow(membership) &&
    isValidDate(now) &&
    membership.joinedAt <= now &&
    (membership.endedAt === null || membership.endedAt > now)
  );
}
