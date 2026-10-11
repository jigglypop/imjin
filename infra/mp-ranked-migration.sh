#!/usr/bin/env bash
# Run through SSM as root before deploying the ranked bundle on an existing host. Preserve its journal.
set -euo pipefail
install -d -m 700 -o imjin -g imjin /opt/imjin/data
if [ -f /opt/imjin/data/ranked.jsonl ]; then
  chown imjin:imjin /opt/imjin/data/ranked.jsonl
  chmod 600 /opt/imjin/data/ranked.jsonl
fi
install -d -m 755 /etc/systemd/system/imjin.service.d
cat > /etc/systemd/system/imjin.service.d/ranked.conf <<'UNIT'
[Service]
Environment=RANKED_STORE=/opt/imjin/data/ranked.jsonl
WorkingDirectory=/opt/imjin
UNIT
systemctl daemon-reload
