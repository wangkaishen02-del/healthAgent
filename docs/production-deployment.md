# 生产容器部署与恢复

生产编排把 Web、API、Keycloak、OCR、两套 PostgreSQL、HTTPS 网关和备份任务拆成独立容器。只有网关的 80/443 端口对外开放；数据库、API、Keycloak 和 OCR 均只在 Docker 内部网络通信。

## 1. 准备配置

复制示例文件并填写真实值：

```bash
cp .env.production.example .env.production
```

至少需要修改三个密码和 DeepSeek Key。数据库密码会进入连接 URL，建议使用只含十六进制字符的长随机值，例如 `openssl rand -hex 32`，避免 `@`、`:`、`/`、`%` 等 URL 特殊字符。

- `HEALTHAGENT_HOST`：Caddy 接收请求的域名，本机验证可用 `localhost`
- `PUBLIC_BASE_URL`：浏览器实际访问的 HTTPS 根地址，不能带末尾 `/`
- `APP_DB_PASSWORD`：业务数据库密码
- `KEYCLOAK_DB_PASSWORD`：Keycloak 数据库密码，必须与业务库不同
- `KEYCLOAK_ADMIN_PASSWORD`：Keycloak 管理员密码
- `DEEPSEEK_API_KEY`：外部模型密钥；不配置时 Agent 的 DeepSeek 调用不可用

`.env.production` 已被 Git 和 Docker 构建上下文排除，不要提交它。

## 2. 域名与 HTTPS

公网部署时，把域名解析到服务器，开放 TCP 80/443 和 UDP 443，并把两个地址设为同一域名：

```text
HEALTHAGENT_HOST=claims.example.com
PUBLIC_BASE_URL=https://claims.example.com
```

Caddy 会自动申请并续期公开受信任的 HTTPS 证书。`localhost` 使用 Caddy 本地 CA，命令行验收可使用 `curl -k https://localhost/api/health`；浏览器正式使用前应把 Caddy 根证书导入本机信任库，或改用真实域名。

## 3. 启动与检查

```bash
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
curl -k https://localhost/api/health
```

健康状态应包含 Web、API、OCR、Keycloak 和两套 PostgreSQL。首次启动时：

1. 空业务库按当前 Prisma Schema 初始化，并登记现有迁移基线；
2. Keycloak 导入 `healthagent` realm；
3. 一次性配置任务把 OIDC 回调地址改为 `PUBLIC_BASE_URL`；
4. API 健康后生成业务库与 Keycloak 库的首份备份。

不会自动导入演示数据。生产数据应通过经过验证的备份恢复或正式导入流程进入。

## 4. 持久化范围

下列命名卷必须纳入主机磁盘、快照和容量监控：

- `app_postgres_data`：案件、保单、审计、Agent 状态等业务数据
- `keycloak_postgres_data`：用户、角色、登录与 Keycloak 事件
- `app_data`：影像原件、OCR 相关文件、Agent 元数据日志
- `backup_data`：业务库和 Keycloak 库备份及校验文件
- `caddy_data`、`caddy_config`：HTTPS 证书、私钥及网关状态

`docker compose down` 默认保留这些卷。不要在生产环境执行 `down -v`，否则会删除数据卷。

## 5. 备份与校验

备份容器默认在 API 健康后立即备份，之后每 24 小时执行一次，保留 30 天。可通过环境变量调整：

```text
BACKUP_INTERVAL_SECONDS=86400
BACKUP_RETENTION_DAYS=30
BACKUP_ON_START=true
```

手动生成一次备份：

```bash
docker compose --env-file .env.production -f compose.production.yaml run --rm \
  -e BACKUP_ONCE=true -e BACKUP_ON_START=false backup
```

检查文件和 SHA-256：

```bash
docker compose --env-file .env.production -f compose.production.yaml exec backup ls -lh /backups
docker compose --env-file .env.production -f compose.production.yaml exec backup \
  sh -c 'sha256sum -c /backups/checksums_*.sha256'
```

备份不能只留在同一台服务器。应定期把 `backup_data` 中的文件加密复制到另一台机器或对象存储，并设置失败告警。

## 6. 恢复演练

不要直接覆盖运行中的生产库。先在隔离环境或临时数据库恢复，完成以下检查后再安排正式切换：

1. `pg_restore --list` 能读取两个 `.dump` 文件；
2. 业务库表数量、迁移记录数量及关键案件抽样一致；
3. Keycloak realm、用户、角色和客户端存在；
4. Web 登录、案件查询、影像读取、OCR 和操作审计通过；
5. 记录恢复耗时和可接受的数据丢失窗口。

正式恢复必须停止 API、Keycloak 和备份任务，先留存恢复前快照，再分别恢复业务库与 Keycloak 库。两套库应使用同一时间点的成对备份，避免用户身份与审计记录错位。

## 7. 已有数据库迁移

若数据库已有业务表但没有 `_prisma_migrations`，API 会拒绝自动启动，避免把未知结构误标成已迁移。处理步骤：

1. 先做完整备份；
2. 用 `prisma migrate diff` 对比实际库与当前 Schema；
3. 确认差异符合预期；
4. 逐条执行 `prisma migrate resolve --applied <迁移名>` 建立基线；
5. 再执行 `prisma migrate deploy`。

不可在未审查差异时直接绕过保护。当前开发数据库已经完成迁移基线，可正常备份后迁入生产环境。

## 8. 更新与回滚

每次发布先提交代码并记录提交号，然后构建镜像、备份、更新。不要使用浮动 `latest` 基础镜像；本编排固定 Node 24、Keycloak 26.7.0、Caddy 2.11.4 和 PostgreSQL 17 的主版本/补丁标签。

回滚应用代码时可切换到上一提交重新构建 Web/API，但数据库迁移默认只向前。涉及 Schema 的发布必须同时准备兼容窗口和单独的数据回退方案，不能依赖简单切换镜像完成数据库回滚。
