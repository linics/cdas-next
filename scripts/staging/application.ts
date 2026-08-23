import type { StagingCheck } from "./contracts";

export type ApplicationVerificationResult = Readonly<{
  schema: "staging-application.v1";
  status: "PASS" | "FAIL";
  checks: readonly StagingCheck[];
  stagingSyntheticDecision: "GO" | "NO_GO";
  realStudentDataAllowed: false;
  productionDecision: "NO_GO";
}>;

export function evaluateHealthResponse(input: Readonly<{
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
