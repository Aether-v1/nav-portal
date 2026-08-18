# nav-portal

一个独立部署的导航落地页系统，支持多线路入口、安全跳转、实时延迟检测、UA 拦截、访问日志。

轻量架构：Node.js + Express + 原生 HTML/CSS/JS + .env 配置 + PM2。

## 功能特性

- 导航首页（科技感深色主题）
- 安全跳转页（倒计时 + 服务端验证）
- 多线路入口配置
- 实时延迟检测（用户浏览器直接测速，反映真实网络延迟，预热+3次取中位数）
- TG 群组 / 客户端下载按钮
- 简单 UA 拦截
- 访问 / 跳转 / 风险 / 错误日志（自动轮转）
- API 限流（内存级）
- 安全响应头（CSP / X-Frame-Options 等）
- 健康检查接口
- 移动端适配 + 安全区域 + reduced-motion
- Node 默认监听 127.0.0.1，仅允许本机 Nginx 反代

## 安全设计

- **真实线路 URL 不暴露给前端**：`/api/config` 只返回白名单字段，线路仅含 `id / name / badge / enabled / ping`（`ping` 为健康检查地址，非真实入口 URL）
- **统一服务端跳转**：首页 → `/jump?id=X` → 服务端验证 → 真实目标，禁止任意 URL 跳转
- **用户侧浏览器测速**：浏览器直接访问各线路配置的 `ping` 地址，预热 1 次 + 正式 3 次取中位数，反映用户当前网络的真实延迟；测速地址仅来自服务端配置，前端无法提交任意 URL
- **跳转 URL Scheme 校验**：仅允许 `http:` / `https:`，禁止 `javascript:` / `data:` / `file:` 等危险 Scheme
- **API 限流**：内存级 IP 限流，保护 `/api/config`、`/api/jump/*`
- **日志隐私**：支持 IP 脱敏、日志自动轮转、`/logs` 禁止 Web 访问
- **安全响应头**：CSP、X-Content-Type-Options、X-Frame-Options、Referrer-Policy、Permissions-Policy
- **API 不缓存**：所有 `/api/*` 响应设置 `Cache-Control: no-store`，防止 CDN 缓存动态配置

## 1. 快速开始（5步上线）

### 步骤 1：克隆仓库

```bash
cd /www/wwwroot
git clone https://github.com/你的用户名/nav-portal.git
cd nav-portal
```

### 步骤 2：复制并编辑配置

```bash
cp .env.example .env
vi .env
```

**必须修改的配置项：**

```env
# 站点信息
SITE_NAME=你的站点名称
SITE_DOMAIN=你的导航页域名.com
SITE_SUBTITLE=安全稳定 · 多线路入口

# Telegram 群组
TG_URL=https://t.me/你的群组
TG_TEXT=官方TG群组

# 线路配置（至少1条，最多按需增加）
NAV_LINK_COUNT=3

NAV_LINK_1_NAME=线路1名称
NAV_LINK_1_URL=https://线路1真实地址.com
NAV_LINK_1_PING=https://线路1真实地址.com/ping.txt
NAV_LINK_1_ENABLED=true
NAV_LINK_1_BADGE=官网

NAV_LINK_2_NAME=线路2名称
NAV_LINK_2_URL=https://线路2真实地址.com
NAV_LINK_2_PING=https://线路2真实地址.com/ping.txt
NAV_LINK_2_ENABLED=true
NAV_LINK_2_BADGE=备用

NAV_LINK_3_NAME=线路3名称
NAV_LINK_3_URL=https://线路3真实地址.com
NAV_LINK_3_PING=https://线路3真实地址.com/ping.txt
NAV_LINK_3_ENABLED=true
NAV_LINK_3_BADGE=备用
```

> **重要**：`NAV_LINK_X_URL` 是真实跳转地址，不会暴露给前端；`NAV_LINK_X_PING` 是测速地址，会返回给前端用于浏览器测速。

### 步骤 3：安装依赖

```bash
npm ci --omit=dev
```

