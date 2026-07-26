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

## 已完成：LangGraph 持久化切流

NestJS `AssistantModule` 已建立 LangGraph 状态图，前端不再自行循环调用单轮规划接口。每个助手任务使用稳定的 `taskId` 和以下任务接口：

- `POST /api/assistant/tasks`：创建任务并运行到完成或中断。
- `POST /api/assistant/tasks/:taskId/resume`：回传页面执行结果或用户补充信息，从检查点继续。
- `POST /api/assistant/tasks/:taskId/cancel`：取消任务，禁止后续恢复。
- `GET /api/assistant/tasks/:taskId`：查询当前任务状态。

状态图负责规划、等待页面执行、等待用户补充、完成和取消。页面仍通过注册 ID 与内部执行器完成确定性操作。正式运行使用 PostgreSQL Checkpointer，检查点保存在独立的 `langgraph` schema，服务重启后可以按原 `taskId` 恢复。

案件、事件、理算参数和影像删除接口支持 `Idempotency-Key`。Agent 使用稳定的任务轮次操作编号，重复恢复或网络重试不会重复写入业务数据。影像上传仍是暂存操作，待迁入对象存储后再增加持久化幂等。

## 后续阶段

1. 为历史 checkpoint 和幂等记录增加定期归档、过期清理策略。
2. 将现有函数式 Prisma Service 进一步收敛为 NestJS Provider 内部实现。
3. 将影像正文迁移到对象存储。

## 迁移纪律

- 不在架构迁移过程中同时重写页面或业务规则。
- Agent 的查询节点与变更节点分离；变更节点必须幂等。
- 数据完整性继续由应用校验和 Prisma 事务保证。
- 影像正文后续迁移到对象存储，当前附件接口由 NestJS 提供。
