#!/usr/bin/env bash
set -eo pipefail

node --input-type=module -e "import { rmSync } from 'node:fs'; rmSync('dist', { force: true, recursive: true })"
esbuild ./src/cli.ts --bundle --platform=node --format=esm --target=node24 --outfile=dist/cli.js --external:@aws-sdk/client-s3 --external:pg --external:jsdom
node --input-type=module -e "import('./dist/cli.js')" "$@"
