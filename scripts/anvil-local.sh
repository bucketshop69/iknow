#!/usr/bin/env bash
set -euo pipefail

exec anvil \
  --host 127.0.0.1 \
  --port "${LOCAL_ANVIL_PORT:-8545}" \
  --chain-id "${LOCAL_CHAIN_ID:-31337}" \
  --allow-origin "*" \
  --accounts 10 \
  --balance 10000
