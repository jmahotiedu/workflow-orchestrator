#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="${ROOT_DIR}/terraform"

AWS_REGION="${AWS_REGION:-us-east-1}"
TF_ENVIRONMENT="${TF_ENVIRONMENT:-demo}"
TF_STATE_KEY="${TF_STATE_KEY:-workflow-orchestrator/${TF_ENVIRONMENT}/terraform.tfstate}"
LOCK_TABLE_NAME="${LOCK_TABLE_NAME:-workflow-orchestrator-tf-lock-${TF_ENVIRONMENT}}"
TERRAFORM_BIN="${TERRAFORM_BIN:-terraform}"
AWS_CLI_BIN="${AWS_CLI_BIN:-aws}"
CURL_BIN="${CURL_BIN:-curl}"

for bin in "${AWS_CLI_BIN}" "${TERRAFORM_BIN}" "${CURL_BIN}"; do
  if ! command -v "${bin}" >/dev/null 2>&1; then
    echo "Required binary '${bin}' not found."
    exit 1
  fi
done

AWS_ACCOUNT_ID="$("${AWS_CLI_BIN}" sts get-caller-identity --query Account --output text)"
STATE_BUCKET="${STATE_BUCKET:-workflow-orchestrator-tf-state-${AWS_ACCOUNT_ID}-${AWS_REGION}}"

cd "${TF_DIR}"

"${TERRAFORM_BIN}" init -reconfigure \
  -backend-config="bucket=${STATE_BUCKET}" \
  -backend-config="key=${TF_STATE_KEY}" \
  -backend-config="region=${AWS_REGION}" \
  -backend-config="dynamodb_table=${LOCK_TABLE_NAME}" \
  -backend-config="encrypt=true" >/dev/null

ALB_URL="$("${TERRAFORM_BIN}" output -raw alb_url)"
API_HEALTH_URL="$("${TERRAFORM_BIN}" output -raw api_health_url)"

check_url() {
  local name="$1"
  local url="$2"
  local status_regex="$3"
  local attempts="${4:-24}"
  local sleep_seconds="${5:-10}"

  local i
  local http_code
  for ((i = 1; i <= attempts; i++)); do
    http_code="$("${CURL_BIN}" -sS -o /dev/null -w "%{http_code}" "${url}" || true)"
    if [[ "${http_code}" =~ ${status_regex} ]]; then
      echo "${name} check passed (${http_code}): ${url}"
      return 0
    fi
    echo "${name} not ready yet (attempt ${i}/${attempts}, status=${http_code})."
    sleep "${sleep_seconds}"
  done

  echo "${name} check failed after ${attempts} attempts: ${url}"
  return 1
}

echo "ALB URL:        ${ALB_URL}"
echo "API Health URL: ${API_HEALTH_URL}"

check_url "ALB root" "${ALB_URL}" "^(200|301|302)$"
check_url "API health" "${API_HEALTH_URL}" "^200$"

echo "Cloud smoke passed for workflow-orchestrator-clean-verify."
