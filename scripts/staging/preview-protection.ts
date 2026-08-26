export const vercelAutomationBypassSecretName =
  "STAGING_VERCEL_AUTOMATION_BYPASS_SECRET";

const validBypassSecret = /^[A-Za-z0-9]{32}$/u;
const validProjectName = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u;
const validDeploymentName = /^[a-z0-9](?:[a-z0-9-]{0,251}[a-z0-9])?$/u;

/**
 * Returns only the request header Vercel accepts for its Deployment
 * Protection Automation Bypass. The value stays in process memory and is
 * deliberately never suitable for query strings or serialized evidence.
 */
export function vercelAutomationBypassHeaders(
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const secret = environment[vercelAutomationBypassSecretName]?.trim() ?? "";
  if (!secret) {
    return {};
  }
  if (!validBypassSecret.test(secret)) {
    throw new Error("STAGING_VERCEL_AUTOMATION_BYPASS_SECRET_INVALID");
  }
  return { "x-vercel-protection-bypass": secret };
}

export function stagingHealthRequestHeaders(
  deploymentProtectionRequired: boolean,
  environment: Readonly<Record<string, string | undefined>>,
  challenge: string,
): Readonly<Record<string, string>> {
  return {
    accept: "application/json",
    "x-cdas-health-challenge": challenge,
    ...(deploymentProtectionRequired
      ? vercelAutomationBypassHeaders(environment)
      : {}),
  };
}

export function isValidVercelAutomationBypassSecret(value: string): boolean {
  return validBypassSecret.test(value);
}

export function isValidVercelProjectName(value: string): boolean {
  return validProjectName.test(value.trim().toLowerCase());
}

export function isAllowedVercelPreviewBaseUrl(
  baseUrl: string,
  projectName: string,
): boolean {
  const project = projectName.trim().toLowerCase();
  if (!isValidVercelProjectName(project)) {
    return false;
  }
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "" && url.pathname !== "/") ||
      (url.port !== "" && url.port !== "443")
    ) {
      return false;
    }
    const suffix = ".vercel.app";
    const hostname = url.hostname.toLowerCase();
    const prefix = `${project}-`;
    if (!hostname.endsWith(suffix) || !hostname.startsWith(prefix)) {
      return false;
    }
    const deployment = hostname.slice(prefix.length, -suffix.length);
    return validDeploymentName.test(deployment) && !deployment.includes(".");
  } catch {
    return false;
  }
}
