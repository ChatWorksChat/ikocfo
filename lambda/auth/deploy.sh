#!/usr/bin/env bash
# IKO CFO Backend Deployment Script
# Creates DynamoDB table, Lambda function, API Gateway, and seeds admin users
#
# Prerequisites:
#   - AWS CLI configured with credentials
#   - Python 3 available
#
# Usage: bash deploy.sh

set -euo pipefail

REGION="eu-north-1"
TABLE_NAME="ikocfo-users"
FUNCTION_NAME="ikocfo-auth-api"
API_NAME="ikocfo-api"
SES_SENDER="administrator@forwardsflow.com"
SES_REGION="eu-west-1"
PASSWORD_SALT="ikocfo-salt-2024"
ROLE_NAME="ikocfo-lambda-role"

# Auto-detect account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)

echo "=== IKO CFO Backend Deployment ==="
echo "Region: $REGION"
echo "Account: $ACCOUNT_ID"
echo ""

# ------------------------------------------------------------------
# Step 1: Create IAM Role for Lambda
# ------------------------------------------------------------------
echo "[1/7] Creating IAM role..."

TRUST_POLICY='{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}'

ROLE_ARN=$(aws iam create-role \
  --role-name "$ROLE_NAME" \
  --assume-role-policy-document "$TRUST_POLICY" \
  --query 'Role.Arn' --output text 2>/dev/null || \
  aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)

echo "  Role ARN: $ROLE_ARN"

# Attach policies
aws iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true

# Inline policy for DynamoDB + SES
INLINE_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Scan",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:'"$REGION"':'"$ACCOUNT_ID"':table/'"$TABLE_NAME"'"
    },
    {
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendRawEmail"],
      "Resource": "*"
    }
  ]
}'

aws iam put-role-policy --role-name "$ROLE_NAME" \
  --policy-name ikocfo-dynamodb-ses \
  --policy-document "$INLINE_POLICY"

echo "  Waiting for role propagation..."
sleep 10

# ------------------------------------------------------------------
# Step 2: Create DynamoDB Table
# ------------------------------------------------------------------
echo "[2/7] Creating DynamoDB table..."

aws dynamodb create-table \
  --table-name "$TABLE_NAME" \
  --attribute-definitions AttributeName=email,AttributeType=S \
  --key-schema AttributeName=email,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION" 2>/dev/null && echo "  Table created." || echo "  Table already exists."

echo "  Waiting for table to be active..."
aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"

# ------------------------------------------------------------------
# Step 3: Package & Deploy Lambda
# ------------------------------------------------------------------
echo "[3/7] Packaging Lambda function..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Use Python to create zip (cross-platform, works on Windows/MINGW)
python3 << 'PYEOF'
import zipfile, os, sys
script_dir = os.path.dirname(os.path.abspath(sys.argv[0])) if sys.argv[0] else os.getcwd()
# Find lambda_function.py relative to cwd
src = None
for candidate in [os.path.join(os.getcwd(), 'lambda_function.py'),
                  os.path.join(os.environ.get('SCRIPT_DIR_WIN', os.getcwd()), 'lambda_function.py')]:
    if os.path.exists(candidate):
        src = candidate
        break
if not src:
    # Try the dir this script is in
    for root, dirs, files in os.walk('.'):
        if 'lambda_function.py' in files:
            src = os.path.join(root, 'lambda_function.py')
            break
if not src:
    print("ERROR: lambda_function.py not found", file=sys.stderr)
    sys.exit(1)
zip_path = os.path.join(os.path.dirname(src), 'function.zip')
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    zf.write(src, 'lambda_function.py')
print(f'  Zip created: {os.path.getsize(zip_path)} bytes at {zip_path}')
PYEOF

echo "[4/7] Deploying Lambda function..."

# Convert MINGW path to Windows path for AWS CLI fileb://
ZIP_WIN_PATH=$(python3 -c "import os; print(os.path.abspath('function.zip'))")

aws lambda create-function \
  --function-name "$FUNCTION_NAME" \
  --runtime python3.12 \
  --handler lambda_function.lambda_handler \
  --role "$ROLE_ARN" \
  --zip-file "fileb://$ZIP_WIN_PATH" \
  --timeout 30 \
  --memory-size 256 \
  --environment "Variables={DYNAMODB_TABLE=$TABLE_NAME,SES_SENDER=$SES_SENDER,SES_REGION=$SES_REGION,PASSWORD_SALT=$PASSWORD_SALT}" \
  --region "$REGION" 2>/dev/null && echo "  Function created." || {
    echo "  Function exists, updating code..."
    aws lambda update-function-code \
      --function-name "$FUNCTION_NAME" \
      --zip-file "fileb://$ZIP_WIN_PATH" \
      --region "$REGION" > /dev/null

    sleep 5

    aws lambda update-function-configuration \
      --function-name "$FUNCTION_NAME" \
      --environment "Variables={DYNAMODB_TABLE=$TABLE_NAME,SES_SENDER=$SES_SENDER,SES_REGION=$SES_REGION,PASSWORD_SALT=$PASSWORD_SALT}" \
      --region "$REGION" > /dev/null
  }

rm -f function.zip

# ------------------------------------------------------------------
# Step 4: Create API Gateway (HTTP API)
# ------------------------------------------------------------------
echo "[5/7] Creating API Gateway..."

API_ID=$(aws apigatewayv2 create-api \
  --name "$API_NAME" \
  --protocol-type HTTP \
  --cors-configuration "AllowOrigins=*,AllowMethods=GET,POST,PUT,OPTIONS,AllowHeaders=Content-Type" \
  --region "$REGION" \
  --query 'ApiId' --output text 2>/dev/null || \
  aws apigatewayv2 get-apis --region "$REGION" \
    --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)

