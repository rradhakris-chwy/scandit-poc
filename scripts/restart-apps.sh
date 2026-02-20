#!/usr/bin/env bash
# Stop then start all three apps.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec "$ROOT/scripts/start-apps.sh" --restart
