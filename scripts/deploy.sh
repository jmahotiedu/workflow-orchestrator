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
IMAGE_TAG="${IMAGE_TAG:-latest}"
APPLY="${APPLY:-true}"

if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "DB_PASSWORD is required."
  exit 1
fi

if ! command -v "${AWS_CLI_BIN}" >/dev/null 2>&1; then
  echo "aws CLI binary '${AWS_CLI_BIN}' not found."
  exit 1
fi

if ! command -v "${TERRAFORM_BIN}" >/dev/null 2>&1; then
  echo "Terraform binary '${TERRAFORM_BIN}' not found."
  exit 1
fi

if [[ "${APPLY}" == "true" ]] && ! command -v docker >/dev/null 2>&1; then
  echo "docker is required when APPLY=true."
  exit 1
fi

AWS_ACCOUNT_ID="$("${AWS_CLI_BIN}" sts get-caller-identity --query Account --output text)"
STATE_BUCKET="${STATE_BUCKET:-workflow-orchestrator-tf-state-${AWS_ACCOUNT_ID}-${AWS_REGION}}"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "Using account: ${AWS_ACCOUNT_ID}"
echo "State bucket:   ${STATE_BUCKET}"
echo "Lock table:     ${LOCK_TABLE_NAME}"
echo "Environment:    ${TF_ENVIRONMENT}"

if ! "${AWS_CLI_BIN}" s3api head-bucket --bucket "${STATE_BUCKET}" 2>/dev/null; then
  echo "Creating state bucket ${STATE_BUCKET}..."
  if [[ "${AWS_REGION}" == "us-east-1" ]]; then
    "${AWS_CLI_BIN}" s3api create-bucket --bucket "${STATE_BUCKET}" --region "${AWS_REGION}"
  else
    "${AWS_CLI_BIN}" s3api create-bucket \
      --bucket "${STATE_BUCKET}" \
      --region "${AWS_REGION}" \
      --create-bucket-configuration LocationConstraint="${AWS_REGION}"
  fi
  "${AWS_CLI_BIN}" s3api put-bucket-versioning \
    --bucket "${STATE_BUCKET}" \
    --versioning-configuration Status=Enabled
fi

if ! "${AWS_CLI_BIN}" dynamodb describe-table --table-name "${LOCK_TABLE_NAME}" >/dev/null 2>&1; then
  echo "Creating lock table ${LOCK_TABLE_NAME}..."
  "${AWS_CLI_BIN}" dynamodb create-table \
    --table-name "${LOCK_TABLE_NAME}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "${AWS_REGION}" >/dev/null
  "${AWS_CLI_BIN}" dynamodb wait table-exists --table-name "${LOCK_TABLE_NAME}" --region "${AWS_REGION}"
fi

cd "${TF_DIR}"

"${TERRAFORM_BIN}" init -reconfigure \
  -backend-config="bucket=${STATE_BUCKET}" \
  -backend-config="key=${TF_STATE_KEY}" \
  -backend-config="region=${AWS_REGION}" \
  -backend-config="dynamodb_table=${LOCK_TABLE_NAME}" \
  -backend-config="encrypt=true"

if [[ "${APPLY}" == "true" ]]; then
  "${TERRAFORM_BIN}" apply -auto-approve \
    -target=aws_ecr_repository.api \
    -target=aws_ecr_repository.worker \
    -target=aws_ecr_repository.ui \
    -target=aws_ecr_lifecycle_policy.api \
    -target=aws_ecr_lifecycle_policy.worker \
    -target=aws_ecr_lifecycle_policy.ui \
    -var="aws_region=${AWS_REGION}" \
    -var="environment=${TF_ENVIRONMENT}" \
    -var="db_password=${DB_PASSWORD}"

  "${AWS_CLI_BIN}" ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

  cd "${ROOT_DIR}"
  docker build -f Dockerfile.control-plane -t "${ECR_REGISTRY}/workflow-orchestrator-api:${IMAGE_TAG}" .
  docker build -f Dockerfile.worker -t "${ECR_REGISTRY}/workflow-orchestrator-worker:${IMAGE_TAG}" .
  docker build -f Dockerfile.ui -t "${ECR_REGISTRY}/workflow-orchestrator-ui:${IMAGE_TAG}" .
  docker push "${ECR_REGISTRY}/workflow-orchestrator-api:${IMAGE_TAG}"
  docker push "${ECR_REGISTRY}/workflow-orchestrator-worker:${IMAGE_TAG}"
  docker push "${ECR_REGISTRY}/workflow-orchestrator-ui:${IMAGE_TAG}"
  docker tag "${ECR_REGISTRY}/workflow-orchestrator-api:${IMAGE_TAG}" "${ECR_REGISTRY}/workflow-orchestrator-api:latest"
  docker tag "${ECR_REGISTRY}/workflow-orchestrator-worker:${IMAGE_TAG}" "${ECR_REGISTRY}/workflow-orchestrator-worker:latest"
  docker tag "${ECR_REGISTRY}/workflow-orchestrator-ui:${IMAGE_TAG}" "${ECR_REGISTRY}/workflow-orchestrator-ui:latest"
  docker push "${ECR_REGISTRY}/workflow-orchestrator-api:latest"
  docker push "${ECR_REGISTRY}/workflow-orchestrator-worker:latest"
  docker push "${ECR_REGISTRY}/workflow-orchestrator-ui:latest"
  cd "${TF_DIR}"
fi

"${TERRAFORM_BIN}" plan -out=tfplan \
  -var="aws_region=${AWS_REGION}" \
  -var="environment=${TF_ENVIRONMENT}" \
  -var="db_password=${DB_PASSWORD}" \
  -var="api_image_tag=${IMAGE_TAG}" \
  -var="worker_image_tag=${IMAGE_TAG}" \
  -var="ui_image_tag=${IMAGE_TAG}"

if [[ "${APPLY}" == "true" ]]; then
  "${TERRAFORM_BIN}" apply -auto-approve tfplan
  "${TERRAFORM_BIN}" output
else
  echo "Skipping apply because APPLY=${APPLY}"
fi
