#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${NUTRIBODYSIM_POSTGRES_TEST_URL:-}" ]]; then
  printf '%s\n' 'NUTRIBODYSIM_POSTGRES_TEST_URL is required; use a fresh loopback-only nutribodysim_test database.' >&2
  exit 2
fi

node --input-type=module -e '
  const url = new URL(process.env.NUTRIBODYSIM_POSTGRES_TEST_URL);
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !loopback || database !== "nutribodysim_test") {
    process.stderr.write("PostgreSQL runtime integration requires loopback database nutribodysim_test.\n");
    process.exit(1);
  }
'

npx vitest run --maxWorkers=1 --no-file-parallelism backend/__tests__/database/postgresRuntime.integration.test.ts