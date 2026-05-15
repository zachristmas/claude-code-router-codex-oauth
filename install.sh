#!/usr/bin/env bash
set -euo pipefail

# Unix convenience wrapper. The real installer is cross-platform Node:
#   node scripts/install.js
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/install.js" "$@"
