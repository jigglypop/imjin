#!/bin/bash
# Run through SSM as root on the multiplayer host, once per database: gives the game server its own role on the
# imjin-postgres RDS instance and the connection string the service reads. The role's password is made here and never
# leaves the host; the RDS master secret is read once, with a permission scripts/deploy-mp.sh grants for the run and
# takes away after it.
#   infra/mp-db-bootstrap.sh <master secret arn> <endpoint>
set -euo pipefail
SECRET_ARN=$1
ENDPOINT=$2
REGION=ap-northeast-2
dnf install -y postgresql17 >/dev/null 2>&1 || dnf install -y postgresql16 >/dev/null
# The CA bundle is public; the service user reads it at connect time, so it stays world-readable.
install -d -m 755 /etc/imjin
curl -fsSL "https://truststore.pki.rds.amazonaws.com/$REGION/$REGION-bundle.pem" -o /etc/imjin/rds-ca.pem
chmod 644 /etc/imjin/rds-ca.pem
MASTER=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --region "$REGION" --query SecretString --output text)
ADMIN_USER=$(printf '%s' "$MASTER" | python3 -c 'import json,sys; print(json.load(sys.stdin)["username"])')
ADMIN_PASS=$(printf '%s' "$MASTER" | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])')
unset MASTER
# Reuse the role's password on a rerun, so the service and the database never disagree.
if [ -f /etc/imjin/db.env ]; then APP_PASS=$(sed -n 's#^DATABASE_URL=postgres://imjin_app:\([^@]*\)@.*#\1#p' /etc/imjin/db.env); fi
APP_PASS=${APP_PASS:-$(openssl rand -hex 32)}
export PGSSLMODE=verify-full PGSSLROOTCERT=/etc/imjin/rds-ca.pem
# The game owns its database and schema, so its own migrations can create and alter tables; it can touch nothing else.
PGPASSWORD="$ADMIN_PASS" psql -h "$ENDPOINT" -U "$ADMIN_USER" -d imjin -v ON_ERROR_STOP=1 -v app_pass="$APP_PASS" -q <<'SQL'
SELECT 'CREATE ROLE imjin_app LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'imjin_app') \gexec
ALTER ROLE imjin_app WITH LOGIN PASSWORD :'app_pass';
GRANT imjin_app TO CURRENT_USER;
ALTER DATABASE imjin OWNER TO imjin_app;
ALTER SCHEMA public OWNER TO imjin_app;
REVOKE ALL ON DATABASE imjin FROM PUBLIC;
GRANT CONNECT ON DATABASE imjin TO imjin_app;
SQL
unset ADMIN_PASS
umask 077
printf 'DATABASE_URL=postgres://imjin_app:%s@%s:5432/imjin?sslmode=verify-full&sslrootcert=/etc/imjin/rds-ca.pem\n' "$APP_PASS" "$ENDPOINT" > /etc/imjin/db.env
chmod 600 /etc/imjin/db.env
install -d -m 755 /etc/systemd/system/imjin.service.d
cat > /etc/systemd/system/imjin.service.d/db.conf <<'UNIT'
[Service]
EnvironmentFile=/etc/imjin/db.env
UNIT
systemctl daemon-reload
# The service picks the database up on its next restart (the next deploy); check the role now, printing nothing secret.
PGPASSWORD="$APP_PASS" psql -h "$ENDPOINT" -U imjin_app -d imjin -tAc "select current_user || ' on ' || current_database() || ', ' || split_part(version(), ' ', 2)"
