function isDisabled(value: string | undefined): boolean {
  return ["0", "false", "no", "off"].includes(value?.toLowerCase() ?? "");
}

export type ClickthroughAudience = "ADMIN" | "TEACHER" | "STUDENT";

export function isClickthroughAuthEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (environment.NODE_ENV !== "development") {
    return false;
  }

  if (environment.VERCEL_ENV) {
    return false;
  }

  if (environment.E2E_RUN_MARKER || environment.STAGING_RUN_MARKER) {
    return false;
  }

  if (isDisabled(environment.DEV_CLICKTHROUGH_AUTH)) {
    return false;
  }

  return Boolean(
    environment.DEV_TEST_TEACHER_CLERK_ID &&
      environment.DEV_TEST_STUDENT_CLERK_ID,
  );
}

export function clickthroughAudienceFromPath(
  pathname: string | undefined,
): ClickthroughAudience | undefined {
  if (!pathname) {
    return undefined;
  }

  if (
    pathname.startsWith("/teacher") ||
    pathname.startsWith("/api/assistant")
  ) {
    return "TEACHER";
  }

  if (pathname.startsWith("/admin")) {
    return "ADMIN";
  }

  if (pathname.startsWith("/student")) {
    return "STUDENT";
  }

  return undefined;
}

function pathnameFromReferer(referer: string | null): string | undefined {
  if (!referer) {
    return undefined;
  }

  try {
    return new URL(referer).pathname;
  } catch {
    return undefined;
  }
}

export function resolveClickthroughAudience(input: {
  pathname?: string | null;
  referer?: string | null;
}): ClickthroughAudience | undefined {
  return (
    clickthroughAudienceFromPath(input.pathname ?? undefined) ??
    clickthroughAudienceFromPath(pathnameFromReferer(input.referer ?? null))
  );
}

export function clickthroughAuthSubject(
  audience: ClickthroughAudience,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (audience === "ADMIN") {
    return environment.DEV_TEST_ADMIN_CLERK_ID;
  }
  return audience === "TEACHER"
    ? environment.DEV_TEST_TEACHER_CLERK_ID
    : environment.DEV_TEST_STUDENT_CLERK_ID;
}
