#!/bin/bash
# Kör alla E2E-sviter mot en TOM databas. Förutsätter att DATABASE_URL pekar på en testdatabas
# och att `npm run build` är körd. Startar servern med testinställningar och en fejkad bank.
set -e
cd "$(dirname "$0")/../.."
OUT=${OUT:-$(mktemp -d)}
PORT=${PORT:-3100}
openssl genrsa -out "$OUT/eb.key" 2048 2>/dev/null
openssl rsa -in "$OUT/eb.key" -pubout -out "$OUT/eb.pub" 2>/dev/null
export EB_PUBLIC_KEY=$(base64 -w0 "$OUT/eb.pub")
# Egen processgrupp så att hela servern (även next-server) stoppas efteråt
setsid env WEBHOOK_ALLOW_INSECURE=1 CRON_SECRET=testcron ENABLEBANKING_APP_ID=test-app ENABLEBANKING_API_URL=http://localhost:3301 \
  ENABLEBANKING_PRIVATE_KEY=$(base64 -w0 "$OUT/eb.key") PORT=$PORT npx next start -p $PORT > "$OUT/server.log" 2>&1 &
SERVER=$!
trap 'kill -- -$SERVER 2>/dev/null' EXIT
sleep 4
export BASE_URL=http://localhost:$PORT
for t in flow api passkey bank-hr simple; do
  echo "== $t"
  node tests/e2e/$t.cjs "$OUT"
done
echo "Alla E2E-sviter gick igenom. Serverlogg: $OUT/server.log"
