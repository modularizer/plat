#!/bin/bash
# Auto-setup script for PLAT Authority PostgreSQL database
# Runs on first container startup

set -e

echo "Setting up PLAT Authority database..."

# Create extensions if needed
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    -- Users table
    CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        google_sub TEXT UNIQUE NOT NULL,
        name TEXT,
        profile_image TEXT,
        is_admin TEXT DEFAULT 'false',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Servers table (ownership)
    CREATE TABLE IF NOT EXISTS servers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        server_name TEXT UNIQUE NOT NULL,
        owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_servers_owner_id ON servers(owner_id);
    CREATE INDEX IF NOT EXISTS idx_servers_server_name ON servers(server_name);
EOSQL

echo "✅ PLAT Authority database initialized successfully"

