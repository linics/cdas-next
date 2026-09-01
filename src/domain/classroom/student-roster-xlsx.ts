import * as XLSX from "xlsx";
import { z } from "zod";

/** One import stays small enough for a teacher to read the whole preview. */
export const MAX_ROSTER_IMPORT_ROWS = 100;
export const ROSTER_TEMPLATE_HEADER = ["学号", "姓名"] as const;

export const studentNoSchema = z
  .string()
  .transform((value) => value.normalize("NFKC").trim())
  .pipe(z.string().regex(/^[0-9]{6,32}$/u));

export const studentDisplayNameSchema = z
  .string()
  .transform((value) => value.normalize("NFC").trim().replace(/\s+/gu, " "))
  .pipe(z.string().min(1).max(120));

export const studentRosterEntrySchema = z
  .object({ studentNo: studentNoSchema, displayName: studentDisplayNameSchema })
  .strict();

export const studentRosterEntriesSchema = z
  .array(studentRosterEntrySchema)
  .min(1)
  .max(MAX_ROSTER_IMPORT_ROWS)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.studentNo)).size === entries.length,
    "同一次导入中学号不能重复",
  );

export type StudentRosterEntry = z.infer<typeof studentRosterEntrySchema>;

export type RosterRowIssue =
  | "STUDENT_NO_INVALID"
  | "DISPLAY_NAME_INVALID"
  | "DUPLICATE_STUDENT_NO";

export type ParsedRosterRow =
  | Readonly<{ rowNumber: number; ok: true; entry: StudentRosterEntry }>
  | Readonly<{
      rowNumber: number;
      ok: false;
      issue: RosterRowIssue;
      studentNoText: string;
      displayNameText: string;
    }>;

export class StudentRosterFileError extends Error {
  constructor(
    public readonly code:
      | "INVALID_WORKBOOK"
      | "INVALID_HEADER"
      | "INVALID_COLUMNS"
      | "EMPTY_FILE"
      | "TOO_MANY_ROWS",
  ) {
    super(code);
    this.name = "StudentRosterFileError";
  }
}

function cellToText(value: unknown): string {
  if (typeof value === "string") return value.normalize("NFKC").trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value).trim();
  }
  if (typeof value === "boolean") return String(value);
  return "";
}

function rowIsBlank(row: readonly unknown[]): boolean {
  return row.every((cell) => cellToText(cell) === "");
}

/**
 * Reads the first worksheet only. The uploaded workbook is never persisted:
 * the teacher confirms a parsed, normalized preview instead of a file.
 */
export function parseStudentRosterWorkbook(bytes: ArrayBuffer): ParsedRosterRow[] {
  const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
  if (
    signature.length !== 4 ||
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b ||
    signature[2] !== 0x03 ||
    signature[3] !== 0x04
  ) {
    throw new StudentRosterFileError("INVALID_WORKBOOK");
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, { type: "array", dense: true, cellDates: false, cellFormula: false, cellHTML: false });
  } catch {
    throw new StudentRosterFileError("INVALID_WORKBOOK");
  }
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!sheet) throw new StudentRosterFileError("INVALID_WORKBOOK");

  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : undefined;
  if (!range || range.s.r !== 0 || range.s.c !== 0) {
    throw new StudentRosterFileError("INVALID_HEADER");
  }
  if (range && range.e.r - range.s.r > MAX_ROSTER_IMPORT_ROWS + 1_000) {
    throw new StudentRosterFileError("TOO_MANY_ROWS");
  }

  const header = (XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
    range: { s: { r: 0, c: 0 }, e: { r: 0, c: range.e.c } },
  })[0] ?? []);
  if (
    cellToText(header[0]) !== ROSTER_TEMPLATE_HEADER[0] ||
    cellToText(header[1]) !== ROSTER_TEMPLATE_HEADER[1] ||
    header.slice(2).some((cell) => cellToText(cell) !== "")
  ) {
    throw new StudentRosterFileError("INVALID_HEADER");
  }
  if (range.e.c > 1) throw new StudentRosterFileError("INVALID_COLUMNS");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: true,
    raw: true,
  });

  const dataRows = rows
    .slice(1)
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => !rowIsBlank(row));
  if (dataRows.length === 0) throw new StudentRosterFileError("EMPTY_FILE");
  if (dataRows.length > MAX_ROSTER_IMPORT_ROWS) throw new StudentRosterFileError("TOO_MANY_ROWS");

  const parsed: ParsedRosterRow[] = [];
  const seen = new Set<string>();
  dataRows.forEach(({ row, rowNumber }) => {
    const studentNoText = cellToText(row[0]);
    const displayNameText = cellToText(row[1]);
    const studentNo = studentNoSchema.safeParse(studentNoText);
    const displayName = studentDisplayNameSchema.safeParse(displayNameText);
    if (!studentNo.success) {
      parsed.push({ rowNumber, ok: false, issue: "STUDENT_NO_INVALID", studentNoText, displayNameText });
      return;
    }
    if (!displayName.success) {
      parsed.push({ rowNumber, ok: false, issue: "DISPLAY_NAME_INVALID", studentNoText, displayNameText });
      return;
    }
    if (seen.has(studentNo.data)) {
      parsed.push({ rowNumber, ok: false, issue: "DUPLICATE_STUDENT_NO", studentNoText, displayNameText });
      return;
    }
    seen.add(studentNo.data);
    parsed.push({ rowNumber, ok: true, entry: { studentNo: studentNo.data, displayName: displayName.data } });
  });
  return parsed;
}

export function createStudentRosterTemplate(): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    [...ROSTER_TEMPLATE_HEADER],
    ["20260001", "张三"],
    ["20260002", "李四"],
  ]);
  // Student numbers are text: without this a leading zero is lost on reopen.
  for (const address of ["A2", "A3"]) {
    if (sheet[address]) sheet[address].z = "@";
  }
  sheet["!cols"] = [{ wch: 18 }, { wch: 14 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "学生名单");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
