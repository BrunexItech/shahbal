#!/usr/bin/env bash
# Render the Asterisk config from the environment (backend/.env), start the line
# sync, then run Asterisk in the foreground.
set -euo pipefail
: "${CLOUDONE_SIP_HOST:?set CLOUDONE_SIP_HOST in backend/.env}"
: "${CLOUDONE_SIP_USER:?set CLOUDONE_SIP_USER in backend/.env}"
: "${CLOUDONE_SIP_PASSWORD:?set CLOUDONE_SIP_PASSWORD in backend/.env}"
: "${CLOUDONE_DID:?set CLOUDONE_DID in backend/.env}"
: "${PBX_PUBLIC_IP:?set PBX_PUBLIC_IP in backend/.env}"
: "${PBX_SYNC_SECRET:?set PBX_SYNC_SECRET in backend/.env}"
: "${PBX_SIP_PORT:=5070}" "${PBX_WS_PORT:=8189}" "${PBX_RTP_START:=20000}" "${PBX_RTP_END:=24999}"
export CLOUDONE_SIP_HOST CLOUDONE_SIP_USER CLOUDONE_SIP_PASSWORD CLOUDONE_DID PBX_PUBLIC_IP PBX_SIP_PORT PBX_WS_PORT PBX_RTP_START PBX_RTP_END

VARS='${CLOUDONE_SIP_HOST} ${CLOUDONE_SIP_USER} ${CLOUDONE_SIP_PASSWORD} ${CLOUDONE_DID} ${PBX_PUBLIC_IP} ${PBX_SIP_PORT} ${PBX_WS_PORT} ${PBX_RTP_START} ${PBX_RTP_END}'
for f in /opt/pbx/etc/*.template; do envsubst "$VARS" < "$f" > "/etc/asterisk/$(basename "$f" .template)"; done
cp /opt/pbx/etc/*.conf /etc/asterisk/
[ -f /etc/asterisk/pjsip_agents.conf ] || echo "; filled by sync_agents.py" > /etc/asterisk/pjsip_agents.conf
chown -R asterisk:asterisk /etc/asterisk /var/lib/asterisk /var/log/asterisk /var/spool/asterisk /var/run/asterisk 2>/dev/null || true

( sleep 8; exec python3 /opt/pbx/sync_agents.py ) &
exec asterisk -f -U asterisk -G asterisk
