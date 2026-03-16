# MindWall 最小化部署指南（不携带本地数据）

## 1. 发布前准备（本地）
1. 设置版本号（可选）：
   - `scripts\set-version.cmd 1.0.1`
2. 生成最小发布包：
   - `scripts\build-release.cmd`
3. 产物在 `release/`：
   - `mindwall-vx.y.z-minimal.zip`
   - `mindwall-vx.y.z-minimal.zip.sha256`

> 最小发布包会自动排除：`runtime-config.json`、日志、`node_modules`、`dist`。

## 2. 服务器首次部署
1. 解压最小发布包到部署目录（例如 `D:\mindwall` 或 `/opt/mindwall`）。
2. 配置环境变量（数据库、管理员、端口等）。
3. 执行部署脚本：
   - Windows：`.\scripts\deploy-update.ps1 -SkipGit`
   - Linux：`SKIP_GIT=1 bash scripts/deploy-update.sh`

## 3. 服务器增量更新
你有两种方式：

1. 使用发布包更新（推荐）
   - 上传新版本最小包并覆盖解压
   - 执行 `deploy-update`（`SkipGit` 模式）

2. 使用 Git 更新
   - 服务器目录直接 `git pull`
   - 执行 `deploy-update`（默认模式）

## 4. 运行时数据说明
- AI 配置写入：`apps/api/config/runtime-config.json`
- 服务器日志写入：`apps/api/logs/server.log`
- 两者都不进入版本库，也不会被最小发布包带走。

## 5. 验证检查
1. `GET /health` 返回 `status=ok` 且有 `version`
2. 后台 `/admin/config` 能读取并保存 AI 配置
3. 用户端可注册登录、完成访谈、进入匹配与聊天
