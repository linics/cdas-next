#!/bin/sh
set -eu

fail() { printf '%s\n' "trial environment bootstrap: $*" >&2; exit 1; }
output_file="${1:?usage: bootstrap-runtime-env.sh RUNTIME_ENV_FILE DEPLOYMENT_ID}"
deployment_id="${2:?usage: bootstrap-runtime-env.sh RUNTIME_ENV_FILE DEPLOYMENT_ID}"
[ ! -e "$output_file" ] || fail "runtime environment already exists; refusing to replace it"
command -v openssl >/dev/null 2>&1 || fail "openssl is required"
database_password=$(openssl rand -hex 32)
demo_teacher_password=$(openssl rand -base64 24 | tr -d '\n')
database_name="cdas_next_v3_trial"; database_user="cdas_trial"
database_url="postgresql://${database_user}:${database_password}@database:5432/${database_name}?schema=public"
parent_dir=$(dirname "$output_file")
mkdir -p "$parent_dir"; chmod 700 "$parent_dir"; umask 077
temporary_file="${output_file}.tmp.$$"
trap 'rm -f "$temporary_file"' EXIT HUP INT TERM
{
  printf '%s=%s\n' TRIAL_DATABASE_NAME "$database_name"
  printf '%s=%s\n' POSTGRES_USER "$database_user"
  printf '%s=%s\n' POSTGRES_PASSWORD "$database_password"
  printf '%s=%s\n' TRIAL_DEMO_TEACHER_PASSWORD "$demo_teacher_password"
  printf '%s=%s\n' DATABASE_URL "$database_url"
  printf '%s=%s\n' DIRECT_URL "$database_url"
  printf '%s=%s\n' CDAS_DEPLOYMENT_ID "$deployment_id"
  printf '%s=%s\n' CDAS_PUBLIC_ORIGIN "http://127.0.0.1:3001"
  printf '%s=%s\n' AI_PROVIDER_DISABLED "1"
  printf '%s=%s\n' ATTACHMENT_STORAGE_ENABLED "0"
} > "$temporary_file"
chmod 600 "$temporary_file"; mv "$temporary_file" "$output_file"; trap - EXIT HUP INT TERM
printf '%s\n' "Created isolated runtime environment with local PostgreSQL authentication."
