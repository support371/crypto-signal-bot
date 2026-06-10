#!/bin/bash
set -e

# Cloudflare Worker Full Deploy Script
# Run this when CLOUDFLARE_API_TOKEN is available
# Usage: CLOUDFLARE_API_TOKEN=cfat_xxx bash deploy-worker.sh

ACCOUNT_ID="5918df72bfd0d0389a1894adec5db58f"
DB_NAME="crypto-signal-bot-db"
BUCKET_NAME="crypto-signal-bot-storage"

echo "=== Step 1: Verifying Cloudflare token ==="
VERIFY=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/user/tokens/verify")
SUCCESS=$(echo "$VERIFY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success'))")
if [ "$SUCCESS" != "True" ]; then
  echo "ERROR: Invalid Cloudflare API token"
  exit 1
fi
echo "✅ Token valid"

echo ""
echo "=== Step 2: Create/check D1 database ==="
DB_LIST=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/d1/database?per_page=50")
DB_ID=$(echo "$DB_LIST" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for db in d.get('result',[]):
    if db['name']=='$DB_NAME':
        print(db['uuid'])
        break
")

if [ -z "$DB_ID" ]; then
  echo "Creating D1 database..."
  CREATE=$(curl -s -X POST \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/d1/database" \
    -d "{\"name\":\"$DB_NAME\"}")
  DB_ID=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['uuid'])")
  echo "✅ D1 Database created: $DB_ID"
else
  echo "✅ D1 Database already exists: $DB_ID"
fi

echo ""
echo "=== Step 3: Create/check R2 bucket ==="
BUCKET_EXISTS=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets/$BUCKET_NAME" | python3 -c "
import sys,json; d=json.load(sys.stdin); print(d.get('success'))")
if [ "$BUCKET_EXISTS" = "True" ]; then
  echo "✅ R2 bucket already exists"
else
  curl -s -X POST \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/r2/buckets" \
    -d "{\"name\":\"$BUCKET_NAME\"}" | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ R2 bucket created' if d.get('success') else f'Error: {d}')"
fi

echo ""
echo "=== Step 4: Update wrangler.toml with real database_id ==="
sed -i "s/database_id = \"REPLACE_AFTER_D1_CREATE\"/database_id = \"$DB_ID\"/" wrangler.toml
echo "✅ wrangler.toml updated with database_id: $DB_ID"

echo ""
echo "=== Step 5: Deploy Worker ==="
export CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID=$ACCOUNT_ID
cd worker
npm ci --silent
npx wrangler deploy --config ../wrangler.toml 2>&1
cd ..

echo ""
echo "=== Step 6: Run D1 migrations ==="
npx wrangler d1 execute $DB_NAME --remote --file=worker/migrations/001_init.sql --config=wrangler.toml 2>&1

echo ""
echo "=== Step 7: Verify endpoints ==="
sleep 5
for endpoint in healthz "runtime/status" "guardian/status" "portfolio/summary"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://crypto-signal-bot-api.workers.dev/$endpoint")
  echo "  /$endpoint: HTTP $STATUS $([ "$STATUS" = "200" ] && echo ✅ || echo ❌)"
done

echo ""
echo "=== DEPLOY COMPLETE ==="
echo "Worker URL: https://crypto-signal-bot-api.workers.dev"
echo "Database ID: $DB_ID"
echo ""
echo "Next: Add CLOUDFLARE_API_TOKEN to GitHub secrets to enable auto-deploy on push"
