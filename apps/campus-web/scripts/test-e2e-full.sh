#!/usr/bin/env bash
set -eo pipefail

pnpm run build:fixture
CAMPUS_WEB_E2E_PREBUILT=1 pnpm run test:e2e
CAMPUS_WEB_E2E_PREBUILT=1 pnpm run test:e2e:worker
CAMPUS_WEB_E2E_PREBUILT=1 pnpm run test:e2e:ui-baseline "$@"
