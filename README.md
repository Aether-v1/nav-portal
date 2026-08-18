# nav-portal

一个独立部署的导航落地页系统，支持多线路入口、安全跳转、实时延迟检测、UA 拦截、访问日志。

轻量架构：Node.js + Express + 原生 HTML/CSS/JS + .env 配置 + PM2。

## 功能特性

- 导航首页（科技感深色主题）
- 安全跳转页（倒计时 + 服务端验证）
- 多线路入口配置
- 实时延迟检测（后端代理测速，避免 CORS）
- TG 群组 / 客户端下载按钮
- 简单 UA 拦截
- 访问 / 跳转 / 风险 / 错误日志（自动轮转）
- API 限流（内存级）
- 安全响应头（CSP / X-Frame-Options 等）
- 健康检查接口
- 移动端适配 + 安全区域 + reduced-motion
- Node 默认监听 127.0.0.1，仅允许本机 Nginx 反代

## 安全设计

- **真实线路 URL 不暴露给前端**：`/api/config` 只返回白名单字段，线路仅含 `id / name / badge / enabled`
- **统一服务端跳转**：首页 → `/jump?id=X` → 服务端验证 → 真实目标，禁止任意 URL 跳转
- **后端测速**：`/api/ping?id=X` 由服务端请求，避免 CORS；目标 URL 来自配置白名单，禁止 `?url=` 参数，防 SSRF
- **SSRF 防护**：测速目标禁止 localhost / 127.0.0.1 / 私有 IP 段 / 元数据地址 / IPv6 回环和内网地址
- **DNS Rebinding**：测速目标 URL 仅来自管理员 `.env` 配置，API 不接受用户提供的任意 URL，因此 DNS rebinding 风险极低。若管理员配置的域名 DNS 被劫持或轮流解析到内网，理论上存在风险，属于管理员配置风险。当前未实现 DNS 解析二次验证，以避免影响 Cloudflare 等 CDN 域名的正常测速
- **跳转 URL Scheme 校验**：仅允许 `http:` / `https:`，禁止 `javascript:` / `data:` / `file:` 等危险 Scheme
- **API 限流**：内存级 IP 限流，保护 `/api/config`、`/api/jump/*`、`/api/ping`
- **日志隐私**：支持 IP 脱敏、日志自动轮转、`/logs` 禁止 Web 访问
- **安全响应头**：CSP、X-Content-Type-Options、X-Frame-Options、Referrer-Policy、Permissions-Policy
- **API 不缓存**：所有 `/api/*` 响应设置 `Cache-Control: no-store`，防止 CDN 缓存动态配置

## 1. 安装

### 生产环境（推荐）

```bash
cd /www/wwwroot/nav-portal
cp .env.example .env
# 编辑 .env 配置站点信息和线路
npm ci --omit=dev
pm2 start ecosystem.config.js
```

`npm ci` 会严格按照 `package-lock.json` 安装锁定版本，确保生产环境依赖一致。

### 开发环境

```bash
npm install
npm run dev
```

默认端口为 `3000`，默认监听 `127.0.0.1`（仅本机访问，需通过 Nginx 反代）。

如需监听所有网卡（不推荐生产环境），设置环境变量：
```bash
BIND_ADDRESS=0.0.0.0 pm2 start ecosystem.config.js
```

## 2. 开发启动

```bash
npm run dev
```

## 3. 关键配置

编辑 `.env`：

| 配置项 | 说明 |
|--------|------|
| `PORT` | 服务端口（默认 3000） |
| `BIND_ADDRESS` | 监听地址（默认 127.0.0.1） |
| `SITE_NAME` | 站点名称 |
| `SITE_DOMAIN` | 主域名（用于复制按钮） |
| `JUMP_SECONDS` | 跳转倒计时秒数 |
| `TG_URL` | TG 群链接 |
| `NAV_LINK_COUNT` | 线路数量 |
| `NAV_LINK_X_NAME` | 线路名称 |
| `NAV_LINK_X_URL` | 真实跳转地址（仅服务端可见） |
| `NAV_LINK_X_PING` | 测速地址（服务端请求） |
| `NAV_LINK_X_BADGE` | 线路标签（可选） |
| `TRUST_PROXY_HOPS` | 信任代理层数 |
| `RATE_LIMIT_MAX` | 普通 API 每分钟限流 |
| `LOG_ANONYMIZE_IP` | IP 脱敏开关 |

完整配置项见 `.env.example`。

## 4. PM2 启动

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

修改 `.env` 后：

```bash
pm2 restart nav-portal
```

> **注意**：当前限流为内存级实现。PM2 `instances: 1`（fork 模式）下限流正常工作。若改为 cluster 多进程，每个进程独立计数，实际限流阈值会乘以进程数。如需多进程精确限流，建议引入 Redis。

## 5. Nginx 反代与 Cloudflare 配置

### 架构说明

```
用户 → Cloudflare CDN → Nginx (80/443) → Node (127.0.0.1:3000)
```

Node 默认监听 `127.0.0.1:3000`，外网无法直接访问 Node，必须通过 Nginx 反代。

