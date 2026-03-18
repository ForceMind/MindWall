# 有间

有间 是一个“AI 中间层匿名社交”平台：用户初期无法直接裸聊，消息先经过安全中间层评估与改写，优先建立心理连接，再决定是否破壁进入直聊。

当前版本：`v1.0.0`

## 项目结构
- `apps/web`：Vue 3 用户端 + 后台管理端（同一前端项目，分路由）
- `apps/api`：NestJS 后端（鉴权、访谈、匹配、沙盒聊天、后台管理）
- `infra`：PostgreSQL + Redis（Docker Compose）
- `scripts`：一键本地启动、最小发布包、服务器部署更新
- `docs`：产品与工程文档

## 后端架构（V2）
- `foundation`：持久化、日志、HTTP 基础能力
- `domains`：身份、访谈、匹配、会话四大域
- `platform`：后台管理与运维能力

健康检查端点：`GET /health`

## 一键启动（本地）
Windows：
```bat
scripts\start-local.cmd
```

默认地址：
- API：`http://localhost:3100`
- Web：`http://localhost:3001`

可选参数（PowerShell）：
```powershell
.\scripts\start-local.ps1 -SkipInstall -SkipMigrate -NoDocker
```

## 生产推荐流程（最小包）
为了避免把本地数据（API Key、日志、node_modules、dist）带上服务器，先生成最小发布包。

Windows：
```bat
scripts\build-release.cmd
```

Linux：
```bash
bash scripts/build-release.sh
```

产物目录：`release/`
- Windows：`mindwall-vx.y.z-minimal.zip`
- Linux：`mindwall-vx.y.z-minimal.tar.gz`
- 同目录包含 `sha256` 校验文件

## 一键部署更新（服务器）
Windows Server：
```powershell
.\scripts\deploy-update.ps1 -Branch main -WebPort 3001
```

Linux：
```bash
BRANCH=main WEB_PORT=3001 bash scripts/deploy-update.sh
```

常用参数（PowerShell）：
```powershell
.\scripts\deploy-update.ps1 -SkipGit -NoDocker -SkipInstall
```
- `-SkipGit`：不拉代码，直接部署当前目录（适合上传最小包后执行）
- `-NoDocker`：不启动 Docker（外部数据库/Redis）
- `-SkipInstall`：跳过依赖安装
- `-SkipMigrate`：跳过数据库迁移（谨慎）

## 后台管理员账号
后台登录地址：`/admin/login`

服务端需配置：
- `ADMIN_USERNAME`（默认 `admin`）
- `ADMIN_PASSWORD`（推荐）

兼容：若未设置 `ADMIN_PASSWORD`，会回退使用 `ADMIN_TOKEN`。

## AI 接口配置方式
登录后台后进入：`/admin/config`，可填写并保存：
- OpenAI Base URL
- API Key
- 聊天模型
- Embedding 模型
- Web Origin（CORS）

支持“测试接口连通性”，同时验证 Chat 与 Embedding 接口。

运行时配置文件：
- 实际运行文件：`apps/api/config/runtime-config.json`（不进版本库）
- 示例模板：`apps/api/config/runtime-config.example.json`

## 主要环境变量
### API
- `PORT`（默认 `3100`）
- `DATABASE_URL`
- `REDIS_URL`
- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `WEB_ORIGIN`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

### Web（Vite）
- `VITE_API_BASE_URL`（默认 `http://localhost:3100`）
- `VITE_WS_BASE_URL`（默认 `ws://localhost:3100`）

## 版本管理
统一版本来源：根目录 `VERSION`

一键改版本（自动同步 API/Web）：
```bat
scripts\set-version.cmd 1.0.1
```

## 当前前端技术栈
- Vue 3
- Vite
- Pinia
- Vue Router

> 旧 Next.js 页面已退役，不再参与构建。