> 生产环境必须使用 `npm ci --omit=dev`，不要使用 `npm install` 或 `npm audit fix`，避免依赖版本不一致。

### 步骤 4：给各官网配置测速接口

每个线路的 `NAV_LINK_X_PING` 对应的网站都需要配置 `/ping.txt`，否则测速会显示"无法访问"。

在各官网的 Nginx 配置中添加：

```nginx
location = /ping.txt {
    default_type text/plain;
    return 200 "ok";
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    add_header Access-Control-Allow-Origin "https://你的导航页域名.com" always;
    add_header Access-Control-Allow-Methods "GET, HEAD" always;
}
```

然后重载 Nginx：

```bash
nginx -t && nginx -s reload
```

验证测速接口是否正常：

```bash
curl -I https://线路1真实地址.com/ping.txt
```

确认返回 `200` 且包含 `Access-Control-Allow-Origin: https://你的导航页域名.com`。

> 如果使用 Cloudflare CDN，需在 Cloudflare 规则中添加：URL 路径等于 `/ping.txt` → Cache Level: Bypass，防止 CDN 缓存影响测速。

### 步骤 5：启动服务

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

验证服务是否正常：

```bash
curl http://127.0.0.1:3000/health
# 应返回 {"ok":true,"uptime":...}

curl http://127.0.0.1:3000/api/config
# 应返回站点配置和线路列表（不含真实 URL）
```

### 步骤 6：配置 Nginx 反代

在 Nginx 中添加站点配置：

```nginx
server {
    listen 80;
    server_name 你的导航页域名.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name 你的导航页域名.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

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

```bash
nginx -t && nginx -s reload
```

现在访问 `https://你的导航页域名.com` 应该可以看到导航页。

---

## 2. 环境要求

- Node.js >= 16.x（推荐 18.x LTS）
- Nginx 或 OpenResty（反代）
- PM2（进程管理）
- 可选：Cloudflare（CDN + WAF）

## 3. 开发环境

```bash
npm install
npm run dev
```

默认端口 `3000`，默认监听 `127.0.0.1`。如需外网调试：

```bash
BIND_ADDRESS=0.0.0.0 npm run dev
```

## 4. 配置项说明

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
| `NAV_LINK_X_PING` | 测速地址（用户浏览器直接请求，需配置 CORS） |
| `NAV_LINK_X_BADGE` | 线路标签（可选） |
| `TRUST_PROXY_HOPS` | 信任代理层数 |
| `RATE_LIMIT_MAX` | 普通 API 每分钟限流 |
| `LOG_ANONYMIZE_IP` | IP 脱敏开关 |

完整配置项见 `.env.example`。

## 5. PM2 管理

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

## 6. Nginx 反代与 Cloudflare 配置

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

