#!/usr/bin/env bash
set -eo pipefail

node --input-type=module -e "import { rmSync } from 'node:fs'; rmSync('dist', { force: true, recursive: true })"
esbuild ./src/cli.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/cli.js --external:@aws-sdk/client-s3 --external:pg
esbuild ./src/cli/local-chunk-comparison-cli.ts ./src/cli/local-cli.ts ./src/cli/local-embedding-evaluation-cli.ts ./src/cli/local-embedding-sample-cli.ts ./src/cli/local-notice-question-generation-cli.ts ./src/cli/local-review-cli.ts --bundle --platform=node --format=esm --target=node24 --outdir=dist --external:@aws-sdk/client-s3 --external:pg
node --input-type=module -e "Promise.all([import('./dist/cli.js'), import('./dist/local-chunk-comparison-cli.js'), import('./dist/local-cli.js'), import('./dist/local-embedding-evaluation-cli.js'), import('./dist/local-embedding-sample-cli.js'), import('./dist/local-notice-question-generation-cli.js'), import('./dist/local-review-cli.js')])" "$@"
