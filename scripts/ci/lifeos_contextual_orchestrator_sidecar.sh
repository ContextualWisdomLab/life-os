#!/usr/bin/env bash
set -Eeuo pipefail

readonly ORCHESTRATOR_PIN_SHA='045d17da5e2aea56a97e241ee158ab1628d78660'
readonly ORCHESTRATOR_REPOSITORY='https://github.com/ContextualWisdomLab/contextual-orchestrator.git'
readonly ORCHESTRATOR_ROUTE='orchestrator/free'

: "${CONTEXTUAL_ORCHESTRATOR_TOKEN:?CONTEXTUAL_ORCHESTRATOR_TOKEN is required}"

provider_credential_count=0
for credential_name in \
  BYTEZ_API_KEY \
  NVIDIA_NIM_API_KEY \
  NVIDIA_NIM_API_KEY_SUB \
  OPENROUTER_API_KEY \
  OPENAI_API_KEY
do
  if [[ -n "${!credential_name:-}" ]]; then
    provider_credential_count=$((provider_credential_count + 1))
  fi
done

if [[ "$provider_credential_count" -eq 0 ]]; then
  echo 'contextual-orchestrator bootstrap requires at least one governed provider credential' >&2
  exit 78
fi

sidecar_root="${LIFEOS_ORCHESTRATOR_SIDECAR_ROOT:-${RUNNER_TEMP:?RUNNER_TEMP is required}/lifeos-contextual-orchestrator}"
port="${LIFEOS_ORCHESTRATOR_GATEWAY_PORT:-8000}"
case "$port" in
  ''|*[!0-9]*)
    echo 'LIFEOS_ORCHESTRATOR_GATEWAY_PORT must be a decimal TCP port' >&2
    exit 64
    ;;
esac
if (( port < 1024 || port > 65535 )); then
  echo 'LIFEOS_ORCHESTRATOR_GATEWAY_PORT must be between 1024 and 65535' >&2
  exit 64
fi

source_dir="$sidecar_root/source"
python_env="$sidecar_root/python"
install -d -m 0700 "$sidecar_root"
rm -rf "$source_dir" "$python_env"

git clone --quiet --filter=blob:none --no-checkout "$ORCHESTRATOR_REPOSITORY" "$source_dir"
git -C "$source_dir" checkout --quiet --detach "$ORCHESTRATOR_PIN_SHA"
actual_sha="$(git -C "$source_dir" rev-parse HEAD)"
if [[ "$actual_sha" != "$ORCHESTRATOR_PIN_SHA" ]]; then
  echo "contextual-orchestrator checkout mismatch: expected $ORCHESTRATOR_PIN_SHA, got $actual_sha" >&2
  exit 70
fi

python3 -m venv "$python_env"
"$python_env/bin/python" -m pip install \
  --disable-pip-version-check \
  --require-hashes \
  --no-deps \
  --requirement "$source_dir/requirements.lock"

cd "$source_dir"
export PYTHONPATH="$source_dir"
exec "$python_env/bin/python" -m scripts.ci.serve_seeded_gateway \
  --serve \
  --agents "$source_dir/examples/agents.mock.json" \
  --auto-discover-model-agents \
  --auth-token-key CONTEXTUAL_ORCHESTRATOR_TOKEN \
  --host 127.0.0.1 \
  --port "$port"
