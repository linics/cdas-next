"""Mechanical importer for the supplied 2022 Ministry curriculum-standard DOCX files.

The script intentionally has no AI or editorial rewriting step. It only reads
paragraph text, normalises chapter markers needed by the existing corpus
builder, and writes UTF-8 raw Markdown-like text. Run it with the checkout as
the working directory; the source directory remains outside the repository.
"""

from pathlib import Path
import re
import sys

from docx import Document


SOURCES = {
    2: "02-politics-standard-2022.md",
    3: "03-chinese-standard-2022.md",
    4: "04-history-standard-2022.md",
    5: "05-english-standard-2022.md",
    6: "06-geography-standard-2022.md",
    7: "07-science-standard-2022.md",
    8: "08-physics-standard-2022.md",
    9: "09-biology-standard-2022.md",
    10: "10-info-tech-standard-2022.md",
    11: "11-sports-standard-2022.md",
    12: "12-arts-standard-2022.md",
    13: "13-labor-standard-2022.md",
    14: "14-math-standard-2022.md",
    15: "15-chemistry-standard-2022.md",
}


def compact(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\u00a0", " ")).strip()


def normalise_heading(value: str) -> str:
    value = compact(value)
    value = re.sub(r"^([一二三四五六七八九十]+)\s*[、.．]?\s*(课程(?:性质|理念|目标|内容|实施)|学业质量|附录)", r"\1、\2", value)
    value = re.sub(r"^([一二三四五六七八九十]+)\s*[、.．]?\s*(培养目标|基本原则|课程设置)", r"\1、\2", value)
    return value


def document_lines(path: Path) -> list[str]:
    document = Document(path)
    lines: list[str] = []
    previous = ""
    for paragraph in document.paragraphs:
        value = normalise_heading(paragraph.text)
        if not value or value == previous:
            continue
        # Page headers/footers and isolated page numbers are furniture. The
        # TypeScript cleaner performs a second conservative pass during build.
        if re.fullmatch(r"[0-9ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVXLCDM]+", value):
            continue
        lines.append(value)
        previous = value
    return lines


def main() -> int:
    source_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("..") / "documents"
    output_root = Path("corpus") / "official-standards" / "raw"
    output_root.mkdir(parents=True, exist_ok=True)
    for directory, output_name in SOURCES.items():
        source = source_root / str(directory) / "orig.docx"
        if not source.exists():
            raise FileNotFoundError(source)
        lines = document_lines(source)
        if len(lines) < 80:
            raise ValueError(f"source appears incomplete: {source}")
        (output_root / output_name).write_text("\n\n".join(lines) + "\n", encoding="utf-8")
        print(f"wrote {output_name} ({len(lines)} paragraphs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
