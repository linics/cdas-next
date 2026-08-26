export type TeacherReviewRosterCsvInput = {
  release: {
    title: string;
    classroomName: string;
    rubricAvailable: boolean;
  };
  submissions: ReadonlyArray<{
    phaseIndex: number;
    phaseName: string | null;
    student: { id?: string; displayName: string };
    group: { name: string } | null;
    currentRevision: {
      revisionNumber: number;
      isLate: boolean;
      feedback: { currentVersion: number } | null;
      evaluation: { currentVersion: number } | null;
      followUp: "AWAITING_RESUBMISSION" | "RESUBMISSION_IN_PROGRESS" | null;
    };
  }>;
};

const HEADER = [
  "班级",
  "对象",
  "阶段",
  "正式修订",
  "迟交",
  "反馈",
  "评价",
  "跟进",
] as const;

export function teacherReviewRosterCsvFilename(title: string): string {
  const stem = title
    .normalize("NFC")
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return stem ? `${stem}-评阅名册.csv` : "评阅名册.csv";
}

export function formatTeacherReviewRosterCsv(
  input: TeacherReviewRosterCsvInput,
): string {
  const rows = input.submissions.map((submission) =>
    [
      input.release.classroomName,
      submission.group?.name ?? submission.student.displayName,
      submission.phaseName
        ? `第 ${submission.phaseIndex} 阶段 · ${submission.phaseName}`
        : "整项提交",
      String(submission.currentRevision.revisionNumber),
      submission.currentRevision.isLate ? "迟交" : "",
      submission.currentRevision.feedback
        ? `已反馈 v${submission.currentRevision.feedback.currentVersion}`
        : "待反馈",
      input.release.rubricAvailable
        ? submission.currentRevision.evaluation
          ? `已评价 v${submission.currentRevision.evaluation.currentVersion}`
          : "待评价"
        : "无量规",
      submission.currentRevision.followUp === "AWAITING_RESUBMISSION"
        ? "待重交"
        : submission.currentRevision.followUp === "RESUBMISSION_IN_PROGRESS"
          ? "重交中"
          : "",
    ]
      .map(csvField)
      .join(","),
  );
  return `\uFEFF${[HEADER.join(","), ...rows].join("\r\n")}\r\n`;
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
