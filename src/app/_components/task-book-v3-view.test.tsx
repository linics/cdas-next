import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  teacherEvaluationLevelLabels,
  teacherEvaluationLevels,
} from "../../domain/evaluation/teacher-evaluation-policy";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { TaskBookV3View } from "./task-book-v3-view";

describe("v3 task book view", () => {
  it("names each rubric level the way the student's evaluation will", () => {
    // D-090: a student read 达标 here and then received 合格 for the same level.
    const markup = renderToStaticMarkup(
      <TaskBookV3View content={waterConservationTaskBookV3} />,
    );
    const [dimension] = waterConservationTaskBookV3.rubricDimensions;

    for (const level of teacherEvaluationLevels) {
      expect(markup).toContain(
        `${teacherEvaluationLevelLabels[level]}：${dimension[level]}`,
      );
    }
    expect(markup).not.toContain("合格");
  });
});
