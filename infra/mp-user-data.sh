#!/bin/bash
# First boot of the multiplayer host (Amazon Linux 2023, arm64): Node, Caddy terminating TLS for mp.imjin1592.com,
# the game server as a systemd service, and imjin-deploy, which pulls the latest bundle from the private deploy
# bucket. No SSH: the host is reached through SSM, which the instance role allows.
set -euxo pipefail
dnf install -y nodejs22 || dnf install -y nodejs
NODE=$(command -v node-22 || command -v node)
useradd --system --home /opt/imjin --shell /sbin/nologin imjin || true
mkdir -p /opt/imjin && chown imjin:imjin /opt/imjin
curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=arm64" -o /usr/local/bin/caddy
chmod +x /usr/local/bin/caddy
useradd --system --home /var/lib/caddy --shell /sbin/nologin caddy || true
mkdir -p /etc/caddy /var/lib/caddy && chown caddy:caddy /var/lib/caddy
cat > /etc/caddy/Caddyfile <<'CADDY'
mp.imjin1592.com {
	encode gzip
	reverse_proxy 127.0.0.1:8787
}
CADDY
cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
After=network-online.target
Wants=network-online.target
[Service]
User=caddy
Group=caddy
Environment=XDG_DATA_HOME=/var/lib/caddy XDG_CONFIG_HOME=/var/lib/caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/imjin.service <<UNIT
[Unit]
Description=Imjin multiplayer server
After=network-online.target
[Service]
User=imjin
Environment=PORT=8787
ExecStart=$NODE /opt/imjin/server.cjs
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
UNIT
cat > /usr/local/bin/imjin-deploy <<'DEPLOY'
#!/bin/bash
set -e
aws s3 cp s3://imjin1592-deploy/server/server.cjs /opt/imjin/server.cjs.new --region ap-northeast-2
mv /opt/imjin/server.cjs.new /opt/imjin/server.cjs
chown imjin:imjin /opt/imjin/server.cjs
systemctl restart imjin
DEPLOY
chmod +x /usr/local/bin/imjin-deploy
systemctl daemon-reload
systemctl enable caddy imjin
systemctl start caddy
/usr/local/bin/imjin-deploy || true
