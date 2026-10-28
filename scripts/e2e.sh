#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
frontend_dir=$(dirname "$script_dir")
repo_dir=$(dirname "$frontend_dir")
cd "$frontend_dir"

project=danewcard-e2e
export CARGO_TARGET_DIR=${E2E_CARGO_TARGET_DIR:-$repo_dir/backend/target/e2e}
export POSTGRES_DB=danewcard_e2e
export POSTGRES_HOST_PORT=55432
export POSTGRES_PASSWORD=local-dev-only
export POSTGRES_ADMIN_PASSWORD=local-dev-admin-only
export POSTGRES_MIGRATOR_PASSWORD=local-dev-migrator-only
export SPACEX_PROVIDER_CODE=spacex
export SPACEX_WEBHOOK_SECRET=playwright-spacex-webhook-secret-32
export SPACEX_LIFECYCLE_WEBHOOK_SECRET=playwright-spacex-lifecycle-secret-32
cleanup() {
  docker compose -p "$project" -f "$repo_dir/compose.yaml" down --volumes --remove-orphans
}
trap cleanup EXIT

cleanup
docker compose -p "$project" -f "$repo_dir/compose.yaml" up -d --wait --build postgres

# sqlx embeds migrations at compile time; rebuild only the isolated E2E package so a new
# migration can never be tested against a stale migrator binary.
cargo clean --quiet --manifest-path "$repo_dir/backend/Cargo.toml" --package danew-card-api
DATABASE_URL=postgresql://danew_migrator:local-dev-migrator-only@127.0.0.1:55432/danewcard_e2e \
  cargo run --locked --quiet --manifest-path "$repo_dir/backend/Cargo.toml" --bin danew-card-migrate

# This disposable database alone permits the deterministic E2E reset; production keeps no TRUNCATE grant.
docker compose -p "$project" -f "$repo_dir/compose.yaml" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U danewcard -d danewcard_e2e \
  -c "GRANT TRUNCATE ON ALL TABLES IN SCHEMA public TO danew_app" >/dev/null

E2E_DATABASE_URL=postgresql://danew_app:local-dev-only@127.0.0.1:55432/danewcard_e2e \
E2E_API_PORT=18080 E2E_WEB_PORT=15173 npx playwright test "$@"
