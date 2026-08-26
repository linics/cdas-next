import { describe, expect, it } from "vitest";
import {
  formatTeacherReviewRosterCsv,
  teacherReviewRosterCsvFilename,
} from "./teacher-review-roster-csv";

const studentId = "30000000-0000-4000-8000-000000000003";
const submissionId = "20000000-0000-4000-8000-000000000002";

describe("teacher review roster CSV", () => {
  it("renders current-revision roster flags without ids or evidence bodies", () => {
    const csv = formatTeacherReviewRosterCsv({
      release: {
        title: "校园水表观察",
        classroomName: "七年一班",
        rubricAvailable: false,
      },
      submissions: [
        {
          phaseIndex: 0,
          phaseName: null,
          student: { id: studentId, displayName: "陈同学" },
          group: null,
          currentRevision: {
            revisionNumber: 2,
            isLate: true,
            feedback: { currentVersion: 3 },
            evaluation: null,
            followUp: null,
          },
        },
      ],
    });

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(
      "班级,对象,阶段,正式修订,迟交,反馈,评价,跟进",
    );
    expect(csv).toContain(
      "七年一班,陈同学,整项提交,2,迟交,已反馈 v3,无量规,",
    );
    expect(csv).not.toContain(studentId);
    expect(csv).not.toContain(submissionId);
    expect(csv).not.toContain("学生正式提交正文");
    expect(csv).not.toContain("教师正式反馈正文");
    expect(csv).not.toContain("综评");
  });

  it("matches the submissions page labels for v2 follow-up and group audience", () => {
    const csv = formatTeacherReviewRosterCsv({
      release: {
        title: "校园水表观察",
        classroomName: "七年一班",
        rubricAvailable: true,
      },
      submissions: [
        {
          phaseIndex: 3,
          phaseName: "形成方案",
          student: { id: studentId, displayName: "陈同学" },
          group: { name: '调查组, "甲"' },
          currentRevision: {
            revisionNumber: 1,
            isLate: false,
            feedback: { currentVersion: 1 },
            evaluation: null,
            followUp: "AWAITING_RESUBMISSION",
          },
        },
      ],
    });

    expect(csv).toContain(
      '七年一班,"调查组, ""甲""",第 3 阶段 · 形成方案,1,,已反馈 v1,待评价,待重交',
    );
    expect(csv).not.toContain("无量规");
    expect(csv).not.toContain("陈同学");
  });

  it("keeps a header-only file when there are no formal revisions", () => {
    const csv = formatTeacherReviewRosterCsv({
      release: {
        title: "校园水表观察",
        classroomName: "七年一班",
        rubricAvailable: true,
      },
      submissions: [],
    });

    expect(csv).toBe(
      "\uFEFF班级,对象,阶段,正式修订,迟交,反馈,评价,跟进\r\n",
    );
  });

  it("sanitizes the download filename from the release title", () => {
    expect(teacherReviewRosterCsvFilename("校园水表观察")).toBe(
      "校园水表观察-评阅名册.csv",
    );
    expect(teacherReviewRosterCsvFilename('a/b:*?"<>|c')).toBe(
      "a-b-------c-评阅名册.csv",
    );
    expect(teacherReviewRosterCsvFilename("   ")).toBe("评阅名册.csv");
  });
});
