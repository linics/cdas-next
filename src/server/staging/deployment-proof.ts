import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type DeploymentProofInput = Readonly<{
  deploymentId: string | undefined;
  databaseUrl: string | undefined;
  sourceFingerprint: string | undefined;
  clerkPublishableKey: string | undefined;
  clerkSecretKey: string | undefined;
  aiProviderDisabled: string | undefined;
  aiGatewayApiKey?: string | undefined;
  aiModel?: string | undefined;
  aiToolApprovalSecret?: string | undefined;
  secret: string | undefined;
  challenge?: string | undefined;
}>;

export type DeploymentConfiguration = Readonly<{
  deploymentId: string;
  databaseIdentity: string;
  databaseUrlHash: string;
  sourceFingerprint: string;
  clerkPublishableKey: string;
  clerkSecretKeyHash: string;
  aiProviderDisabled: "0" | "1";
  aiGatewayApiKeyHash?: string;
  aiModel?: string;
  aiToolApprovalSecretHash?: string;
  challenge: string;
}>;

function canonicalHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, "").replace(/^\[|\]$/gu, "");
}

function ipv4Octets(hostname: string): number[] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) {
    return undefined;
  }
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : undefined;
}

export function isPublicHostname(hostname: string): boolean {
  const normalized = canonicalHostname(hostname);
  if (!normalized || normalized === "localhost" || normalized.endsWith(".localhost")) {
    return false;
  }
  if (
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan")
  ) {
    return false;
  }
  const ipv4 = ipv4Octets(normalized);
  if (ipv4) {
    const [first, second] = ipv4;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }
  if (normalized.includes(":")) {
    const compact = normalized.toLowerCase();
    return !(
      compact === "::" ||
      compact === "::1" ||
      compact.startsWith("::ffff:") ||
      compact.startsWith("fc") ||
      compact.startsWith("fd") ||
      /^fe[89ab]/u.test(compact) ||
      compact.startsWith("ff")
    );
  }
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u.test(
    normalized,
  );
}

export function parseRuntimeDatabaseIdentity(
  rawValue: string | undefined,
): string | undefined {
  try {
    const url = new URL(rawValue?.trim() ?? "");
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      return undefined;
    }
    const hostname = canonicalHostname(url.hostname);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
    const pooled = hostname.split(".")[0]?.endsWith("-pooler") || url.searchParams.get("pgbouncer")?.toLowerCase() === "true";
    const tls = ["require", "verify-ca", "verify-full"].includes(
      url.searchParams.get("sslmode")?.toLowerCase() ?? "",
    );
    if (
      !isPublicHostname(hostname) ||
      !databaseName ||
      databaseName.includes("/") ||
      url.hash ||
      !pooled ||
      !tls
    ) {
      return undefined;
    }
    return `${hostname}:${url.port || "5432"}/${databaseName}`;
  } catch {
    return undefined;
  }
}

export function deploymentConfiguration(
  input: DeploymentProofInput,
): DeploymentConfiguration | undefined {
  const deploymentId = input.deploymentId?.trim().toLowerCase() ?? "";
  const databaseIdentity = parseRuntimeDatabaseIdentity(input.databaseUrl);
  const sourceFingerprint = input.sourceFingerprint?.trim().toLowerCase() ?? "";
  const clerkPublishableKey = input.clerkPublishableKey?.trim() ?? "";
  const clerkSecretKey = input.clerkSecretKey?.trim() ?? "";
  const aiProviderDisabled = input.aiProviderDisabled?.trim() ?? "";
  const aiGatewayApiKey = input.aiGatewayApiKey?.trim() ?? "";
  const aiModel = input.aiModel?.trim() ?? "";
  const aiToolApprovalSecret = input.aiToolApprovalSecret ?? "";
  const challenge = input.challenge?.trim().toLowerCase() ?? "";
  const aiEnabled = aiProviderDisabled === "0";
  const validEnabledAiConfiguration =
    aiGatewayApiKey.length >= 16 &&
    aiGatewayApiKey.length <= 2_000 &&
    /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(aiModel) &&
    aiToolApprovalSecret.length >= 32 &&
    aiToolApprovalSecret.length <= 4_096;
  if (
    !/^[a-f0-9]{40}$/u.test(deploymentId) ||
    !databaseIdentity ||
    !/^[a-f0-9]{64}$/u.test(sourceFingerprint) ||
    !/^pk_test_[A-Za-z0-9_-]{10,}$/u.test(clerkPublishableKey) ||
    !/^sk_test_[A-Za-z0-9_-]{10,}$/u.test(clerkSecretKey) ||
    (aiProviderDisabled !== "1" && aiProviderDisabled !== "0") ||
    (aiEnabled && !validEnabledAiConfiguration) ||
    !/^[a-f0-9]{32,128}$/u.test(challenge)
  ) {
    return undefined;
  }
  const configuration: DeploymentConfiguration = {
    deploymentId,
    databaseIdentity,
    databaseUrlHash: createHash("sha256").update(input.databaseUrl?.trim() ?? "", "utf8").digest("hex"),
    sourceFingerprint,
    clerkPublishableKey,
    clerkSecretKeyHash: createHash("sha256")
      .update(clerkSecretKey, "utf8")
      .digest("hex"),
    aiProviderDisabled: aiEnabled ? "0" : "1",
    challenge,
  };
  if (aiEnabled) {
    return {
      ...configuration,
      aiGatewayApiKeyHash: createHash("sha256")
        .update(aiGatewayApiKey, "utf8")
        .digest("hex"),
      aiModel,
      aiToolApprovalSecretHash: createHash("sha256")
        .update(aiToolApprovalSecret, "utf8")
        .digest("hex"),
    };
  }
  return configuration;
}

function hasValidSecret(secret: string | undefined): secret is string {
  const length = secret ? Buffer.byteLength(secret, "utf8") : 0;
  return length >= 32 && length <= 4_096;
}

export function createDeploymentConfigurationProof(
  input: DeploymentProofInput,
): string | undefined {
  const configuration = deploymentConfiguration(input);
  if (!configuration || !hasValidSecret(input.secret)) {
    return undefined;
  }
  return createHmac("sha256", input.secret)
    .update(JSON.stringify(configuration), "utf8")
    .digest("hex");
}

export function deploymentConfigurationProofMatches(
  input: DeploymentProofInput,
  actualProof: string | undefined,
): boolean {
  const expectedProof = createDeploymentConfigurationProof(input);
  if (!expectedProof || !actualProof || !/^[a-f0-9]{64}$/u.test(actualProof)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expectedProof, "hex"), Buffer.from(actualProof, "hex"));
}
