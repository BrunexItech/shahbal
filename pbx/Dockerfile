# Asterisk 20 LTS between the Cloud One SIP trunk and the browser softphones.
# Runs with network_mode: host (docker-compose "pbx" profile): SIP, RTP and the
# WebSocket bind straight to the host, so audio isn't mangled by Docker NAT.
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends asterisk gettext-base python3 ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
COPY etc/ /opt/pbx/etc/
COPY sync_agents.py entrypoint.sh /opt/pbx/
RUN chmod +x /opt/pbx/entrypoint.sh
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/pbx/entrypoint.sh"]
