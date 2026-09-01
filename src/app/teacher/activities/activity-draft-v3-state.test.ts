import { describe, expect, it } from "vitest";
import { waterConservationTaskBookV3 } from "../../../fixtures/water-conservation-v3";
import {
  nextLearningGoalId,
  normalizeV3Values,
} from "./activity-draft-v3-state";

describe("activity draft v3 state", () => {
  it("allocates an unused stable learning-goal id after deletion", () => {
    expect(
      nextLearningGoalId([
        { ...waterConservationTaskBookV3.learningGoals[0]!, id: "goal-1" },
        { ...waterConservationTaskBookV3.learningGoals[2]!, id: "goal-3" },
      ]),
    ).toBe("goal-2");
  });

  it("drops competency citations that no longer match stage or grade", () => {
    const normalized = normalizeV3Values({
      ...waterConservationTaskBookV3,
      grade: 9,
      integratedDisciplineCodes: [
        ...waterConservationTaskBookV3.integratedDisciplineCodes,
        "infoTech",
      ],
      disciplineContributions: [
        ...waterConservationTaskBookV3.disciplineContributions,
        {
          disciplineCode: "infoTech",
          contribution: "使用数字工具整理资料。",
          necessity: "没有数字工具，资料难以协作整理。",
        },
      ],
      learningGoals: waterConservationTaskBookV3.learningGoals.map((goal, index) =>
        index === 0
          ? {
              ...goal,
              competencyReferences: [
                ...goal.competencyReferences,
                {
                  disciplineCode: "infoTech",
                  competencyCode: "computational_thinking",
                },
              ],
            }
          : goal,
      ),
    });

    expect(normalized.learningGoals[0]?.competencyReferences).toEqual(
      waterConservationTaskBookV3.learningGoals[0]?.competencyReferences,
    );
  });
});
