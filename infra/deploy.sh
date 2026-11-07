#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="${1:-dev}"
TEMPLATE="$ROOT/infra/storage.yaml"
KEY_DIR="$ROOT/infra/.keys/$ENV"

identity="$(aws sts get-caller-identity --output json)"
account="$(printf '%s' "$identity" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Account"])')"
arn="$(printf '%s' "$identity" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Arn"])')"
region="${AWS_REGION:-$(aws configure get region || true)}"
region="${region:-ap-south-1}"

if [[ -n "${MEMTAVI_AWS_ACCOUNT:-}" && "$account" != "$MEMTAVI_AWS_ACCOUNT" ]]; then
  echo "refusing: signed in as $account, expected $MEMTAVI_AWS_ACCOUNT" >&2
  exit 1
fi

echo "account=$account arn=$arn region=$region env=$ENV"

mkdir -p "$KEY_DIR"
if [[ ! -f "$KEY_DIR/private.pem" ]]; then
  openssl genrsa -out "$KEY_DIR/private.pem" 2048 2>/dev/null
  openssl rsa -in "$KEY_DIR/private.pem" -pubout -out "$KEY_DIR/public.pem" 2>/dev/null
  chmod 600 "$KEY_DIR/private.pem"
  echo "generated CloudFront key pair in infra/.keys/$ENV"
fi

stack="memtavi-storage-$ENV"

aws cloudformation deploy \
  --stack-name "$stack" \
  --template-file "$TEMPLATE" \
  --region "$region" \
  --parameter-overrides "Env=$ENV" "AccountId=$account" "PublicKeyPem=$(cat "$KEY_DIR/public.pem")" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset

aws ssm put-parameter \
  --name "/memtavi/$ENV/cloudfront-private-key" \
  --type SecureString \
  --value "file://$KEY_DIR/private.pem" \
  --overwrite \
  --region "$region" >/dev/null
echo "stored signing key at /memtavi/$ENV/cloudfront-private-key"

aws cloudformation describe-stacks \
  --stack-name "$stack" \
  --region "$region" \
  --query "Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}" \
  --output table
