# NestJS 与 LangGraph 渐进式迁移

## 目标架构

- Next.js 负责页面渲染、页面注册控制器和用户交互。
- NestJS 是业务 API、事务和 Prisma 的唯一运行边界。
- LangGraph 在 NestJS 内负责 Agent 状态、节点编排、中断和恢复。
- PostgreSQL 保存业务数据以及后续 LangGraph checkpoint。
- 页面动作继续使用注册 ID 和内部执行器，不改为 DOM 自动化。

## 已完成：前后端业务接口切流

`apps/api` 已提供以下模块：

- `PrismaModule`：管理 Prisma 连接生命周期。
- `UnderwritingModule`：承保查询、保单详情和被保人查询。
- `ClaimsModule`：案件查询/维护和人员事件维护。
- `CalculationModule`：理算参数查询与维护。

前端已经通过统一 `apiFetch` 客户端访问 NestJS，Next.js 只负责页面渲染，不再包含业务 Route Handler。承保、案件、事件、理算参数、附件、助手注册中心和助手规划接口均由 NestJS 提供。

## 后续阶段

1. 将现有函数式 Prisma Service 进一步收敛为 NestJS Provider 内部实现。
2. 在 NestJS `AssistantModule` 中建立 LangGraph，复用现有页面注册中心和工具定义。
3. 使用 PostgreSQL checkpointer 保存 Agent thread、checkpoint 和 interrupt 状态。
4. 为案件保存、提交、撤件等变更动作增加幂等操作编号。

## 迁移纪律

- 不在架构迁移过程中同时重写页面或业务规则。
- Agent 的查询节点与变更节点分离；变更节点必须幂等。
- 数据完整性继续由应用校验和 Prisma 事务保证。
- 影像正文迁移到对象存储前，附件接口不从 Next.js 切流。
