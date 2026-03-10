# MindWall Web（前端）

本目录是 MindWall 的前端应用，基于 Next.js（App Router）构建。  
主要包含用户流程页面（访谈、匹配、沙盒聊天）和后台管理页面（配置 AI 接口）。

## 启动方式

安装依赖：

```bash
npm install
```

开发模式（默认 3000 端口）：

```bash
npm run dev
```

指定端口（推荐 3001）：

```bash
npm run dev -- -p 3001
```

生产构建：

```bash
npm run build
npm run start -- -p 3001
```

## 环境变量

建议在 `apps/web/.env.local` 配置：

```dotenv
NEXT_PUBLIC_API_BASE_URL="http://localhost:3000"
NEXT_PUBLIC_WS_BASE_URL="ws://localhost:3000"
```

说明：

- `NEXT_PUBLIC_API_BASE_URL`：前端请求后端 HTTP API 的地址
- `NEXT_PUBLIC_WS_BASE_URL`：前端连接 WebSocket 的基础地址

## 页面路由

- `/`：新用户访谈入口
- `/matches`：盲盒匹配页
- `/sandbox`：沙盒聊天页
- `/admin`：后台配置页（需管理员 Token）

## 用户流程（当前版本）

1. 在 `/` 完成入场访谈
2. 进入 `/matches` 运行匹配并查看候选对象
3. 从匹配卡片进入 `/sandbox` 对话
4. 共振分达到阈值后可发起破壁，破壁后切换直连聊天

## 开发说明

- 项目已关闭 Next.js 开发指示器（左下角 `N` 按钮）
- 配置位置：`apps/web/next.config.ts` 的 `devIndicators: false`
