 assi# PLAT Authority Storage Adapters

PLAT Authority supports multiple pluggable storage backends for server ownership data. Choose the one that fits your deployment model.

## Available Adapters

### In-Memory (Development)

**Best for:** Testing, demo deployments, temporary setups

- Data stored in application memory
- **Data is lost on restart**
- No external dependencies
- Ultra-fast reads/writes
- No persistence

**Configuration:**
```bash
STORAGE_TYPE=memory
```

### JSON File (Lightweight)

**Best for:** Small deployments (<1000 servers), data portability, easy backup

- Human-readable data file
- Automatic persistence to `./data/servers.json`
- Requires `js-yaml` optional dependency for YAML
- Slower than in-memory but simpler than Postgres
- Easy to version control or backup

**Configuration:**
```bash
STORAGE_TYPE=json
STORAGE_PATH=./data/servers.json
```

**Example data file:**
```json
{
  "servers": {
    "team/alice/notebook": "google-sub-alice123",
    "team/bob/workspace": "google-sub-bob456"
  }
}
```

### YAML File (Human-Friendly)

**Best for:** Small deployments, human-readable config

- Same as JSON but in YAML format
- Requires `js-yaml` package: `npm install js-yaml`
- Easier to read/edit manually

**Configuration:**
```bash
STORAGE_TYPE=yaml
STORAGE_PATH=./data/servers.yaml
```

**Example data file:**
```yaml
servers:
  team/alice/notebook: google-sub-alice123
  team/bob/workspace: google-sub-bob456
```

### Drizzle/Postgres (Production)

**Best for:** Production deployments, large scale, multiple instances

- Full relational database
- Schema versioning with Drizzle migrations
- Multi-instance support (with Redis caching layer)
- User/server relationship tracking
- Audit trail support (can be added)

**Configuration:**
```bash
STORAGE_TYPE=drizzle
DATABASE_URL=postgresql://user:pass@localhost:5432/plat_authority
```

## Quick Start

### Using In-Memory (fastest to try)
```bash
# .env
STORAGE_TYPE=memory

docker-compose up
```

### Using JSON File (lightweight)
```bash
# .env
STORAGE_TYPE=json
STORAGE_PATH=./data/servers.json

mkdir -p data
docker-compose up
```

### Using Postgres (production)
```bash
# .env
STORAGE_TYPE=drizzle
DATABASE_URL=postgresql://plat:plat@postgres:5432/plat_authority

docker-compose up
docker-compose exec authority npm run db:push
```

## Comparison

| Feature | Memory | JSON | YAML | Drizzle |
|---------|--------|------|------|---------|
| Persistence | ❌ | ✅ | ✅ | ✅ |
| Scale | Tiny | <10K servers | <10K servers | Unlimited |
| Multi-instance | ❌ | ⚠️ (filesystem conflicts) | ⚠️ (filesystem conflicts) | ✅ |
| Setup | 0 seconds | 1 minute | 1 minute | 5 minutes |
| Query power | Minimal | Key lookup only | Key lookup only | Full SQL |
| Backup | N/A | Git/copy file | Git/copy file | DB snapshots |

## Migration Between Adapters

All adapters implement the same interface, so you can switch at any time:

1. Export data from old adapter
2. Import to new adapter
3. Update `.env` and restart

Example migration script (coming soon).

## Adding Custom Adapters

Implement the `StorageAdapter` interface:

```typescript
export interface StorageAdapter {
  getServerOwner(serverName: string): Promise<string | null>
  setServerOwner(serverName: string, googleSub: string): Promise<void>
  deleteServerOwner(serverName: string): Promise<void>
  listServersByOwner(googleSub: string): Promise<string[]>
  close?(): Promise<void>
}
```

Example: Redis adapter, MongoDB adapter, SQLite adapter, etc.

Register in the factory:

```typescript
export async function createStorageAdapter(config: StorageConfig): Promise<StorageAdapter> {
  // ...existing cases...
  case 'redis':
    return new RedisStorageAdapter(config.url)
}
```

## Environment Variables

```bash
# Storage type (memory | json | yaml | drizzle)
STORAGE_TYPE=drizzle

# File path for JSON/YAML adapters
STORAGE_PATH=./data/servers.json

# Database URL for Drizzle adapter
DATABASE_URL=postgresql://user:pass@host:5432/db
```

## Development Tips

### Testing different adapters locally

```bash
# Test with in-memory
STORAGE_TYPE=memory npm run dev

# Test with JSON
STORAGE_TYPE=json STORAGE_PATH=./test-data.json npm run dev

# Test with local Postgres
STORAGE_TYPE=drizzle DATABASE_URL=postgresql://postgres:pass@localhost:5432/test npm run dev
```

### Inspecting file-based data

```bash
# JSON
cat ./data/servers.json | jq .

# YAML
cat ./data/servers.yaml
```

### Migrating from JSON to Postgres

```bash
# 1. Export from JSON
npm run export:json

# 2. Import to Postgres
npm run import:postgres

# 3. Update .env
STORAGE_TYPE=drizzle

# 4. Restart
npm start
```

## Troubleshooting

### "STORAGE_PATH environment variable required"

Set `STORAGE_PATH` for JSON/YAML adapters:
```bash
STORAGE_TYPE=json
STORAGE_PATH=./data/servers.json
```

### "Cannot find module 'js-yaml'"

Install the optional dependency:
```bash
npm install js-yaml
```

### File permission errors

Ensure the directory is writable:
```bash
mkdir -p data
chmod 755 data
```

### Postgres connection refused

Check that DATABASE_URL is correct and Postgres is running:
```bash
# Test connection
psql $DATABASE_URL
```

and