# MindWall (XinYuan)

MindWall is an AI-mediated social sandbox platform. During early interactions, messages are filtered and rewritten by an AI safety middleware before delivery.

## Current Stack

- Frontend: Next.js (App Router) + TypeScript + Tailwind CSS (`apps/web`)
- Backend: NestJS + TypeScript (`apps/api`)
- Database: PostgreSQL + Prisma (with `pgvector`)
- Infra: Docker Compose (PostgreSQL + Redis)

## One-Click Local Start

Windows PowerShell:

```powershell
.\scripts\start-local.ps1
```

Double-click runner (Windows):

```text
scripts\start-local.cmd
```

What it does:

1. Starts PostgreSQL + Redis with Docker Compose
2. Installs API/Web dependencies (unless skipped)
3. Runs Prisma generate + migration deploy
4. Starts API and Web dev servers

Default URLs:

- API: `http://localhost:3000`
- Web: `http://localhost:3001`

Optional flags:

```powershell
.\scripts\start-local.ps1 -SkipInstall -SkipMigrate -NoDocker
```

## One-Click Server Deploy/Update

Linux:

```bash
chmod +x scripts/deploy-update.sh
./scripts/deploy-update.sh
```

Optional env:

- `BRANCH` (default `main`)
- `WEB_PORT` (default `3001`)

Example:

```bash
BRANCH=main WEB_PORT=3101 ./scripts/deploy-update.sh
```

Windows Server:

```powershell
.\scripts\deploy-update.ps1 -Branch main -WebPort 3001
```

Deploy script flow:

1. Pull latest code from the target branch
2. Start/update PostgreSQL + Redis
3. Install dependencies (`npm ci`)
4. Run Prisma generate + migrate deploy
5. Build API and Web
6. If `pm2` exists, restart `mindwall-api` and `mindwall-web`
