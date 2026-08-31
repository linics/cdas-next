import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as XLSX from "xlsx";
import { parseStudentRosterXlsx, StudentRosterXlsxError } from "./student-roster-xlsx";

function workbookBytes(rows: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "学生名单");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("student roster xlsx parser", () => {
  it("reads only the first worksheet with the fixed two-column header", () => {
    expect(parseStudentRosterXlsx(workbookBytes([["学号", "姓名"], ["20260001", "张三"]]))).toEqual([{ studentNo: "20260001", displayName: "张三" }]);
  });

  it("rejects a changed header, duplicate student number, and non-numeric number", () => {
    expect(() => parseStudentRosterXlsx(workbookBytes([["姓名", "学号"], ["张三", "20260001"]]))).toThrow(new StudentRosterXlsxError("INVALID_HEADER"));
    expect(() => parseStudentRosterXlsx(workbookBytes([["学号", "姓名"], ["20260001", "张三"], ["20260001", "李四"]]))).toThrow(new StudentRosterXlsxError("INVALID_ROW"));
    expect(() => parseStudentRosterXlsx(workbookBytes([["学号", "姓名"], ["abc123", "张三"]]))).toThrow(new StudentRosterXlsxError("INVALID_ROW"));
  });
});
