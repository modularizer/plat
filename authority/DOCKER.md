# PLAT Authority Server — Quick Start

## Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development)
- npm

## Development with Docker

### 1. Start the full stack (recommended)

```bash
cd /home/mod/Code/plat/authority

# Copy .env.example to .env if you haven't already
cp .env.example .env

# Start all services (Postgres, Redis, Authority)
docker-compose up

# In another terminal, initialize the database
docker-compose exec authority npm run db:push
```

**Services will be available at:**
- Authority API: http://localhost:3000
- Health check: http://localhost:3000/healthz
- Admin dashboard (optional): http://localhost:3001 (when `--profile admin` is enabled)

### 2. Configuration

Edit `.env` to customize:

```bash
# Server port
PORT=3000

# PostgreSQL
POSTGRES_USER=plat
POSTGRES_PASSWORD=plat_dev
POSTGRES_DB=plat_authority

# Admin token for flat admin endpoints (/pending, /approve, ...)
ADMIN_TOKEN=dev-token-change-me

# Host auth mode
HOST_AUTH_MODE=insecure_token_sub  # or google_tokeninfo
# GOOGLE_CLIENT_ID=...

# Connect abuse controls
CONNECT_RATE_LIMIT_PER_30S=500

# Storage adapter selection
# STORAGE_TYPE=drizzle|memory|json|yaml
# STORAGE_PATH=/app/data/servers.json
```

### 3. Database management

```bash
# Push schema changes to database
docker-compose exec authority npm run db:push

# Generate migrations from schema changes
docker-compose exec authority npm run db:generate

# View database (if POSTGRES_EXPOSE=true)
psql -h localhost -U plat -d plat_authority
```

### 4. Local development (without Docker)

```bash
# Install dependencies
npm ci

# Setup local Postgres and Redis first, then:
npm run db:push
npm run dev
```

## Docker Compose Configuration

### Postgres Service
- Auto-initializes database on first startup
- Data persisted in `plat-postgres-data` volume
- Internal-only service on the compose network
- Health check enabled

### Redis Service
- Internal to Docker network only (no port exposed)
- Auto-recovery on failure
- Health check enabled

### Authority Service
- Auto-builds from `docker/Dockerfile`
- Connects to Postgres and Redis
- Health check enabled
- Source code hot-reload in development mode
- File-backed storage paths can use the mounted `./data` folder

### Optional Admin Dashboard
- Start with profile: `docker-compose --profile admin up`
- Uses PLAT client proxy to call authority flat admin endpoints

## Common Tasks

### Reset the database

```bash
docker-compose down -v  # Remove all volumes
docker-compose up       # Rebuild from scratch
docker-compose exec authority npm run db:push
```

### View logs

```bash
# All services
docker-compose logs

# Specific service
docker-compose logs authority
docker-compose logs postgres
docker-compose logs redis
```

### Restart a service

```bash
docker-compose restart authority
```

### Stop without removing data

```bash
docker-compose down
```

### Stop and remove everything

```bash
docker-compose down -v
```

## Production Deployment

For production:

1. Keep Postgres internal to the compose network
2. Update `AUTHORITY_URL` to your public domain
3. Use a secure `POSTGRES_PASSWORD`
4. Consider using environment-specific `.env` files
5. Use Docker secrets for sensitive values
6. Deploy with a reverse proxy (Nginx, Caddy, etc.)

## Troubleshooting

### Database connection refused

```bash
# Check if Postgres is healthy
docker-compose ps

# View Postgres logs
docker-compose logs postgres

# Wait for Postgres to be ready, then restart
docker-compose restart authority
```

### Port already in use

Change the port in `.env`:
```bash
PORT=3001  # Use a different port
```

Then restart:
```bash
docker-compose up
```

### Redis connection issues

Redis is internal-only. If Authority can't connect:
```bash
# Check Redis is running
docker-compose ps

# Check logs
docker-compose logs redis
```

