# Call centre phone exchange (Cloud One)

Cloud One is a SIP trunk, which browsers can't reach directly. This small Asterisk
exchange sits between Cloud One and the call centre's browser softphones:

```
Cloud One ─SIP─► Asterisk (pbx) ◄─wss /pbx/ws (nginx)─ agent's browser
                     ▲                                      │
                     └──────── call audio via TURN (turn) ◄─┘
```

- **Outgoing:** an agent calls a voter; the voter sees the campaign's Cloud One number.
- **Incoming:** calls to that number ring every call-centre line that is signed in.
- **Lines:** HQ gives each agent a line in the platform (extension + password). The
  exchange picks it up within 30 seconds. Deactivate the person and the line stops.

It runs next to Tolkyn's exchange on the same server without clashing:

| | Shahbal (defaults) | Tolkyn |
|---|---|---|
| SIP to Cloud One | UDP 5070 | 5060 |
| Softphones (WebSocket, localhost) | 8189 | 8188 |
| Call audio (RTP) | UDP 20000–24999 | 10000–20000 |
| TURN relay | 3479 + UDP 49300–49399 | 3478 + 49152–49200 |

## Switching it on (server)

1. **Keys**: fill the Cloud One block in `backend/.env` (`CLOUDONE_*`, `PBX_PUBLIC_IP`).
   `PBX_SYNC_SECRET` and `TURN_PASSWORD` are already generated. Set
   `PBX_BACKEND_URL=http://127.0.0.1:8091/api/v1` (the gateway port on this server).
2. **nginx**: add the `location = /pbx/ws` block from `deploy/nginx/host-site.conf.example`
   to the site, then `sudo nginx -t && sudo systemctl reload nginx`.
3. **Firewall**: allow UDP 5070 from Cloud One only, and UDP 20000–24999, UDP/TCP 3479,
   UDP 49300–49399 from anywhere:
   ```bash
   CLOUD=$(getent hosts "$CLOUDONE_SIP_HOST" | awk '{print $1}')
   sudo ufw allow from $CLOUD to any port 5070 proto udp
   sudo ufw allow 20000:24999/udp && sudo ufw allow 3479 && sudo ufw allow 49300:49399/udp
   ```
4. **Start**: `docker-compose --profile pbx up -d --build pbx turn`
5. **Softphones to real calls**: in `backend/.env` set `VOICE_PROVIDER=sip`,
   `SIP_WSS_URL=wss://<domain>/pbx/ws`, `SIP_DOMAIN=<public IP>`,
   `TURN_URL=turn:<public IP>:3479`, `SIP_CALLER_ID=<Cloud One number>`,
   then `docker-compose up -d backend`.
6. **Lines**: in the platform, Call Centre → phone lines: give each agent an extension
   (e.g. 1001) and a strong password.

## Checks
```bash
docker-compose logs -f pbx
docker-compose exec pbx asterisk -rx "pjsip show registrations"   # Cloud One: Registered?
docker-compose exec pbx asterisk -rx "pjsip show contacts"        # which agents are online
docker-compose exec pbx asterisk -rx "database show shahbal"      # who rings on incoming calls
```
