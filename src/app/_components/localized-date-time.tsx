"use client";

import { useSyncExternalStore } from "react";

const explicitInstantPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

type FormatDateTimeOptions = Readonly<{
  locales?: Intl.LocalesArgument;
  timeZone?: string;
  includeSeconds?: boolean;
}>;

function dateTimeFormatOptions(
  options: FormatDateTimeOptions,
): Intl.DateTimeFormatOptions {
  return {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(options.includeSeconds ? { second: "2-digit" } : {}),
    hourCycle: "h23",
    timeZoneName: "short",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  };
}

function parseInstant(dateTime: string): Date {
  const parsed = new Date(dateTime);
  const [year, month, day] = dateTime
    .slice(0, 10)
    .split("-")
    .map(Number);
  const calendarDate = new Date(`${dateTime.slice(0, 10)}T00:00:00.000Z`);
  if (
    !explicitInstantPattern.test(dateTime) ||
    Number.isNaN(parsed.getTime()) ||
    Number.isNaN(calendarDate.getTime()) ||
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() + 1 !== month ||
    calendarDate.getUTCDate() !== day
  ) {
    throw new RangeError("dateTime must be a valid ISO instant with an offset");
  }
  return parsed;
}

const subscribeToHydration = () => () => {};
const hydratedSnapshot = () => true;
const serverSnapshot = () => false;

export function formatDateTimeInstant(
  dateTime: string,
  options: FormatDateTimeOptions = {},
): string {
  return new Intl.DateTimeFormat(
    options.locales,
    dateTimeFormatOptions(options),
  ).format(parseInstant(dateTime));
}

export function LocalizedDateTime({
  dateTime,
  includeSeconds = false,
}: {
  dateTime: string;
  includeSeconds?: boolean;
}) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    hydratedSnapshot,
    serverSnapshot,
  );
  const formatted = formatDateTimeInstant(dateTime, {
    includeSeconds,
    ...(hydrated
      ? {}
      : { locales: "zh-CN", timeZone: "UTC" }),
  });

  return <time dateTime={dateTime}>{formatted}</time>;
}