## 7. API 文档

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
    { "id": 1, "name": "NO.1官网", "badge": "官网", "enabled": true, "ping": "https://a.example.com/ping.txt" }
  ]
}
```

> 注意：`links` 中不包含真实入口 `url`，仅包含健康检查地址 `ping`。真实 URL 仅在 `/api/jump/resolve` 验证后返回。

### 用户侧浏览器测速

测速由用户浏览器直接访问各线路配置的 `ping` 地址完成，**不经过 Nav Portal 后端代理**。

**测速流程：**
1. 预热请求 1 次（不计入结果）
2. 正式测试 3 次
3. 取 3 次结果的中位数显示

**延迟分级：**

| 延迟 | 等级 |
|------|------|
| < 100ms | 优秀 |
| 100-200ms | 良好 |
| 200-400ms | 一般 |
| 400-800ms | 较高 |
| > 800ms | 很高 |
| 失败 | 无法访问 |

**各官网 `/ping` 接口要求：**
- 返回 HTTP 200，内容任意（如 `{"ok":true}` 或纯文本）
- 设置 `Cache-Control: no-store, no-cache, must-revalidate`
- 设置 `Access-Control-Allow-Origin` 允许导航页域名访问
- 建议使用 `HEAD` 或轻量 `GET` 接口

**Nginx `/ping` 配置示例：**
```nginx
location = /ping.txt {
    default_type text/plain;
    return 200 "ok";
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    add_header Access-Control-Allow-Origin "https://你的导航页域名" always;
    add_header Access-Control-Allow-Methods "GET, HEAD" always;
}
```

> 如果使用 Cloudflare CDN，确保 `/ping.txt` 不被缓存（Cloudflare 规则中设置 Cache Level: Bypass）。

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

## 8. 日志

日志自动写入 `logs/` 目录：

- `access.log` - 访问日志（morgan combined 格式）
- `jump.log` - 跳转记录
- `risk.log` - 风险拦截（UA 拦截等）
- `error.log` - 错误详情

**轮转策略**：单文件超过 `LOG_MAX_FILE_SIZE`（默认 10MB）自动轮转，最多保留 `LOG_MAX_FILES`（默认 5）个历史文件。

**隐私**：设置 `LOG_ANONYMIZE_IP=true` 可对日志中的 IP 脱敏（IPv4 保留前两段）。

## 9. 目录结构

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

## 10. 注意事项与常见问题

- **Node 监听地址**：默认监听 `127.0.0.1:3000`，外网无法直接访问，必须通过 Nginx 反代。如需调试可设置 `BIND_ADDRESS=0.0.0.0`
- 真实跳转地址仅在 `/api/jump/resolve` 中返回，首页接口不包含
- 测速由用户浏览器直接访问各线路 `ping` 地址，预热1次+3次取中位数；各官网需配置 CORS 允许导航页域名访问
- 跳转 URL 强制校验 Scheme，仅允许 `http:` / `https:`，禁止 `javascript:` / `data:` / `file:` 等
- 限流为内存级，重启后清零；单进程 PM2（fork 模式）下正常工作
- `logs/` 目录已通过应用层禁止 Web 访问，Nginx 层也建议加 `deny all`
- 修改 `.env` 后需重启服务（`pm2 restart nav-portal`）
- 生产环境使用 `npm ci --omit=dev` 安装锁定版本，不要在生产服务器执行 `npm audit fix`
- Cloudflare 部署时，务必在 Nginx 或防火墙层限制仅 Cloudflare IP 可访问，防止 `CF-Connecting-IP` 伪造

## 11. 常见问题排查

### Q: 所有线路都显示"无法访问"

**原因**：测速目标网站没有配置 `/ping.txt` 或 CORS 头不正确。

**排查**：
```bash
# 1. 确认测速接口返回 200
curl -I https://线路域名/ping.txt

# 2. 确认有 CORS 头
curl -I https://线路域名/ping.txt | grep access-control
```

**解决**：在各线路网站的 Nginx 中添加 `/ping.txt` 配置（见快速开始步骤 4），并确保 `Access-Control-Allow-Origin` 是你的导航页域名。

### Q: 部分线路显示"无法访问"，其他正常

**原因**：该线路网站没有配置 `/ping.txt`，或 Cloudflare 缓存了旧响应。

**解决**：
1. 给该线路配置 `/ping.txt`
2. Cloudflare 后台清除缓存，或添加 `/ping.txt` Cache Bypass 规则

### Q: 修改 .env 后不生效

**原因**：Node 服务没有重启。

**解决**：
```bash
pm2 restart nav-portal
```

### Q: 页面显示"配置加载失败"

**原因**：Node 服务未启动或端口不对。

**排查**：
```bash
pm2 status
curl http://127.0.0.1:3000/health
```

### Q: 真实线路 URL 会不会泄露？

不会。`/api/config` 只返回线路的 `id / name / badge / enabled / ping`，不返回真实 `url`。真实 URL 仅在用户点击「点击进入」后，通过 `/api/jump/resolve?id=X` 验证后返回。

### Q: 可以自动跳转到最快线路吗？

不可以，也不建议。延迟仅供参考，用户应根据自身需求手动选择入口。
