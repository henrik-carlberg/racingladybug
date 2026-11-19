#!/bin/bash
# Kör alla E2E-sviter mot en TOM databas. Förutsätter att DATABASE_URL pekar på en testdatabas
# och att `npm run build` är körd. Startar servern med testinställningar och en fejkad bank.
set -e
cd "$(dirname "$0")/../.."
OUT=${OUT:-$(mktemp -d)}
PORT=${PORT:-3100}
openssl genrsa -out "$OUT/eb.key" 2048 2>/dev/null
openssl rsa -in "$OUT/eb.key" -pubout -out "$OUT/eb.pub" 2>/dev/null
export RESEND_WEBHOOK_SECRET=whsec_$(openssl rand -base64 24)
export EB_PUBLIC_KEY=$(base64 -w0 "$OUT/eb.pub")
# Pushnotiser: egna VAPID-nycklar och en pushtjänst på localhost i testet
VAPID=$(node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log(k.publicKey+' '+k.privateKey)")
export VAPID_PUBLIC_KEY=${VAPID% *} VAPID_PRIVATE_KEY=${VAPID#* }
# Egen processgrupp så att hela servern (även next-server) stoppas efteråt
setsid env WEBHOOK_ALLOW_INSECURE=1 SKV_API_URL=http://localhost:3308 SKV_CLIENT_ID=skv-test SKV_CLIENT_SECRET=skv-secret AUTHORITY_ALLOW_INSECURE=1 PEPPOL_AP_URL=http://localhost:3309 PEPPOL_AP_KEY=ap-test PEPPOL_AP_WEBHOOK_SECRET=apsecret PEPPOL_AP_ALLOW_INSECURE=1 PAYPROVIDER_TEST_URL=http://localhost:3310 BV_INFO_URL=http://localhost:3311 BV_INFO_KEY=bv-info KIVRA_API_URL=http://localhost:3315 KIVRA_CLIENT_ID=kivra KIVRA_CLIENT_SECRET=kivrasecret KIVRA_TENANT_KEY=tenant1 KIVRA_ALLOW_INSECURE=1 SWISH_API_URL=http://localhost:3312 SWISH_ALLOW_INSECURE=1 SMS_API_URL=http://localhost:3313/a1/sms SMS_API_USER=sms-user SMS_API_PASSWORD=sms-pass SMS_ALLOW_INSECURE=1 INKASSO_API_URL=http://localhost:3314 INKASSO_API_KEY=ink-key INKASSO_ALLOW_INSECURE=1 INKASSO_WEBHOOK_SECRET=inksecret PUSH_ALLOW_INSECURE=1 BANKID_OIDC_ISSUER=http://localhost:3307 BANKID_CLIENT_ID=test-client BANKID_CLIENT_SECRET=test-secret BANKID_ALLOW_INSECURE=1 VAPID_SUBJECT=mailto:test@example.com CRON_SECRET=testcron BILLING_ENFORCED=true STRIPE_SECRET_KEY=sk_test_x STRIPE_API_URL=http://localhost:3302 STRIPE_WEBHOOK_SECRET=whsec_test STRIPE_CONNECT_WEBHOOK_SECRET=whsec_connect OPS_ADMIN_USER_IDS=1 INBOX_DOMAIN=inbox.test RESEND_WEBHOOK_SECRET=$RESEND_WEBHOOK_SECRET RESEND_API_KEY=re_test RESEND_API_URL=http://localhost:3303 ANTHROPIC_API_KEY=sk-ant-test ANTHROPIC_BASE_URL=http://localhost:3304 ENABLEBANKING_APP_ID=test-app ENABLEBANKING_API_URL=http://localhost:3301 \
  ENABLEBANKING_PRIVATE_KEY=$(base64 -w0 "$OUT/eb.key") PORT=$PORT npx next start -p $PORT > "$OUT/server.log" 2>&1 &
SERVER=$!
trap 'kill -- -$SERVER 2>/dev/null' EXIT
sleep 4
export BASE_URL=http://localhost:$PORT
for t in flow api passkey bank-hr simple cash time lonerevision lager marknad projekt crm resurser processer saas betalning trygghet inkorg rotbank byra drift lansering omgang2 omgang3 omgang4 omgang5 omgang6 omgang7 omgang8 omgang9 omgang10 omgang11 omgang12; do
  echo "== $t"
  node tests/e2e/$t.cjs "$OUT"
done
echo "Alla E2E-sviter gick igenom. Serverlogg: $OUT/server.log"