echo "  API ID: $API_ID"

# Create Lambda integration
LAMBDA_ARN="arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$FUNCTION_NAME"

INTEGRATION_ID=$(aws apigatewayv2 create-integration \
  --api-id "$API_ID" \
  --integration-type AWS_PROXY \
  --integration-uri "$LAMBDA_ARN" \
  --payload-format-version "2.0" \
  --region "$REGION" \
  --query 'IntegrationId' --output text 2>/dev/null || true)

if [ -n "$INTEGRATION_ID" ] && [ "$INTEGRATION_ID" != "None" ]; then
  echo "  Integration ID: $INTEGRATION_ID"

  # Create catch-all route
  aws apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key '$default' \
    --target "integrations/$INTEGRATION_ID" \
    --region "$REGION" > /dev/null 2>&1 || true

  # Create auto-deploy stage
  aws apigatewayv2 create-stage \
    --api-id "$API_ID" \
    --stage-name '$default' \
    --auto-deploy \
    --region "$REGION" > /dev/null 2>&1 || true
fi

# Grant API Gateway permission to invoke Lambda
aws lambda add-permission \
  --function-name "$FUNCTION_NAME" \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*" \
  --region "$REGION" 2>/dev/null || true

API_URL="https://$API_ID.execute-api.$REGION.amazonaws.com"
echo "  API URL: $API_URL"

# ------------------------------------------------------------------
# Step 5: Seed Admin Users
# ------------------------------------------------------------------
echo "[6/7] Seeding admin users..."

# Hash function matching the Lambda's hash_password()
hash_pw() {
  python3 -c "
import hashlib
pw = '$1'
salt = '$PASSWORD_SALT'
h = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 100000).hex()
print(h)
"
}

ADMIN1_PW=$(python3 -c "import random,string; print(''.join(random.choices(string.ascii_letters+string.digits+'!@#\$%',k=12)))")
ADMIN2_PW=$(python3 -c "import random,string; print(''.join(random.choices(string.ascii_letters+string.digits+'!@#\$%',k=12)))")

ADMIN1_HASH=$(hash_pw "$ADMIN1_PW")
ADMIN2_HASH=$(hash_pw "$ADMIN2_PW")

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Admin 1: amoroso.gombe@forwardsflow.com
aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --item '{
    "email": {"S": "amoroso.gombe@forwardsflow.com"},
    "password_hash": {"S": "'"$ADMIN1_HASH"'"},
    "firstName": {"S": "Amoroso"},
    "lastName": {"S": "Gombe"},
    "accountType": {"S": "individual"},
    "companyName": {"S": ""},
    "companyAddress": {"S": ""},
    "position": {"S": ""},
    "plan": {"S": "pro"},
    "verified": {"BOOL": true},
    "role": {"S": "admin"},
    "status": {"S": "active"},
    "createdAt": {"S": "'"$NOW"'"},
    "lastLoginAt": {"NULL": true}
  }' 2>/dev/null && echo "  Admin 1 seeded: amoroso.gombe@forwardsflow.com" || echo "  Admin 1 may already exist."

# Admin 2: rupal.sheth@ikocfo.com
aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --region "$REGION" \
  --item '{
    "email": {"S": "rupal.sheth@ikocfo.com"},
    "password_hash": {"S": "'"$ADMIN2_HASH"'"},
    "firstName": {"S": "Rupal"},
    "lastName": {"S": "Sheth"},
    "accountType": {"S": "individual"},
    "companyName": {"S": ""},
    "companyAddress": {"S": ""},
    "position": {"S": ""},
    "plan": {"S": "pro"},
    "verified": {"BOOL": true},
    "role": {"S": "admin"},
    "status": {"S": "active"},
    "createdAt": {"S": "'"$NOW"'"},
    "lastLoginAt": {"NULL": true}
  }' 2>/dev/null && echo "  Admin 2 seeded: rupal.sheth@ikocfo.com" || echo "  Admin 2 may already exist."

echo ""
echo "  Admin 1 password: $ADMIN1_PW"
echo "  Admin 2 password: $ADMIN2_PW"

# ------------------------------------------------------------------
# Step 6: Verify SES Recipient (sandbox requirement)
# ------------------------------------------------------------------
echo "[7/7] Verifying SES recipient email..."

aws ses verify-email-identity \
  --email-address "amoroso.gombe@forwardsflow.com" \
  --region "$SES_REGION" 2>/dev/null && \
  echo "  Verification email sent to amoroso.gombe@forwardsflow.com (check inbox & click link)" || \
  echo "  SES verification may already be pending."

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
echo ""
echo "========================================="
echo " Deployment Complete!"
echo "========================================="
echo ""
echo " API URL:     $API_URL"
echo " DynamoDB:    $TABLE_NAME ($REGION)"
echo " Lambda:      $FUNCTION_NAME ($REGION)"
echo " API Gateway: $API_NAME ($REGION)"
echo ""
echo " Next steps:"
echo "   1. Add VITE_API_URL=$API_URL to Amplify environment variables"
echo "   2. Verify SES recipient email (check inbox)"
echo "   3. Send credentials to Admin 1:"
echo "      aws ses send-email (or use admin dashboard)"
echo ""
echo " Admin credentials (SAVE THESE):"
echo "   amoroso.gombe@forwardsflow.com : $ADMIN1_PW"
echo "   rupal.sheth@ikocfo.com         : $ADMIN2_PW"
echo ""
