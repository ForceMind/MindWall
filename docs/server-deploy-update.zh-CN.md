# 有间 服务器部署与更新（独立双脚本）

## 核心说明

- `deploy.sh`：首次部署（安装依赖、准备运行时、构建并启动）
- `update.sh`：后续更新（拉代码、更新依赖、构建并重启）
- 脚本使用 **项目内 Node 运行时**：`/root/有间/.mw-runtime/node`
- 不再依赖系统全局 Node 版本，可满足 Prisma 对 Node `>=20.19.0` 的要求
- PM2 使用独立目录：`/root/有间/.mw-runtime/pm2-home`，避免影响同机其他应用

## 1. 首次部署

```bash
cd /root/有间
sudo chmod +x deploy.sh update.sh
sudo bash deploy.sh --yes
```

可选参数：

```bash
sudo bash deploy.sh --branch main --api-port 3100 --web-port 3001 --yes
```

## 2. 后续更新

```bash
cd /root/有间
sudo bash update.sh --yes
```

可选参数：

```bash
sudo bash update.sh --branch main --skip-git --skip-install --skip-migrate --no-docker --yes
```

## 3. 端口冲突策略

- `deploy.sh` 首次部署会自动探测端口占用
- 若 `--api-port` 或 `--web-port` 被占用，会自动顺延到可用端口
- 最终端口会写入：`/root/有间/.mw-runtime/ports.env`
- `update.sh` 默认复用该文件中的端口，保证更新后地址不乱跳

## 4. 便捷命令

首次部署完成后会注册：

```bash
mw-deploy
mw-update
```

