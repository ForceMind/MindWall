# MindWall (心垣)

MindWall is an AI-mediated social sandbox platform where early user interactions are intercepted and rewritten by an LLM safety layer before they reach the other side.

## Phase 1 Stack Choices

- Frontend: Next.js (App Router, TypeScript, Tailwind CSS) at `apps/web`
- Backend: NestJS (Node.js, TypeScript) at `apps/api`
- ORM: Prisma (PostgreSQL) in `apps/api/prisma/schema.prisma`
- Infra: PostgreSQL with `pgvector` + Redis via Docker Compose (`infra/docker-compose.yml`)

## Local Setup

1. Start infra:

   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```

2. Backend env is already set to:

   ```bash
   DATABASE_URL="postgresql://mindwall:mindwall@localhost:5432/mindwall?schema=public"
   ```

3. Generate Prisma client:

   ```bash
   cd apps/api
   npm run prisma:generate
   ```

4. Apply migrations (after Docker is running):

   ```bash
   npm run prisma:migrate -- --name init_mindwall
   ```

5. Start apps:

   ```bash
   # terminal 1
   cd apps/api
   npm run start:dev

   # terminal 2
   cd apps/web
   npm run dev
   ```
