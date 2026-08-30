#!/bin/sh
set -eu

fail() {
  printf '%s\n' "trial environment bootstrap: $*" >&2
  exit 1
}

input_file="${1:?usage: bootstrap-runtime-env.sh CLERK_ENV_FILE RUNTIME_ENV_FILE DEPLOYMENT_ID}"
output_file="${2:?usage: bootstrap-runtime-env.sh CLERK_ENV_FILE RUNTIME_ENV_FILE DEPLOYMENT_ID}"
deployment_id="${3:?usage: bootstrap-runtime-env.sh CLERK_ENV_FILE RUNTIME_ENV_FILE DEPLOYMENT_ID}"

[ -r "$input_file" ] || fail "cannot read Clerk environment file"
[ ! -e "$output_file" ] || fail "runtime environment already exists; refusing to replace it"

publishable_key=""
secret_key=""
teacher_id=""
student_id=""
cr=$(printf '\r')

while IFS= read -r line || [ -n "$line" ]; do
  line=${line%"$cr"}
  case "$line" in
    "" | \#*)
      continue
      ;;
    *=*)
      key=${line%%=*}
      value=${line#*=}
      [ -n "$value" ] || fail "$key must not be empty"
      case "$key" in
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
          [ -z "$publishable_key" ] || fail "duplicate $key"
          publishable_key=$value
          ;;
        CLERK_SECRET_KEY)
          [ -z "$secret_key" ] || fail "duplicate $key"
          secret_key=$value
          ;;
        DEV_TEST_TEACHER_CLERK_ID)
          [ -z "$teacher_id" ] || fail "duplicate $key"
          teacher_id=$value
          ;;
        DEV_TEST_STUDENT_CLERK_ID)
          [ -z "$student_id" ] || fail "duplicate $key"
          student_id=$value
          ;;
        *)
          fail "unsupported key $key"
          ;;
      esac
      ;;
    *)
      fail "invalid line in Clerk environment file"
      ;;
  esac
done < "$input_file"

[ -n "$publishable_key" ] || fail "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required"
[ -n "$secret_key" ] || fail "CLERK_SECRET_KEY is required"
[ -n "$teacher_id" ] || fail "DEV_TEST_TEACHER_CLERK_ID is required"
[ -n "$student_id" ] || fail "DEV_TEST_STUDENT_CLERK_ID is required"

case "$publishable_key" in pk_test_*) ;; *) fail "publishable key must be pk_test_..." ;; esac
case "$secret_key" in sk_test_*) ;; *) fail "secret key must be sk_test_..." ;; esac
case "$teacher_id" in user_*) ;; *) fail "teacher ID must be user_..." ;; esac
case "$student_id" in user_*) ;; *) fail "student ID must be user_..." ;; esac

command -v openssl >/dev/null 2>&1 || fail "openssl is required"
database_password=$(openssl rand -hex 32)
database_name="cdas_next_v3_trial"
database_user="cdas_trial"
database_url="postgresql://${database_user}:${database_password}@database:5432/${database_name}?schema=public"

parent_dir=$(dirname "$output_file")
mkdir -p "$parent_dir"
chmod 700 "$parent_dir"
umask 077
temporary_file="${output_file}.tmp.$$"
trap 'rm -f "$temporary_file"' EXIT HUP INT TERM

write_value() {
  printf '%s=%s\n' "$1" "$2"
}

{
  write_value TRIAL_DATABASE_NAME "$database_name"
  write_value POSTGRES_USER "$database_user"
  write_value POSTGRES_PASSWORD "$database_password"
  write_value DATABASE_URL "$database_url"
  write_value DIRECT_URL "$database_url"
  write_value NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY "$publishable_key"
  write_value CLERK_SECRET_KEY "$secret_key"
  write_value DEV_TEST_TEACHER_CLERK_ID "$teacher_id"
  write_value DEV_TEST_STUDENT_CLERK_ID "$student_id"
  write_value CDAS_DEPLOYMENT_ID "$deployment_id"
  write_value CDAS_PUBLIC_ORIGIN "http://127.0.0.1:3001"
  write_value AI_PROVIDER_DISABLED "1"
  write_value ATTACHMENT_STORAGE_ENABLED "0"
} > "$temporary_file"

chmod 600 "$temporary_file"
mv "$temporary_file" "$output_file"
trap - EXIT HUP INT TERM
printf '%s\n' "Created isolated runtime environment without AI credentials."