### 标准 Nginx 反代（无 Cloudflare）

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /logs {
        deny all;
    }
}
```

### Cloudflare 环境（推荐）

使用 Cloudflare 时，必须限制 Nginx 仅接受来自 Cloudflare IP 的请求，防止攻击者绕过 Cloudflare 直连 Nginx 伪造 `CF-Connecting-IP`。

**步骤 1：获取 Cloudflare IP 段**

从 https://www.cloudflare.com/ips/ 获取最新 IP 段。

**步骤 2：Nginx 配置**

```nginx
# /etc/nginx/conf.d/cloudflare-ips.conf
# Cloudflare IPv4 段（定期从 https://www.cloudflare.com/ips/ 更新）
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;
real_ip_header CF-Connecting-IP;
real_ip_recursive on;
```

```nginx
# /etc/nginx/sites-available/nav-portal
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com www.example.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # 仅允许 Cloudflare IP 访问，其他全部拒绝
    include /etc/nginx/conf.d/cloudflare-ips.conf;

    # 安全头
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # Cloudflare 真实 IP
        proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
    }

    location /logs {
        deny all;
    }
}
```

> **更简洁的方案**：如果服务器有防火墙（iptables/ufw/安全组），直接在防火墙层只允许 Cloudflare IP 访问 80/443 端口，Nginx 层不需要额外判断。这是更推荐的做法。

### Cloudflare 对应配置

- `.env` 中设置 `TRUST_PROXY=true`，`TRUST_PROXY_HOPS=1`（Nginx 为一层代理）
- 应用优先读取 `CF-Connecting-IP` 获取真实访客 IP
- Cloudflare SSL/TLS 设置中选择「完整（严格）」
- Cloudflare 后台 → 规则 → 可以添加 WAF 规则进一步防护

## 6. API 文档

### `GET /api/config`

返回公开站点配置和线路列表（不含真实 URL）。

**响应示例：**
```json
{
  "siteName": "导航门户",
  "siteDomain": "example.com",
  "siteNotice": "谨防失联，牢记域名",
  "siteSubtitle": "安全稳定 · 多线路入口",
  "heroButtonText": "example.com",
  "jumpSeconds": 5,
  "jumpTitle": "正在建立安全连接",
  "jumpMessage": "...",
  "jumpFooter": "...",
  "tg": { "url": "https://t.me/...", "text": "官方TG群组" },
  "links": [
    { "id": 1, "name": "NO.1官网", "badge": "官网", "enabled": true }
  ]
}
```

### `GET /api/ping?id=1`

服务端代理测速，返回延迟毫秒数。

**响应：**
```json
{ "success": true, "id": 1, "delay": 82, "status": "ok" }
```

失败时 `delay: null, status: "timeout"`。

### `GET /api/jump/meta?id=1`

获取跳转页元信息（倒计时、标题等），不含真实 URL。

### `GET /api/jump/resolve?id=1`

验证线路 ID 后返回真实跳转 URL。仅接受配置中存在的 `id`，禁止任意 URL。

**响应：**
```json
{ "success": true, "url": "https://真实目标地址" }
```

### `GET /health`

健康检查。

```json
{ "ok": true, "uptime": 123.45 }
```

支持 `HEAD /health`。

### 统一错误格式

```json
{ "success": false, "message": "线路不存在", "code": "LINK_NOT_FOUND" }
```

错误码：`INVALID_ID` / `LINK_NOT_FOUND` / `RATE_LIMITED` / `FORBIDDEN` / `UNSAFE_TARGET` / `PING_BUSY` / `INTERNAL_ERROR`

## 7. 日志

日志自动写入 `logs/` 目录：

- `access.log` - 访问日志（morgan combined 格式）
- `jump.log` - 跳转记录
- `risk.log` - 风险拦截（UA 拦截等）
- `error.log` - 错误详情

**轮转策略**：单文件超过 `LOG_MAX_FILE_SIZE`（默认 10MB）自动轮转，最多保留 `LOG_MAX_FILES`（默认 5）个历史文件。

**隐私**：设置 `LOG_ANONYMIZE_IP=true` 可对日志中的 IP 脱敏（IPv4 保留前两段）。

## 8. 目录结构

```
nav-portal/
├── server/
│   ├── app.js          # Express 主应用
│   ├── config.js       # 配置解析 + 公开配置白名单
│   └── logger.js       # 日志（轮转 + 脱敏）
├── web/
│   ├── index.html      # 首页
│   ├── jump.html       # 跳转页
│   ├── css/style.css
│   ├── js/index.js     # 首页逻辑
│   ├── js/jump.js      # 跳转页逻辑
│   ├── logo.png
│   └── favicon.ico
├── .env.example
├── .gitignore
├── ecosystem.config.js
├── package.json
├── package-lock.json
└── README.md
```

## 9. 注意事项

- **Node 监听地址**：默认监听 `127.0.0.1:3000`，外网无法直接访问，必须通过 Nginx 反代。如需调试可设置 `BIND_ADDRESS=0.0.0.0`
- 真实跳转地址仅在 `/api/jump/resolve` 中返回，首页接口不包含
- 测速由服务端代理，目标地址必须是 `https` 或 `http`，禁止内网地址（含 IPv6）
- 跳转 URL 强制校验 Scheme，仅允许 `http:` / `https:`，禁止 `javascript:` / `data:` / `file:` 等
- 限流为内存级，重启后清零；单进程 PM2（fork 模式）下正常工作
- `logs/` 目录已通过应用层禁止 Web 访问，Nginx 层也建议加 `deny all`
- 修改 `.env` 后需重启服务（`pm2 restart nav-portal`）
- 生产环境使用 `npm ci --omit=dev` 安装锁定版本，不要在生产服务器执行 `npm audit fix`
- Cloudflare 部署时，务必在 Nginx 或防火墙层限制仅 Cloudflare IP 可访问，防止 `CF-Connecting-IP` 伪造
