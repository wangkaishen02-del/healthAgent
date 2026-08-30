# Keycloak 登录、角色与操作审计

healthAgent 使用独立 Keycloak 管理用户、密码、登录会话和角色，业务 API 只接受 Keycloak 签发并通过签名、发行方、受众和有效期校验的 Access Token。

## 本地启动

```bash
docker compose up -d postgres keycloak-postgres keycloak
```

- 系统登录地址：`http://127.0.0.1:3000`
- Keycloak 管理台：`http://127.0.0.1:18081/admin/`
- Realm：`healthagent`
- Web Client：`healthagent-web`
- API Audience：`healthagent-api`

首次导入会创建 `default-user`，临时密码为 `default-user-change-me`。首次登录必须修改密码。管理台初始账号和数据库密码仅供本机开发，正式部署必须通过环境变量更换。

登录使用 Authorization Code + PKCE（S256），没有开启 Implicit Flow 和 Direct Access Grant，前端不接触用户密码。Keycloak 自身开启登录事件和管理员事件记录。

## 角色权限

| 角色 | 页面与业务权限 |
| --- | --- |
| `claim_viewer` | 保单查询、案件查询和只读台账 |
| `claim_acceptor` | 查询、受理立案、受理阶段事件/影像/备注和提交 |
| `claim_calculator` | 查询、录入账单/事件/疾病、理算、理算回退和提交审核 |
| `claim_reviewer` | 查询、审核回退、审核结案和审核备注 |
| `claim_admin` | 全部页面、理算配置、操作审计和角色覆盖权限 |

前端按角色过滤菜单和标签页，但前端隐藏不属于安全控制。NestJS API 对每个接口执行 JWT 验证和角色守卫；案件提交、提交审核、结案还会再次检查动作与业务角色是否匹配。Agent 注册中心、页面发现和计划执行使用同一角色范围，不能通过智能助手绕过菜单或 API。

## 用户快照与操作审计

Keycloak 是用户主数据源。业务库只保存最近访问用户的只读快照 `app_user_snapshot`，用于展示历史操作人，即使未来 Keycloak 用户改名或停用也不会丢失业务记录。

所有 `POST`、`PUT`、`PATCH`、`DELETE` 请求都会写入 `operation_audit`，记录：

- Keycloak 用户 ID、账号、显示名和当时角色；
- HTTP 方法与不含查询参数的路径；
- 业务资源类型和可识别的业务对象 ID；
- 成功/失败、状态码和错误代码；
- 请求 ID、来源地址、User-Agent 和发生时间。

审计不保存请求体、证件号、银行卡号、备注正文或影像内容。管理员可在“系统管理 → 操作审计”分页查询。

## 配置

生产环境保持 `AUTH_ENABLED=true`。`AUTH_ENABLED=false` 和 `NEXT_PUBLIC_AUTH_ENABLED=false` 只允许在自动测试或明确隔离的本机开发环境中使用，此时系统使用兼容旧数据的 `default-user`。

关键环境变量见 [`.env.example`](../.env.example)：

- `KEYCLOAK_ISSUER`
- `KEYCLOAK_AUDIENCE`
- `KEYCLOAK_WEB_CLIENT_ID`
- `NEXT_PUBLIC_KEYCLOAK_ISSUER`
- `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID`

实现遵循 Keycloak 官方的 [Docker 部署](https://www.keycloak.org/getting-started/getting-started-docker) 与 [OpenID Connect](https://www.keycloak.org/securing-apps/oidc-layers) 指南。
