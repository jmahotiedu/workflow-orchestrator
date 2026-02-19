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
API_TOKEN="${API_TOKEN:-admin-token}"
SMOKE_WORKFLOW_NAME="${SMOKE_WORKFLOW_NAME:-cloud-smoke-workflow}"
SMOKE_DEFINITION='{"version":1,"tasks":[{"id":"a","name":"smoke-start","kind":"noop","config":{"durationMs":10}}]}'

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

workflows_response="$("${CURL_BIN}" -sS -w "\n%{http_code}" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  "${ALB_URL}/api/workflows")"
workflows_body="${workflows_response%$'\n'*}"
workflows_status="${workflows_response##*$'\n'}"
if [[ "${workflows_status}" != "200" ]]; then
  echo "Authenticated workflows check failed (${workflows_status}): ${ALB_URL}/api/workflows"
  exit 1
fi
echo "Authenticated workflows check passed (${workflows_status})."

create_response="$("${CURL_BIN}" -sS -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${SMOKE_WORKFLOW_NAME}\",\"definition\":${SMOKE_DEFINITION},\"maxConcurrentRuns\":2}" \
  "${ALB_URL}/api/workflows")"
create_body="${create_response%$'\n'*}"
create_status="${create_response##*$'\n'}"
if [[ "${create_status}" != "201" && "${create_status}" != "409" ]]; then
  echo "Workflow create smoke failed (${create_status}): ${create_body}"
  exit 1
fi
echo "Workflow create smoke passed (${create_status})."

if [[ "${create_status}" == "201" ]]; then
  workflow_id="$(printf '%s' "${create_body}" | python -c 'import json,sys; 
try:
    payload=json.loads(sys.stdin.read())
    print(payload.get("workflow", {}).get("id", ""))
except Exception:
    print("")
')"
  if [[ -n "${workflow_id}" ]]; then
    trigger_status="$("${CURL_BIN}" -sS -o /dev/null -w "%{http_code}" \
      -X POST \
      -H "Authorization: Bearer ${API_TOKEN}" \
      -H "Content-Type: application/json" \
      -H "Idempotency-Key: cloud-smoke-${workflow_id}" \
      -d '{"triggerSource":"manual"}' \
      "${ALB_URL}/api/workflows/${workflow_id}/trigger")"
    if [[ "${trigger_status}" != "201" && "${trigger_status}" != "200" ]]; then
      echo "Workflow trigger smoke failed (${trigger_status}) for ${workflow_id}."
      exit 1
    fi
    echo "Workflow trigger smoke passed (${trigger_status})."
  else
    echo "Workflow create returned 201 but ID extraction failed; skipping trigger probe."
  fi
fi

echo "Cloud smoke passed for workflow-orchestrator-clean-verify."
