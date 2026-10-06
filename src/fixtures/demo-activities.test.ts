import { describe, expect, it } from "vitest";
import { activityContentV3Schema } from "../domain/activity/activity-content";
import { parseSupportScaffold } from "../domain/activity/support-scaffold";
import { demoActivitiesV3 } from "./demo-activities";

describe("demo task books", () => {
  // The seed is the only other reader of these, and it needs a database: a
  // fixture that no longer validates would otherwise surface as a failed seed.
  it.each(demoActivitiesV3.map((activity) => [activity.title, activity] as const))(
    "%s is a valid v3 task book",
    (_title, activity) => {
      expect(activityContentV3Schema.safeParse(activity).error?.issues).toBeUndefined();
    },
  );

  it("gives every phase steps and a sentence starter for the student page", () => {
    for (const activity of demoActivitiesV3) {
      for (const phase of activity.phases) {
        const scaffold = parseSupportScaffold(phase.support);
        expect(scaffold.steps.length, `${activity.title} · ${phase.name}`).toBeGreaterThan(0);
        expect(scaffold.starters.length, `${activity.title} · ${phase.name}`).toBeGreaterThan(0);
      }
    }
  });

  it("uses distinct titles, which the seed looks drafts up by", () => {
    const titles = demoActivitiesV3.map((activity) => activity.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
