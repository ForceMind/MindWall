# MindWall（心垣）

MindWall 是一个“AI 中间层匿名社交”平台：用户初期无法直接裸聊，消息先经过安全中间层评估与改写，优先建立心理连接，再决定是否破壁进入直聊。

## 项目结构
- `apps/web`：Vue 3 用户端 + 后台管理端（同一前端项目，分路由）
- `apps/api`：NestJS 后端（鉴权、访谈、匹配、沙盒聊天、后台管理）
- `infra`：PostgreSQL + Redis（Docker Compose）
- `scripts`：一键本地启动、一键部署更新
- `docs`：产品与工程文档

## 一键启动（本地）
Windows：
```bat
scripts\start-local.cmd
```

会自动执行：
1. 启动 PostgreSQL + Redis（Docker）
2. 安装依赖（可跳过）
3. 生成 Prisma Client + 执行迁移
4. 启动 API 与 Web 开发服务

默认地址：
- API：`http://localhost:3100`
- Web：`http://localhost:3001`

可选参数（PowerShell）：
```powershell
.\scripts\start-local.ps1 -SkipInstall -SkipMigrate -NoDocker
```

## 一键部署更新（服务器）
Windows Server：
```powershell
.\scripts\deploy-update.ps1 -Branch main -WebPort 3001
```

功能：
1. 拉取代码
2. 启动/更新基础设施
3. 安装依赖
4. 数据库迁移
5. 构建 API + Web
6. 使用 pm2 重启服务（若已安装 pm2）

## 后台管理员账号
后台登录地址：`/admin/login`

服务端需配置：
- `ADMIN_USERNAME`（默认 `admin`）
- `ADMIN_PASSWORD`（推荐）

兼容：若未设置 `ADMIN_PASSWORD`，会回退使用 `ADMIN_TOKEN`。

## AI 接口配置方式
登录后台后进入：`/admin/config`

可直接填写并保存：
- OpenAI Base URL
- API Key
- 聊天模型
- Embedding 模型
- Web Origin（CORS）

并可点击“测试接口连通性”，验证 Chat/Embedding 两个接口是否可用。

## 用户端主流程
1. 注册/登录（用户名 + 密码）
2. 新手引导三步：
   - 基础资料（性别、年龄）
   - 心理访谈（动态提问）
   - 选择城市
3. 进入匹配列表
4. 点击对象进入会话
5. 共鸣值达到阈值后可双向同意“破壁”

## 主要环境变量
### API
- `PORT`（默认 `3100`）
- `DATABASE_URL`
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

## 当前前端技术栈
- Vue 3
- Vite
- Pinia
- Vue Router

> 旧 Next.js 页面已退役并迁移为 legacy 目录，不再参与构建。
