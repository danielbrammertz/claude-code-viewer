#!/usr/bin/env bash

set -euxo pipefail

if [ -d "dist" ]; then
  rm -rf dist
fi

pnpm lingui:compile
pnpm build:frontend
pnpm build:backend

cp scripts/acpx-session-url.mjs dist/
