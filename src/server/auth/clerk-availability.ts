function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.toLowerCase() ?? "");
}

export function isClerkAuthenticationAvailable(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const hasConfiguredKeys = Boolean(
    environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
      environment.CLERK_SECRET_KEY,
  );

  const canUseKeylessDevelopment =
    environment.NODE_ENV === "development" &&
    !isEnabled(environment.NEXT_PUBLIC_CLERK_KEYLESS_DISABLED);

  return hasConfiguredKeys || canUseKeylessDevelopment;
}
