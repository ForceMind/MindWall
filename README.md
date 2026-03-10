# MindWall（心垣）

MindWall 是一个 AI 中介的陌生人社交沙盒平台。  
在“破壁”前，双方消息不会直接互传，而是先经过 AI 安全中间层审查、拦截或改写后再投递。

## 项目结构

- `apps/web`：Next.js 前端（用户页 + 管理页）
- `apps/api`：NestJS 后端（接口、匹配引擎、WebSocket、中间层）
- `infra`：基础设施配置（PostgreSQL/Redis）
- `scripts`：一键启动与一键部署更新脚本

## 技术栈

- 前端：Next.js + TypeScript + Tailwind CSS
- 后端：NestJS + TypeScript
- 数据库：PostgreSQL + Prisma + pgvector
- 缓存/实时：Redis + 原生 WebSocket
- AI：OpenAI（支持后台动态配置）

## 本地一键启动

Windows PowerShell：

```powershell
.\scripts\start-local.ps1
```

Windows 双击启动：

```text
scripts\start-local.cmd
```

可选参数：

```powershell
.\scripts\start-local.ps1 -SkipInstall -SkipMigrate -NoDocker
```

脚本默认流程：

1. 启动 PostgreSQL + Redis（Docker Compose）
2. 安装 API/Web 依赖
3. 执行 Prisma generate + migrate deploy
4. 启动 API 与 Web 开发服务

默认地址：

- API：`http://localhost:3000`
- Web：`http://localhost:3001`

## 后台配置（AI Key、模型、跨域）

MindWall 已支持“后台与前台分离”的运行时配置方式。

1. 在环境变量设置后台口令：
   - 根目录 `.env` 或 `apps/api/.env`
   - `ADMIN_TOKEN=your-secret-token`
2. 启动后访问管理页：
   - `http://localhost:3001/admin`
3. 在管理页填写并保存：
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
   - `OPENAI_EMBEDDING_MODEL`
   - `WEB_ORIGIN`

后端管理接口：

- `GET /admin/config`
- `PUT /admin/config`
- 请求头必须带：`x-admin-token: <ADMIN_TOKEN>`

运行时配置文件：

- `apps/api/config/runtime-config.json`

优先级规则：

- 后台运行时配置 > 环境变量

说明：

- 用户页面：`/`、`/matches`、`/sandbox`
- 管理页面：`/admin`
- API Key 仅返回脱敏预览，不会完整下发给前端

## 服务器一键部署/更新

Linux：

```bash
chmod +x scripts/deploy-update.sh
./scripts/deploy-update.sh
```

可选环境变量：

- `BRANCH`（默认 `main`）
- `WEB_PORT`（默认 `3001`）

示例：

```bash
BRANCH=main WEB_PORT=3101 ./scripts/deploy-update.sh
```

Windows Server：

```powershell
.\scripts\deploy-update.ps1 -Branch main -WebPort 3001
```

部署脚本默认流程：

1. 拉取目标分支最新代码
2. 启动或更新 PostgreSQL + Redis
3. 安装依赖（`npm ci`）
4. Prisma generate + migrate deploy
5. 构建 API 与 Web
6. 若存在 `pm2`，自动重启 `mindwall-api` 与 `mindwall-web`

## 核心流程与接口

### 1）入场访谈（Onboarding）

- `POST /onboarding/sessions`
  - 请求体：`{ "auth_provider_id": "可选", "city": "可选" }`
  - 返回：首轮问题、`session_id`、`user_id`
- `POST /onboarding/sessions/:sessionId/messages`
  - 请求体：`{ "message": "回答内容" }`
  - 返回：
    - 进行中：下一轮问题
    - 完成：`public_tags` + `onboarding_summary`

说明：

- 隐藏系统标签存储在 `user_tags` 的 `HIDDEN_SYSTEM`
- 对外 API 只返回 `PUBLIC_VISIBLE`

### 2）匹配引擎（Match Engine）

- `POST /match-engine/run`
  - 参数：`city`、`max_matches_per_user`、`min_score`、`dry_run`
  - 逻辑：同城分组 + 向量相似度 + 标签重合度 + 风险惩罚
- `GET /match-engine/users/:userId/matches`
  - 返回盲盒匹配卡片（公开标签 + AI 匹配理由）
  - 不返回真实头像、姓名

### 3）沙盒聊天（Sandbox）

HTTP：

- `GET /sandbox/matches/:matchId/messages?user_id=<id>&limit=50`

WebSocket：

- 地址：`/ws/sandbox`
- 前端环境变量：`NEXT_PUBLIC_WS_BASE_URL`（默认 `ws://localhost:3000`）

客户端事件示例：

- `{"type":"auth","user_id":"..."}`
- `{"type":"join_match","match_id":"..."}`
- `{"type":"fetch_history","match_id":"...","limit":50}`
- `{"type":"sandbox_message","match_id":"...","text":"..."}`

服务端关键事件：

- `connected`、`auth_ok`、`join_ok`、`history`
- `sandbox_message`、`message_delivered`、`message_blocked`
- `resonance_update`、`wall_ready`、`error`
- `wall_state`、`wall_break_decision`、`wall_break_update`、`wall_broken`
- `direct_message`（破壁后直连）

### 4）破壁（Wall Break）

触发条件：

- `resonance_score >= 100`

机制：

- 双方都发送 `wall_break_decision` 且 `accept=true`
- 达成后：
  - `matches.status -> wall_broken`
  - `user_profiles.is_wall_broken -> true`
  - 客户端从 `sandbox_message` 切换到 `direct_message`

## 前端页面

- `/`：新用户访谈入口
- `/matches`：盲盒匹配页
- `/sandbox`：沙盒聊天页（支持一键连接并进入聊天）
- `/admin`：后台配置页（AI Key、模型、跨域）

## 演示冒烟测试

1. 启动数据库并运行迁移，确保 API/Web 已启动
2. 在 `apps/api` 执行：

```bash
npm run seed:demo
```

3. 继续执行：

```bash
npm run smoke:ws
```

验证内容：

- 沙盒消息改写/投递链路
- 共振分达到可破壁阈值
- 双方破壁同意状态流转
- 破壁后直连消息通路

## 常见问题

### 前端左下角 `N` 按钮是什么？

这是 Next.js 开发模式的 Dev Indicator（开发工具入口），不是业务功能。  
项目已在 `apps/web/next.config.ts` 中通过 `devIndicators: false` 关闭。
