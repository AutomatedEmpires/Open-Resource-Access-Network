# ORAN Database Setup

## Prerequisites
- Docker and Docker Compose (for local development)
- OR a Neon account (for serverless PostgreSQL)

---

## Local Development with Docker

### Start the database

```bash
cd db
docker compose up -d
```

This starts:
- **PostgreSQL 16 with PostGIS 3.4** on port `5432`
- **pgAdmin 4** on port `5050` (optional, for visual DB management)

### Connection string (local)

```
DATABASE_URL=postgresql://oran:oran_local_password@localhost:5432/oran_db?sslmode=disable
```

Add to your `.env.local` file:

```bash
echo 'DATABASE_URL=postgresql://oran:oran_local_password@localhost:5432/oran_db?sslmode=disable' >> ../.env.local
```

### pgAdmin (optional)

Visit http://localhost:5050 and log in:
- Email: `admin@oran.local`
- Password: `pgadmin_local_password`

Then add a server with:
- Host: `db` (Docker network) or `localhost` (from host machine)
- Port: `5432`
- Database: `oran_db`
- Username: `oran`
- Password: `oran_local_password`

---

## Neon (Production / Staging)

1. Create a Neon project at https://neon.tech
2. Enable the PostGIS extension in your Neon project SQL editor:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
3. Copy the connection string from the Neon dashboard
4. Add to your environment:
   ```
   DATABASE_URL=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

---

## Running Migrations

ORAN uses plain SQL migrations managed by Drizzle Kit.

### Run all pending migrations

```bash
# From the project root
npx drizzle-kit migrate
```

Or run migrations directly via psql:

```bash
psql $DATABASE_URL -f db/migrations/0000_initial_schema.sql
```

### Generate a new migration (after schema changes)

```bash
npx drizzle-kit generate
```

---

## Seeding Demo Data

⚠️ **Demo data is CLEARLY LABELED as fictional and must never be used in production.**

```bash
psql $DATABASE_URL -f db/seed/demo.sql
```

This inserts fictional organizations and services in "Demoville, DM 00000" for development/testing purposes only.

---

## Stopping the Database

```bash
cd db
docker compose down
```

To also remove data volumes:

```bash
docker compose down -v
```
