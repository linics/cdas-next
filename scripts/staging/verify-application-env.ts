export function shouldLoadLocalStagingEnvironment(environment: Readonly<Record<string, string | undefined>>): boolean {
  return environment.CDAS_SKIP_LOCAL_ENV_CONFIG !== "1";
}
