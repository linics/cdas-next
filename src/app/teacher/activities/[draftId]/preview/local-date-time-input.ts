const localDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;

export function localDateTimeToIsoInstant(value: string): string | null {
  if (value === "") {
    return "";
  }

  const parts = localDateTimePattern.exec(value);
  if (!parts) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const expected = parts.slice(1).map((part) => Number(part ?? "0"));
  const actual = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];
  if (actual.some((part, index) => part !== expected[index])) {
    return null;
  }

  return date.toISOString();
}
