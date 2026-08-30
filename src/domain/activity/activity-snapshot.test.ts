import { describe, expect, it } from "vitest";
import { waterConservationActivity, waterConservationTaskBook } from "../../fixtures/water-conservation";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { canonicalizeActivityContentV2, createActivitySnapshot } from "./activity-snapshot";

describe("createActivitySnapshot", () => {
  it("is deterministic across property order", () => {
    const reordered = {
      feedbackCriteria: waterConservationActivity.feedbackCriteria,
      evidenceRequirements: waterConservationActivity.evidenceRequirements,
      taskInstructions: waterConservationActivity.taskInstructions,
      learningObjectives: waterConservationActivity.learningObjectives,
      summary: waterConservationActivity.summary,
      title: waterConservationActivity.title,
      schemaVersion: 1,
    };

    expect(createActivitySnapshot(reordered).contentHash).toBe(
      createActivitySnapshot(waterConservationActivity).contentHash,
    );
  });

  it("changes when released content changes", () => {
    const changed = {
      ...waterConservationActivity,
      title: "校园节水行动（修订）",
    };

    expect(createActivitySnapshot(changed).contentHash).not.toBe(
      createActivitySnapshot(waterConservationActivity).contentHash,
    );
  });

  it("keeps the schema-v1 canonical UTF-8 bytes stable", () => {
    const snapshot = createActivitySnapshot({
      schemaVersion: 1,
      title: '引号"、反斜线\\、换行\n与𠮷',
      summary: "é / 水",
      learningObjectives: ["目标一", "目标二"],
      taskInstructions: "观察\t并记录。",
      evidenceRequirements: ["证据 A", "证据 B"],
      feedbackCriteria: ["清楚", "可核验"],
    });

    expect(snapshot.contentHash).toBe(
      "dba8c4eb5f68077966a1e257b6535422bb6f181b38152b352715a589be96e63a",
    );
  });

  it("hashes the complete v2 task book deterministically", () => {
    const snapshot = createActivitySnapshot(waterConservationTaskBook);
    expect(snapshot.content).toEqual(waterConservationTaskBook);
    expect(snapshot.contentHash).toHaveLength(64);
    expect(canonicalizeActivityContentV2({ ...waterConservationTaskBook })).toBe(
      canonicalizeActivityContentV2(waterConservationTaskBook),
    );
  });

  it("hashes a v3 canonical task book without changing the v1/v2 contracts", () => {
    const snapshot = createActivitySnapshot(waterConservationTaskBookV3);
    expect(snapshot.content).toEqual(waterConservationTaskBookV3);
    expect(snapshot.contentHash).toHaveLength(64);
    expect(snapshot.contentHash).not.toBe(
      createActivitySnapshot({ ...waterConservationTaskBookV3, title: "另一任务" }).contentHash,
    );
  });
});
