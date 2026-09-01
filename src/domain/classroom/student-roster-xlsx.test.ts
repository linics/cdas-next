import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  createStudentRosterTemplate,
  MAX_ROSTER_IMPORT_ROWS,
  parseStudentRosterWorkbook,
  StudentRosterFileError,
} from "./student-roster-xlsx";

function workbook(rows: readonly (readonly unknown[])[]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "名单");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

describe("parseStudentRosterWorkbook", () => {
  it("parses the template header and normalizes every row", () => {
    const rows = parseStudentRosterWorkbook(
      workbook([
        ["学号", "姓名"],
        ["20260001", " 张三 "],
        [20260002, "李四"],
      ]),
    );
    expect(rows).toEqual([
      { rowNumber: 2, ok: true, entry: { studentNo: "20260001", displayName: "张三" } },
      { rowNumber: 3, ok: true, entry: { studentNo: "20260002", displayName: "李四" } },
    ]);
  });

  it("reports bad rows instead of failing the whole file", () => {
    const rows = parseStudentRosterWorkbook(
      workbook([
        ["学号", "姓名"],
        ["20260001", "张三"],
        ["abc", "王五"],
        ["20260003", "   "],
        ["20260001", "张三重复"],
      ]),
    );
    expect(rows.map((row) => (row.ok ? "OK" : row.issue))).toEqual([
      "OK",
      "STUDENT_NO_INVALID",
      "DISPLAY_NAME_INVALID",
      "DUPLICATE_STUDENT_NO",
    ]);
    expect(rows[1]).toMatchObject({ rowNumber: 3, studentNoText: "abc", displayNameText: "王五" });
  });

  it("skips blank rows between entries", () => {
    const rows = parseStudentRosterWorkbook(
      workbook([
        ["学号", "姓名"],
        ["20260001", "张三"],
        [null, null],
        ["20260002", "李四"],
      ]),
    );
    expect(rows.filter((row) => row.ok)).toHaveLength(2);
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 4]);
  });

  it("rejects a header that is not on the first physical row", () => {
    expect(() => parseStudentRosterWorkbook(
      workbook([[null, null], ["学号", "姓名"], ["20260001", "张三"]]),
    )).toThrow(new StudentRosterFileError("INVALID_HEADER"));
  });

  it("rejects a workbook whose first row is not the template header", () => {
    expect(() => parseStudentRosterWorkbook(workbook([["学号", "姓名", "班级"], ["20260001", "张三", "八一"]])))
      .toThrow(new StudentRosterFileError("INVALID_HEADER"));
    expect(() => parseStudentRosterWorkbook(workbook([["姓名", "学号"], ["张三", "20260001"]])))
      .toThrow(new StudentRosterFileError("INVALID_HEADER"));
  });

  it("rejects an empty sheet and an oversized sheet", () => {
    expect(() => parseStudentRosterWorkbook(workbook([["学号", "姓名"]])))
      .toThrow(new StudentRosterFileError("EMPTY_FILE"));
    const many = [
      ["学号", "姓名"],
      ...Array.from({ length: MAX_ROSTER_IMPORT_ROWS + 1 }, (_value, index) => [
        String(20_260_000 + index),
        `学生${index}`,
      ]),
    ];
    expect(() => parseStudentRosterWorkbook(workbook(many)))
      .toThrow(new StudentRosterFileError("TOO_MANY_ROWS"));
  });

  it("rejects bytes that are not a workbook", () => {
    expect(() => parseStudentRosterWorkbook(new TextEncoder().encode("学号,姓名").buffer as ArrayBuffer))
      .toThrow(new StudentRosterFileError("INVALID_WORKBOOK"));
  });

  it("rejects cells outside the two-column roster boundary", () => {
    expect(() => parseStudentRosterWorkbook(
      workbook([["学号", "姓名"], ["20260001", "张三", "额外数据"]]),
    )).toThrow(new StudentRosterFileError("INVALID_COLUMNS"));
  });

  it("round-trips the downloadable template", () => {
    const template = createStudentRosterTemplate();
    const bytes = template.buffer.slice(
      template.byteOffset,
      template.byteOffset + template.byteLength,
    ) as ArrayBuffer;
    const rows = parseStudentRosterWorkbook(bytes);
    expect(rows.every((row) => row.ok)).toBe(true);
    expect(rows).toHaveLength(2);
  });
});
