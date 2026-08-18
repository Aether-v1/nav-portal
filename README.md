# nav-portal

一个独立部署的导航落地页系统，支持：

- 导航首页
- 安全跳转页
- 多线路入口
- `.env` 配置
- TG / 客户端下载按钮
- 简单 UA 拦截
- 访问与跳转日志

## 1. 安装

```bash
cd /www/wwwroot/nav-portal
cp .env.example .env
npm install
npm run start
```

默认端口为 `3000`。

## 2. 开发启动

```bash
npm run dev
```

## 3. 关键配置

编辑 `.env`：

- `SITE_NAME` 站点名称
- `SITE_DOMAIN` 主域名文案
- `JUMP_SECONDS` 倒计时秒数
- `TG_URL` TG 群链接
- `DOWNLOAD_ANDROID/WINDOWS/MAC` 下载地址
- `NAV_LINK_COUNT` 线路数量
- `NAV_LINK_X_*` 每条线路配置

例如：

```env
NAV_LINK_1_NAME=NO.1官网
NAV_LINK_1_URL=https://a.example.com/#/login
NAV_LINK_1_DELAY=555
NAV_LINK_1_ENABLED=true
NAV_LINK_1_BADGE=官网
```

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

## 5. Nginx 反代示例

```nginx
server {
    listen 80;
    server_name flyzhu.pro www.flyzhu.pro;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name flyzhu.pro www.flyzhu.pro;

    ssl_certificate /www/server/panel/vhost/cert/flyzhu.pro/fullchain.pem;
    ssl_certificate_key /www/server/panel/vhost/cert/flyzhu.pro/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 6. 日志目录

项目会自动写入：

- `logs/access.log`
- `logs/jump.log`
- `logs/risk.log`
- `logs/error.log`

## 7. 注意事项

- 真实跳转地址不会出现在首页接口返回里，只会在 `/api/jump/resolve` 中解析。
- 如果你不需要 UA 拦截，把 `ENABLE_UA_BLOCK=false` 保持关闭即可。
- 如果你要加更多线路，继续增加 `NAV_LINK_7_*`、`NAV_LINK_8_*` 即可，同时提高 `NAV_LINK_COUNT`。
