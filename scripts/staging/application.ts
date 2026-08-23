import type { StagingCheck } from "./contracts";

export type ApplicationVerificationResult = Readonly<{
  schema: "staging-application.v1";
  status: "PASS" | "FAIL";
  checks: readonly StagingCheck[];
  stagingSyntheticDecision: "GO" | "NO_GO";
  realStudentDataAllowed: false;
  productionDecision: "NO_GO";
}>;

function isExactSsoChallengeUrl(value: unknown, healthUrl: string): boolean {
  if (typeof value !== "string") return false;
  try {
    const location = new URL(value);
    return (
      location.protocol === "https:" &&
      location.hostname === "vercel.com" &&
      location.port === "" &&
      !location.username &&
      !location.password &&
      location.pathname === "/sso-api" &&
      !location.hash &&
      location.searchParams.size === 2 &&
      location.searchParams.get("url") === healthUrl &&
      /^[a-f0-9]{64}$/u.test(location.searchParams.get("nonce") ?? "")
    );
  } catch {
    return false;
  }
}

export function isVercelDeploymentProtectionResponse(input: Readonly<{
  status: number;
  server: string | null;
  vercelId: string | null;
  location: string | null;
  healthUrl: string;
  contentType?: string | null;
  cacheControl?: string | null;
  body?: unknown;
}>): boolean {
  if (input.server?.trim().toLowerCase() !== "vercel" || !input.vercelId?.trim()) return false;
  if ([302, 307, 308].includes(input.status)) return isExactSsoChallengeUrl(input.location, input.healthUrl);
  const cacheDirectives = input.cacheControl?.split(",").map((directive) => directive.trim().toLowerCase()).filter(Boolean) ?? [];
  const exactNoStore = cacheDirectives.length === 2 && cacheDirectives.includes("no-store") && cacheDirectives.includes("max-age=0");
  if (input.status !== 401 || input.location || input.contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" || !exactNoStore) return false;
  if (!input.body || typeof input.body !== "object" || Array.isArray(input.body) || Object.keys(input.body).sort().join(",") !== "error,protection") return false;
  const body = input.body as Record<string, unknown>;
  if (!body.error || typeof body.error !== "object" || Array.isArray(body.error) || Object.keys(body.error).sort().join(",") !== "code,message") return false;
  const error = body.error as Record<string, unknown>;
  if (error.code !== "401" || error.message !== "Protected deployment") return false;
  if (!body.protection || typeof body.protection !== "object" || Array.isArray(body.protection) || Object.keys(body.protection).sort().join(",") !== "auto_vercel_auth_redirect,password_enabled,vercel_auth_callback,vercel_auth_enabled") return false;
  const protection = body.protection as Record<string, unknown>;
  return protection.auto_vercel_auth_redirect === true && protection.password_enabled === false && protection.vercel_auth_enabled === true && isExactSsoChallengeUrl(protection.vercel_auth_callback, input.healthUrl);
}

export function evaluateHealthResponse(input: Readonly<{
  deploymentAccessModeVerified: boolean;
  status: number;
  cacheControl: string | null;
  body: unknown;
  expectedDeploymentId: string;
  expectedConfigurationProof: string;
  expectedSourceFingerprint: string;
}>): ApplicationVerificationResult {
  const exactBody =
    typeof input.body === "object" &&
    input.body !== null &&
    Object.keys(input.body).length === 4 &&
    "status" in input.body &&
    input.body.status === "ok" &&
    "deploymentId" in input.body &&
    input.body.deploymentId === input.expectedDeploymentId &&
    "configurationProof" in input.body &&
    input.body.configurationProof === input.expectedConfigurationProof &&
    "sourceFingerprint" in input.body &&
    input.body.sourceFingerprint === input.expectedSourceFingerprint;
  const checks: StagingCheck[] = [
    { code: "APPLICATION_DEPLOYMENT_ACCESS_MODE_VERIFIED", status: input.deploymentAccessModeVerified ? "PASS" : "FAIL" },
    { code: "APPLICATION_HEALTH_HTTP_200", status: input.status === 200 ? "PASS" : "FAIL" },
    {
      code: "APPLICATION_HEALTH_NO_STORE",
      status: input.cacheControl?.toLowerCase().includes("no-store") ? "PASS" : "FAIL",
    },
    { code: "APPLICATION_HEALTH_EXACT_BODY", status: exactBody ? "PASS" : "FAIL" },
    {
      code: "APPLICATION_DEPLOYMENT_ID_MATCHES",
      status:
        typeof input.body === "object" &&
        input.body !== null &&
        "deploymentId" in input.body &&
        input.body.deploymentId === input.expectedDeploymentId
          ? "PASS"
          : "FAIL",
    },
    {
      code: "APPLICATION_CONFIGURATION_PROOF_MATCHES",
      status:
        typeof input.body === "object" &&
        input.body !== null &&
        "configurationProof" in input.body &&
        input.body.configurationProof === input.expectedConfigurationProof
          ? "PASS"
          : "FAIL",
    },
    {
      code: "APPLICATION_SOURCE_FINGERPRINT_MATCHES",
      status: typeof input.body === "object" && input.body !== null && "sourceFingerprint" in input.body && input.body.sourceFingerprint === input.expectedSourceFingerprint ? "PASS" : "FAIL",
    },
  ];
  const status = checks.every((check) => check.status === "PASS") ? "PASS" : "FAIL";
  return {
    schema: "staging-application.v1",
    status,
    checks,
    stagingSyntheticDecision: status === "PASS" ? "GO" : "NO_GO",
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}

export function failedApplicationVerification(code: string): ApplicationVerificationResult {
  return {
    schema: "staging-application.v1",
    status: "FAIL",
    checks: [{ code, status: "FAIL" }],
    stagingSyntheticDecision: "NO_GO",
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}
