import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coreCompetencyRegistry } from "./core-competencies";

type FrozenRegistryGroup = Readonly<{
  disciplineCode: string;
  schoolStages: readonly string[];
  minGrade: number;
  maxGrade: number;
  competencyCodes: readonly string[];
}>;

function groupedApplicationRegistry(): FrozenRegistryGroup[] {
  const groups = new Map<string, {
    disciplineCode: string;
    schoolStages: readonly string[];
    minGrade: number;
    maxGrade: number;
    competencyCodes: string[];
  }>();
  for (const competency of coreCompetencyRegistry) {
    const key = JSON.stringify([
      competency.disciplineCode,
      competency.schoolStages,
      competency.gradeRange,
    ]);
    const group = groups.get(key) ?? {
      disciplineCode: competency.disciplineCode,
      schoolStages: competency.schoolStages,
      minGrade: competency.gradeRange[0],
      maxGrade: competency.gradeRange[1],
      competencyCodes: [],
    };
    group.competencyCodes.push(competency.code);
    groups.set(key, group);
  }
  return [...groups.values()];
}

describe("schema v3 competency registry", () => {
  it("matches the registry snapshot frozen in the v3 database validator", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "prisma/migrations/20260901120000_structured_task_book_v3/migration.sql",
      ),
      "utf8",
    );
    const match = migration.match(/\$registry\$(\[[\s\S]*?\])\$registry\$/u);
    expect(match?.[1]).toBeDefined();
    const databaseRegistry = JSON.parse(match![1]!) as FrozenRegistryGroup[];

    expect(databaseRegistry).toEqual(groupedApplicationRegistry());
  });
});
