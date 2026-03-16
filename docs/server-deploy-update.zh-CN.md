# MindWall 服务器部署与更新（简版）

## 1. 首次部署

在项目根目录执行：

```bash
cd /root/MindWall
sudo chmod +x deploy.sh update.sh
sudo bash deploy.sh
```

可选参数：

```bash
sudo bash deploy.sh --branch main --web-port 3001 --yes
```

## 2. 后续更新

```bash
cd /root/MindWall
sudo bash update.sh
```

可选参数：

```bash
sudo bash update.sh --branch main --web-port 3001 --yes
```

## 3. 常见参数说明

- `--skip-git`：跳过 Git 拉取，使用当前目录代码部署
- `--skip-install`：更新时跳过 npm 依赖安装
- `--skip-migrate`：更新时跳过 Prisma 迁移
- `--no-docker`：跳过 PostgreSQL/Redis 容器启动
- `--yes`：非交互模式（检测到本地改动时默认保留并跳过 git pull）

## 4. 便捷命令（部署脚本会自动注册）

首次执行 `deploy.sh` 后可使用：

```bash
mw-deploy
mw-update
```

