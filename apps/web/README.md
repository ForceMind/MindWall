# 有间 Web (Vue)

## 技术栈
- Vue 3
- Vite
- Pinia
- Vue Router

## 启动
在仓库根目录执行：

```powershell
scripts\start-local.cmd
```

默认地址：
- 前端: `http://localhost:3001`
- 后端: `http://localhost:3100`

## 环境变量
- `VITE_API_BASE_URL`：API 基地址（默认 `http://localhost:3100`）
- `VITE_WS_BASE_URL`：WebSocket 基地址（默认由 API 地址推导）

## 用户端路由
- `/login`
- `/register`
- `/onboarding/profile`
- `/onboarding/interview`
- `/onboarding/city`
- `/matches`
- `/chat/:kind/:id`

## 后台路由
- `/admin/login`
- `/admin/overview`
- `/admin/users`
- `/admin/users/:userId`
- `/admin/online`
- `/admin/ai-records`
- `/admin/prompts`
- `/admin/config`
- `/admin/logs`
