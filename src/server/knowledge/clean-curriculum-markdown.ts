/**
 * Furniture-only cleaner for Pandoc Word exports of 2022 curriculum standards.
 * It never decides which chapters enter the corpus; that is manifest.json.
 */

const BOOKMARK_LINK = /\]\(#bookmark/iu;
const BOOKMARK_ANCHOR = /<span\b[^>]*\bid=["']bookmark[^"']*["'][^>]*><\/span>/giu;
const HTML_BLOCK_TAGS =
  /<\/?(?:table|thead|tbody|tfoot|tr|td|th|colgroup|col|blockquote|p|div|span)\b[^>]*>/giu;
const TRAILING_PAGE_NUMBER =
  /(?:\s+(?:\d{1,3}|[IVXLCDM]+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)|[IVXLCDMⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+)$/u;
const ROMAN_ONLY = /^[IVXLCDMⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.．、]?$/u;
const PUBLISHER_ENGLISH =
  /^(?:BEL?IJING|BEIJING).*(?:UNIVER|UNVERSIT).*PUBL/iu;
const RUNNING_TITLE =
  /^(?:[IVXLCDMⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.．、]?)?(?:义务教育)?(?:课程方案|(?:语文|数学|物理|信息科技)?课程标准)\(?2022年版\)?$/u;

export function stripCurriculumMarkup(value: string): string {
  return value
    .replace(BOOKMARK_ANCHOR, "")
    .replace(/<img\b[^>]*>/giu, "")
    .replace(HTML_BLOCK_TAGS, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/\*\*|__|~~|`/gu, "")
    .replace(/\\([.()])/gu, "$1")
    .replace(/^\s*>\s?/u, "")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeCurriculumHeading(value: string): string {
  const withoutPage = value
    .replace(/[.…·•]+$/u, "")
    .replace(TRAILING_PAGE_NUMBER, "")
    .trim();
  return withoutPage
    .replace(/([一二三四五六七八九十])\s+、/gu, "$1、")
    .replace(/[（(]\s*([一二三四五六七八九十]+)\s*[）)]/gu, "（$1）")
    .replace(/【\s+/gu, "【")
    .replace(/\s+】/gu, "】")
    .replace(/【([^】]*)】/gu, (_, inner: string) => `【${inner.replace(/\s+/gu, "")}】`)
    .replace(/第\s*([一二三四五六七八九十]+)\s*学段/gu, "第$1学段")
    .replace(/小\s*学\s*部\s*分/gu, "小学部分")
    .replace(/初\s*中\s*部\s*分/gu, "初中部分")
    .replace(/\s+/gu, " ")
    .trim();
}

export function curriculumHeadingLevel(cleanLine: string): number | null {
  if (!cleanLine || cleanLine.length > 90) return null;
  if (/^附录/u.test(cleanLine)) return 1;
  if (/^[一二三四五六七八九十]+、\S/u.test(cleanLine)) return 1;
  if (/^（[一二三四五六七八九十]+）\S/u.test(cleanLine)) return 2;
  if (
    /^【[^】]+】$/u.test(cleanLine) ||
    /^第[一二三四五六七八九十]+学段(?:[（(][^）)]+[）)])?$/u.test(cleanLine) ||
    /^(?:小学部分|初中部分)$/u.test(cleanLine)
  ) {
    return 3;
  }
  return null;
}

function compact(value: string): string {
  return value.replace(/\s+/gu, "");
}

function isPublisherLine(cleanLine: string): boolean {
  const folded = compact(cleanLine);
  return (
    folded.includes("北京师范大学出版") ||
    folded === "中华人民共和国教育部制定" ||
    PUBLISHER_ENGLISH.test(cleanLine)
  );
}

function isCoverOrRunningTitle(cleanLine: string): boolean {
  const folded = compact(cleanLine).replace(/^[.．、]+/u, "");
  if (!folded) return false;
  if (
    folded === "义务教育" ||
    folded === "课程方案" ||
    folded === "语文课程标准" ||
    folded === "数学课程标准" ||
    folded === "物理课程标准" ||
    folded === "信息科技课程标准" ||
    folded === "(2022年版)" ||
    folded === "（2022年版）"
  ) {
    return true;
  }
  return RUNNING_TITLE.test(folded);
}

function isPrefaceOrContentsLabel(cleanLine: string): boolean {
  const folded = compact(cleanLine);
  return folded === "前言" || folded === "目录";
}

function isIsolatedFurnitureGlyph(cleanLine: string): boolean {
  return compact(cleanLine) === "工";
}

function isPageFurniture(
  rawLine: string,
  cleanLine: string,
  currentTopLevel: string | null,
): boolean {
  if (!cleanLine) return false;
  if (BOOKMARK_LINK.test(rawLine)) return true;
  if (isPublisherLine(cleanLine)) return true;
  if (isCoverOrRunningTitle(cleanLine)) return true;
  if (isPrefaceOrContentsLabel(cleanLine)) return true;
  if (isIsolatedFurnitureGlyph(cleanLine)) return true;
  if (ROMAN_ONLY.test(compact(cleanLine))) return true;
  const heading = normalizeCurriculumHeading(cleanLine);
  const level = curriculumHeadingLevel(heading);
  if (
    level === 1 &&
    currentTopLevel !== null &&
    heading === currentTopLevel &&
    !rawLine.includes('class="anchor"')
  ) {
    return true;
  }
  return false;
}

function joinSplitStageHeading(previous: string, current: string): string | null {
  const left = compact(previous);
  const right = compact(current).replace(/[.…·•]+$/u, "");
  if (left === "小学部" && right === "分") return "小学部分";
  if (left === "初中部" && right === "分") return "初中部分";
  return null;
}

export function cleanCurriculumMarkdown(markdown: string): string {
  const lines = markdown.normalize("NFC").replace(/\r\n?/gu, "\n").split("\n");
  const kept: string[] = [];
  let mode: "cover" | "contents" | "body" = "cover";
  let currentTopLevel: string | null = null;
  let pendingBlank = false;
  let ignoreBlanks = false;

  const pushLine = (value: string) => {
    const joined = kept.length > 0 ? joinSplitStageHeading(kept[kept.length - 1] ?? "", value) : null;
    if (joined) {
      kept[kept.length - 1] = joined;
      return;
    }
    kept.push(value);
  };

  const emitBodyLine = (value: string) => {
    if (pendingBlank) {
      pushLine("");
      pendingBlank = false;
    }
    pushLine(value);
  };

  for (const rawLine of lines) {
    if (BOOKMARK_LINK.test(rawLine)) {
      if (mode === "cover") mode = "contents";
      pendingBlank = false;
      ignoreBlanks = true;
      continue;
    }

    const cleanLine = stripCurriculumMarkup(rawLine);
    if (!cleanLine) {
      if (mode === "body" && !ignoreBlanks) pendingBlank = true;
      continue;
    }
    ignoreBlanks = false;

    const heading = normalizeCurriculumHeading(cleanLine);
    const level = curriculumHeadingLevel(heading);

    if (mode === "cover") {
      if (isCoverOrRunningTitle(cleanLine) || isPublisherLine(cleanLine)) continue;
      if (compact(cleanLine) === "目录") {
        mode = "contents";
        continue;
      }
      if (compact(cleanLine) === "前言") {
        mode = "body";
        currentTopLevel = heading;
        emitBodyLine(heading);
        continue;
      }
      mode = "body";
    }

    if (mode === "contents") {
      if (compact(cleanLine) === "目录") continue;
      if (isCoverOrRunningTitle(cleanLine) || isPublisherLine(cleanLine)) continue;
      if (level === 1 && !BOOKMARK_LINK.test(rawLine)) {
        mode = "body";
      } else {
        continue;
      }
    }

    if (isPageFurniture(rawLine, cleanLine, currentTopLevel)) {
      pendingBlank = false;
      ignoreBlanks = true;
      continue;
    }

    const emitted = level !== null ? heading : cleanLine;
    if (level === 1) currentTopLevel = heading;
    emitBodyLine(emitted);
  }

  return kept
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .concat("\n");
}
