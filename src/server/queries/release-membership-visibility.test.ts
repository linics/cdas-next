import { describe, expect, it } from "vitest";
import {
  membershipIsCurrent,
  membershipOverlapsRelease,
  type MembershipVisibilityWindow,
  type ReleaseVisibilityWindow,
} from "./release-membership-visibility";

const publishedAt = new Date("2026-08-18T10:00:00.000Z");
const closedAt = new Date("2026-08-18T11:00:00.000Z");
const now = new Date("2026-08-18T12:00:00.000Z");

function membership(
  overrides: Partial<MembershipVisibilityWindow> = {},
): MembershipVisibilityWindow {
  return {
    joinedAt: new Date("2026-08-18T09:00:00.000Z"),
    endedAt: null,
    ...overrides,
  };
}

function release(
  overrides: Partial<ReleaseVisibilityWindow> = {},
): ReleaseVisibilityWindow {
  return {
    status: "ACTIVE",
    publishedAt,
    closedAt: null,
    ...overrides,
  };
}

describe("release membership visibility", () => {
  it.each([
    {
      name: "an active current member overlaps",
      membership: membership(),
      release: release(),
      now,
      visible: true,
    },
    {
      name: "an active member joining exactly now is visible immediately",
      membership: membership({ joinedAt: now }),
      release: release(),
      now,
      visible: true,
    },
    {
      name: "a future membership does not overlap an active release yet",
      membership: membership({
        joinedAt: new Date("2026-08-18T12:00:00.001Z"),
      }),
      release: release(),
      now,
      visible: false,
    },
    {
      name: "a former member keeps an active release that overlapped before exit",
      membership: membership({
        endedAt: new Date("2026-08-18T11:00:00.000Z"),
      }),
      release: release(),
      now,
      visible: true,
    },
    {
      name: "membership ending exactly at publication does not overlap",
      membership: membership({ endedAt: publishedAt }),
      release: release(),
      now,
      visible: false,
    },
    {
      name: "a future active release has no visibility window yet",
      membership: membership(),
      release: release({
        publishedAt: new Date("2026-08-18T13:00:00.000Z"),
      }),
      now,
      visible: false,
    },
    {
      name: "membership joining before close overlaps a closed release",
      membership: membership({
        joinedAt: new Date("2026-08-18T10:59:59.999Z"),
      }),
      release: release({ status: "CLOSED", closedAt }),
      now,
      visible: true,
    },
    {
      name: "membership joining exactly at close does not overlap",
      membership: membership({ joinedAt: closedAt }),
      release: release({ status: "CLOSED", closedAt }),
      now,
      visible: false,
    },
    {
      name: "archived releases use the same closed visibility boundary",
      membership: membership({
        joinedAt: new Date("2026-08-18T10:30:00.000Z"),
      }),
      release: release({ status: "ARCHIVED", closedAt }),
      now,
      visible: true,
    },
    {
      name: "closed release without closedAt is invalid and hidden",
      membership: membership(),
      release: release({ status: "CLOSED", closedAt: null }),
      now,
      visible: false,
    },
    {
      name: "closed release with an invalid closedAt is hidden",
      membership: membership(),
      release: release({
        status: "CLOSED",
        closedAt: new Date("invalid"),
      }),
      now,
      visible: false,
    },
    {
      name: "closedAt equal to publication is an empty invalid window",
      membership: membership(),
      release: release({ status: "CLOSED", closedAt: publishedAt }),
      now,
      visible: false,
    },
    {
      name: "closedAt before publication is an invalid window",
      membership: membership(),
      release: release({
        status: "CLOSED",
        closedAt: new Date("2026-08-18T09:59:59.999Z"),
      }),
      now,
      visible: false,
    },
    {
      name: "an invalid runtime status cannot broaden visibility",
      membership: membership(),
      release: {
        ...release(),
        status: "REOPENED",
      } as unknown as ReleaseVisibilityWindow,
      now,
      visible: false,
    },
    {
      name: "an invalid current time cannot create visibility",
      membership: membership(),
      release: release(),
      now: new Date("invalid"),
      visible: false,
    },
    {
      name: "an invalid membership date cannot create visibility",
      membership: membership({ joinedAt: new Date("invalid") }),
      release: release(),
      now,
      visible: false,
    },
    {
      name: "a reversed membership interval cannot create visibility",
      membership: membership({
        joinedAt: new Date("2026-08-18T11:00:00.000Z"),
        endedAt: new Date("2026-08-18T10:30:00.000Z"),
      }),
      release: release(),
      now,
      visible: false,
    },
  ])("$name", ({ membership, release, now, visible }) => {
    expect(membershipOverlapsRelease(membership, release, now)).toBe(
      visible,
    );
  });

  it.each([
    {
      name: "joined before now with no end is current",
      membership: membership(),
      current: true,
    },
    {
      name: "joining exactly now is current",
      membership: membership({ joinedAt: now }),
      current: true,
    },
    {
      name: "ending exactly now is not current",
      membership: membership({ endedAt: now }),
      current: false,
    },
    {
      name: "joining after now is not current",
      membership: membership({
        joinedAt: new Date("2026-08-18T12:00:00.001Z"),
      }),
      current: false,
    },
    {
      name: "an already ended membership is not current",
      membership: membership({
        endedAt: new Date("2026-08-18T11:59:59.999Z"),
      }),
      current: false,
    },
    {
      name: "an invalid current time is never current",
      membership: membership(),
      current: false,
      at: new Date("invalid"),
    },
    {
      name: "a reversed membership interval is never current",
      membership: membership({
        joinedAt: new Date("2026-08-18T11:00:00.000Z"),
        endedAt: new Date("2026-08-18T10:00:00.000Z"),
      }),
      current: false,
    },
  ])("$name", ({ membership, current, at }) => {
    expect(membershipIsCurrent(membership, at ?? now)).toBe(current);
  });
});
