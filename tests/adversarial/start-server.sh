#!/usr/bin/env bash
# Starts the built app on :3100 against the fake Google/Gemini backend (no real credentials).
# Usage: npm run build && tests/adversarial/start-server.sh   (logs to $LOG, default /tmp/cardscan-adv.log)
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY=$(node -e 'const {generateKeyPairSync}=require("crypto");const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});process.stdout.write(Buffer.from(JSON.stringify({client_email:"fake@fake.iam.gserviceaccount.com",private_key:privateKey.export({type:"pkcs8",format:"pem"})})).toString("base64"))')
unset HTTPS_PROXY https_proxy HTTP_PROXY http_proxy
export AUTH_TRUST_HOST=true AUTH_SECRET=localtestsecret AUTH_GOOGLE_ID=fake-client AUTH_GOOGLE_SECRET=fake-secret \
  ALLOWED_EMAILS=tester@example.com,other@example.com OWNERS="Tester,Other Person" LLM_PROVIDER=gemini GEMINI_API_KEY=fake-key \
  LLM_FALLBACK_MODELS=fallback-model SHEET_ID=fake-sheet DRIVE_FOLDER_ID=fake-folder DRIVE_UPLOAD_MODE=user \
  GOOGLE_SERVICE_ACCOUNT_JSON="$KEY" PORT=3100 NODE_OPTIONS="--import ./tests/adversarial/fake-google.mjs"
nohup node node_modules/next/dist/bin/next start > "${LOG:-/tmp/cardscan-adv.log}" 2>&1 &
for i in $(seq 1 30); do curl -sf -o /dev/null localhost:3100/signin && curl -sf -o /dev/null localhost:3199/state && exit 0; sleep 1; done
echo "server did not start"; tail -20 "${LOG:-/tmp/cardscan-adv.log}"; exit 1
