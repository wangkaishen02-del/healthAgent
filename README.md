# healthAgent

当前阶段只做一件事：团体险承保信息查询。

## 技术路线

这是一个按“平台化、可长期演进”思路设计的项目，整体技术路线已经先定下来：

- 前端：Next.js + TypeScript
- 后端：NestJS + TypeScript
- 数据库：PostgreSQL
- ORM：Prisma
- 智能体编排：LangGraph（TypeScript）

当前还没有把这些框架全部接入代码仓库，是因为我们刻意按阶段推进：

1. 先把承保域的数据模型和查询逻辑做稳
2. 再接正式 API 和页面
3. 后续再扩到理赔、规则配置和 Agent 能力

这样做的原因是先打稳业务底座，避免一开始就被复杂流程和多技术栈拖散。

## 当前范围

- 保单列表查询
- 保单详情查询
- 保单下险种与责任查询
- 保单下被保人查询

## 当前目录

- `prisma/`
  承保域 Prisma Schema
- `src/underwriting/`
  承保查询的类型、样例数据、查询服务
- `docs/reset-retrospective.md`
  重启前复盘
- `docs/identifier-conventions.md`
  编号与代码口径
- `docs/frontend-style-guide.md`
  前端统一风格规则
- `legacy/claims-agent-mvp/`
  旧版理赔 Agent 原型归档

## 当前状态

仓库已经开始正式迁到 Next.js + TypeScript。

当前状态是：

- `app/`：Next.js App Router 前端与 API 路由
- `src/underwriting/`：承保域查询模型、样例数据、查询服务
- `public/`：旧版原生页面，保留为迁移期参考，不再作为主入口继续演进

下一步会继续接：

1. Prisma seed 数据
2. NestJS 正式后端
3. PostgreSQL 持久化

## 本地启动

如果已经安装依赖，当前推荐直接启动 Next.js 版页面：

```bash
npm run dev
```

默认地址：

- `http://127.0.0.1:3000`

仓库里仍保留一个不依赖 Next 的轻量查询 API，便于单独验证承保查询逻辑：

```bash
npm run dev:api
```

默认地址：

- `GET /`
- `GET /api/health`
- `GET /api/policies`
- `GET /api/policies/:policyId`
- `GET /api/policies/:policyId/products`
- `GET /api/policies/:policyId/insureds`
- `GET /api/policies/:policyId/full-view`

示例：

```bash
open http://127.0.0.1:3001
curl http://127.0.0.1:3001/api/policies
curl http://127.0.0.1:3001/api/policies/policy-001/full-view
```

这层轻量 Node 服务现在主要用于迁移期验证；正式前端页面与后续 API 会逐步统一到 Next.js + TypeScript / NestJS + TypeScript 体系里。
