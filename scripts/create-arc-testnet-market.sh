#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

if [[ -f "$ROOT_DIR/contracts/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/contracts/.env"
  set +a
fi

RPC_URL="${ARC_TESTNET_RPC_URL:-${RPC:-https://rpc.testnet.arc.network}}"
DEPLOYMENT_PATH="$ROOT_DIR/contracts/deployments/arc-testnet.json"

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  echo "PRIVATE_KEY is required. Export the funded Arc testnet creator key before running." >&2
  exit 1
fi

if [[ -z "${IKNOW_FACTORY_ADDRESS:-}" ]]; then
  IKNOW_FACTORY_ADDRESS="$(node -e "console.log(require(process.argv[1]).contracts.iknowMarketFactory.address)" "$DEPLOYMENT_PATH")"
  export IKNOW_FACTORY_ADDRESS
fi

if [[ -z "${IKNOW_USDC_ADDRESS:-}" ]]; then
  IKNOW_USDC_ADDRESS="$(node -e "console.log(require(process.argv[1]).contracts.usdc.address)" "$DEPLOYMENT_PATH")"
  export IKNOW_USDC_ADDRESS
fi

cd "$ROOT_DIR/contracts"
cd "$ROOT_DIR"
ARC_TESTNET_RPC_URL="$RPC_URL" node scripts/create-arc-testnet-market.mjs "$@"
