#!/usr/bin/env bash
set -euo pipefail

# Invoked only on first initialization of the local Docker volume.
# psql literal variables safely quote passwords (no string-built SQL).
psql --username "$POSTGRES_USER" --dbname voice_platform --set ON_ERROR_STOP=1 \
  --set migrator_password="$POSTGRES_MIGRATOR_PASSWORD" \
  --set app_password="$POSTGRES_APP_PASSWORD" <<'SQL'
CREATE ROLE voice_migrator LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE voice_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
REVOKE ALL ON DATABASE voice_platform FROM PUBLIC;
GRANT CONNECT ON DATABASE voice_platform TO voice_migrator, voice_app;
ALTER DATABASE voice_platform OWNER TO voice_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO voice_migrator;
GRANT USAGE ON SCHEMA public TO voice_app;
CREATE DATABASE voice_platform_test OWNER voice_migrator;
REVOKE ALL ON DATABASE voice_platform_test FROM PUBLIC;
GRANT CONNECT ON DATABASE voice_platform_test TO voice_migrator, voice_app;
\connect voice_platform_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO voice_migrator;
GRANT USAGE ON SCHEMA public TO voice_app;
SQL
