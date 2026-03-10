# MindWall API（后端）

本目录是 MindWall 的后端服务，基于 NestJS + Prisma。  
负责用户访谈、标签入库、匹配引擎、沙盒聊天中间层、破壁状态流转和后台配置管理。

## 运行前准备

需要：

- Node.js 20+
- PostgreSQL（建议开启 `pgvector`）
- Redis（用于实时/状态能力）

环境变量参考：`apps/api/.env.example`

关键变量：

- `DATABASE_URL`
- `WEB_ORIGIN`
- `ADMIN_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_EMBEDDING_MODEL`

## 启动命令

安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run start:dev
```

生产模式：

```bash
npm run build
npm run start:prod
```

## Prisma 命令

```bash
npm run prisma:generate
npm run prisma:deploy
```

开发新迁移：

```bash
npm run prisma:migrate
```

查看数据库：

```bash
npm run prisma:studio
```

## 后台配置接口

用于前后端分离的运行时配置（管理页 `/admin` 会调用）。

- `GET /admin/config`
- `PUT /admin/config`

请求头必须包含：

- `x-admin-token: <ADMIN_TOKEN>`

运行时配置文件：

- `apps/api/config/runtime-config.json`

优先级：

- 运行时配置 > 环境变量

## 核心接口

### Onboarding

- `POST /onboarding/sessions`
- `POST /onboarding/sessions/:sessionId/messages`

### Match Engine

- `POST /match-engine/run`
- `GET /match-engine/users/:userId/matches`

### Sandbox

- HTTP：
  - `GET /sandbox/matches/:matchId/messages`
  - `GET /sandbox/matches/:matchId/wall-state`
  - `POST /sandbox/matches/:matchId/wall-decision`
- WebSocket：
  - endpoint：`/ws/sandbox`

## 演示脚本

生成演示数据：

```bash
npm run seed:demo
```

执行 WebSocket 冒烟测试：

```bash
npm run smoke:ws
```

## 测试命令

```bash
npm run test
npm run test:e2e
npm run test:cov
```
