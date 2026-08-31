import * as XLSX from "xlsx";
import { z } from "zod";
import { isValidStudentNo, normalizeStudentNo } from "../../server/auth/local-auth";

const MAX_STUDENTS_PER_IMPORT = 100;
const header = ["学号", "姓名"] as const;

export const studentRosterEntrySchema = z.object({
  studentNo: z.string().transform(normalizeStudentNo).refine(isValidStudentNo, "学号必须为至少六位数字"),
  displayName: z.string().normalize("NFKC").trim().min(1).max(120),
}).strict();
export const studentRosterEntriesSchema = z.array(studentRosterEntrySchema).min(1).max(MAX_STUDENTS_PER_IMPORT).superRefine((entries, context) => {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.studentNo)) context.addIssue({ code: "custom", path: [index, "studentNo"], message: "同一文件中学号不能重复" });
    seen.add(entry.studentNo);
  });
});
export type StudentRosterEntry = z.infer<typeof studentRosterEntrySchema>;

export class StudentRosterXlsxError extends Error {
  constructor(public readonly code: "INVALID_WORKBOOK" | "INVALID_HEADER" | "INVALID_ROW" | "TOO_MANY_ROWS") {
    super(code);
    this.name = "StudentRosterXlsxError";
  }
}

function cellToText(value: unknown): string {
  if (typeof value === "string") return value.normalize("NFKC").trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** Parses only the first worksheet and deliberately does not persist the input file. */
export function parseStudentRosterXlsx(bytes: ArrayBuffer): StudentRosterEntry[] {
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(bytes, { type: "array", dense: true, cellDates: false }); }
  catch { throw new StudentRosterXlsxError("INVALID_WORKBOOK"); }
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName || !workbook.Sheets[firstSheetName]) throw new StudentRosterXlsxError("INVALID_WORKBOOK");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheetName], { header: 1, defval: null, blankrows: false, raw: true });
  const firstRow = rows[0] ?? [];
  if (firstRow.length !== 2 || cellToText(firstRow[0]) !== header[0] || cellToText(firstRow[1]) !== header[1]) throw new StudentRosterXlsxError("INVALID_HEADER");
  if (rows.length - 1 > MAX_STUDENTS_PER_IMPORT) throw new StudentRosterXlsxError("TOO_MANY_ROWS");
  const entries: StudentRosterEntry[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.length !== 2) throw new StudentRosterXlsxError("INVALID_ROW");
    try { entries.push(studentRosterEntrySchema.parse({ studentNo: cellToText(row[0]), displayName: cellToText(row[1]) })); }
    catch { throw new StudentRosterXlsxError("INVALID_ROW"); }
  }
  try { return studentRosterEntriesSchema.parse(entries); }
  catch { throw new StudentRosterXlsxError("INVALID_ROW"); }
}

export function createStudentRosterTemplate(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([[...header], ["20260001", "张三"]]);
  sheet["A2"].z = "@";
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "学生名单");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}
