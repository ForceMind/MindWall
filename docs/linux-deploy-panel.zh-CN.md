# MindWall Linux 单脚本部署说明

服务器端只保留一个入口脚本：`mw`（根目录）。

## 1. 使用方式

在项目根目录执行：

```bash
chmod +x ./mw
./mw
```

或注册全局命令后直接：

```bash
mw
```

## 2. 自动识别逻辑

`mw` 会自动判断：

- 缺少依赖：先安装（Docker / Node.js / npm / pm2 / git / curl），再部署
- 依赖已完整：询问你是否重装依赖，然后执行更新部署

你不需要再区分“安装脚本”和“更新脚本”。

## 3. 常用命令

```bash
# 自动模式（推荐）
mw

# 仅安装依赖
mw install

# 仅更新部署
mw update

# 查看状态
mw status
```

## 4. 发行版支持

自动识别并适配：

- `apt`（Ubuntu / Debian）
- `dnf`（Fedora / Rocky / AlmaLinux / OpenCloudOS）
- `yum`（CentOS 兼容环境）
- `zypper`（openSUSE）
- `pacman`（Arch）
