#!/bin/sh
set -eu

fail() {
  printf '%s\n' "trial entrypoint: $*" >&2
  exit 1
}

require_value() {
  name="$1"
  value="$2"
  [ -n "$value" ] || fail "$name is required"
}

assert_ai_disabled() {
  [ "${AI_PROVIDER_DISABLED:-}" = "1" ] || \
    fail "AI_PROVIDER_DISABLED must be exactly 1 for this trial"

  for forbidden in DEEPSEEK_API_KEY AI_TOOL_APPROVAL_SECRET; do
    if [ -n "$(printenv "$forbidden" 2>/dev/null || true)" ]; then
      fail "$forbidden must not be present in this trial"
    fi
  done
}

assert_test_clerk() {
  require_value \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY \
    "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:-}"
  require_value CLERK_SECRET_KEY "${CLERK_SECRET_KEY:-}"

  case "${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" in
    pk_test_*) ;;
    *) fail "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a Clerk test key" ;;
  esac
  case "${CLERK_SECRET_KEY}" in
    sk_test_*) ;;
    *) fail "CLERK_SECRET_KEY must be a Clerk test key" ;;
  esac
}

assert_database() {
  require_value DATABASE_URL "${DATABASE_URL:-}"
  require_value DIRECT_URL "${DIRECT_URL:-}"
  require_value TRIAL_DATABASE_NAME "${TRIAL_DATABASE_NAME:-}"
}

command="${1:-app}"

case "$command" in
  migrate)
    assert_ai_disabled
    assert_database
    exec pnpm db:deploy
    ;;
  seed)
    assert_ai_disabled
    assert_database
    assert_test_clerk
    require_value DEV_TEST_TEACHER_CLERK_ID "${DEV_TEST_TEACHER_CLERK_ID:-}"
    require_value DEV_TEST_STUDENT_CLERK_ID "${DEV_TEST_STUDENT_CLERK_ID:-}"
    exec pnpm demo:seed -- --confirm-database "$TRIAL_DATABASE_NAME"
    ;;
  app)
    assert_ai_disabled
    assert_database
    assert_test_clerk

    # A new/recreated application container has no .next directory. Retaining
    # the existing artifact across a plain restart avoids another memory-heavy
    # build while keeping every source update tied to a fresh container.
    if [ ! -f .next/BUILD_ID ]; then
      pnpm build
    fi

    exec pnpm exec next start --hostname 0.0.0.0 --port "${PORT:-3000}"
    ;;
  *)
    exec "$@"
    ;;
esac
