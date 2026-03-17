# LRC-System

Migration from ProduzioneSTR (Flask + MySQL + React) to:
- **Backend**: Hono + Node.js + TypeScript
- **Frontend**: Next.js 15 + Tailwind CSS
- **Database**: PostgreSQL 16
- **Infrastructure**: Docker → AWS Elastic Beanstalk

---

## Project Structure

```
LRC-System/
├── backend/                  # Hono API server
│   ├── src/
│   │   ├── index.ts          # Entry point
│   │   ├── app.ts            # App + route registration
│   │   ├── db/client.ts      # PostgreSQL client (postgres.js)
│   │   ├── middleware/       # cors, error-handler
│   │   ├── modules/          # Feature modules (one per domain)
│   │   │   ├── ingresso-merci/   ✅ MIGRATED
│   │   │   ├── packing/          🔄 pending
│   │   │   ├── production/       🔄 pending
│   │   │   ├── spma/             🔄 pending
│   │   │   └── assistant/        🔄 pending
│   │   ├── lib/validate.ts   # Zod body parser helper
│   │   └── types/            # Shared TypeScript types
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                 # Next.js App Router
│   ├── src/
│   │   ├── app/              # Pages (one folder per module)
│   │   │   ├── layout.tsx    # Root layout with Sidebar
│   │   │   ├── page.tsx      # Home / module selector
│   │   │   └── ingresso-merci/   ✅ MIGRATED
│   │   ├── components/
│   │   │   └── layout/Sidebar.tsx
│   │   ├── lib/api.ts        # Centralized fetch client
│   │   └── types/            # Shared TypeScript types
│   ├── Dockerfile
│   ├── next.config.ts
│   └── tailwind.config.ts
│
├── db/
│   ├── schema.sql            # PostgreSQL schema (complete)
│   ├── migrate.js            # MySQL → PostgreSQL migration script
│   └── package.json
│
├── docker-compose.yml        # Production-like (built images)
├── docker-compose.dev.yml    # Development (hot reload)
├── .env.example              # Environment template
└── .gitignore
```

---

## Quick Start (Development)

```bash
# 1. Copy env vars
cp .env.example .env
# Edit .env with real values

# 2. Start all services
docker compose -f docker-compose.dev.yml up

# Frontend → http://localhost:3000
# Backend  → http://localhost:3001
# DB       → localhost:5432
```

## Data Migration

```bash
cd db
npm install

# Dry run first (no data written)
node migrate.js --all --dry-run

# Full migration
node migrate.js --all

# Specific tables
node migrate.js --tables=ingresso_merci,pack_article
```

---

## Module Migration Status

| Module            | Backend | Frontend |
|-------------------|---------|----------|
| Ingresso Merci    | ✅      | ✅       |
| Packing           | 🔄      | 🔄       |
| SPMA Planning     | 🔄      | 🔄       |
| Production Orders | 🔄      | 🔄       |
| AI Assistant      | 🔄      | 🔄       |
