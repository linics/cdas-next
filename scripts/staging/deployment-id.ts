export function buildDeploymentId(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return environment.CDAS_DEPLOYMENT_ID?.trim() ||
    environment.VERCEL_GIT_COMMIT_SHA?.trim() || "";
}
