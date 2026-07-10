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
- 全量宽度的保单详情抽屉：基本信息、险种与责任、被保人清单三个页签
- 保单下险种与责任查询：以紧凑明细表展示，同一险种的代码和名称跨责任行合并
- 保单下被保人查询：分页列表展示
- 顶部菜单可打开保单信息查询、案件查询；工作区标签页可关闭并可从菜单重新打开
- 智能助手通过本地 Ollama LLM 自动打开页面、填写条件和执行查询
- 页面导航、页面区域、字段和动作注册中心
- Agent 注册信息发现与多轮决策

## Agent 页面注册架构

当前智能助手不是通过浏览器 DOM 自动化操作，而是通过页面注册信息和应用内部动作执行器完成操作。

注册中心位于 `src/assistant/page-registry.ts`，目前注册了：

- 菜单：综合查询、理赔处理
- 页面：保单信息查询、保单详细信息、案件查询
- 保单查询区域：查询条件、保单结果列表
- 字段：保单号、投保单位、被保人姓名、被保人证件号、保单状态
- 动作：打开页面、重置、查询，以及详情/责任/被保人信息入口

页面注册使用明确 ID：页面使用 `pageId`，区域使用 `regionId`，字段使用 `fieldId`，动作使用 `actionId`。LLM工具参数直接使用这些注册 ID。

Agent 的一次执行过程是：

1. LLM理解用户意图
2. 根据需要通过注册信息查询工具发现菜单、页面和页面区域能力
3. LLM生成当前阶段的页面动作
4. 前端执行页面动作，并把当前页面、历史操作、当前页面注册信息和上一次操作结果反馈给LLM
5. LLM决定继续执行、查询更多注册信息或调用 `finish_task`

当前是“规划 → 执行 → 观察 → 再规划”的多阶段循环：

```text
用户自然语言
  ↓
LLM生成计划
  ↓
服务端校验工具
  ↓
前端执行页面动作
  ↓
返回当前页面注册信息和上一次操作结果
  ↓
LLM继续规划或 finish_task
```

服务端单次注册信息发现最多执行 5 轮，前端一次用户请求最多执行 4 个“规划—执行—观察”阶段，防止模型异常时无限循环。

## 当前 LLM 工具

LLM目前可用工具分为三类：

注册信息发现工具：

- `get_menu_pages`：根据菜单注册 ID 查询菜单下的页面
- `get_page_registry`：根据页面注册 ID 查询页面区域、字段和动作

页面操作工具：

- `open_page`：打开已注册页面
- `set_field`：填写已注册字段
- `click_button`：点击已注册按钮，例如查询、重置
- `click_list_row_action`：点击列表某一行操作列中的动作

任务控制工具：

- `finish_task`：结束当前任务

`get_navigation_registry`不再作为LLM工具提供。系统导航信息会直接放入系统提示词。

`click_list_row_action`使用通用行号，不依赖业务主键：

```json
{
  "tool": "click_list_row_action",
  "args": {
    "pageId": "policy_query",
    "actionId": "view_insureds",
    "row": 1
  }
}
```

其中 `row: 1` 表示结果列表第一行。

系统保留少量兼容转换，用于处理本地模型偶尔输出的不同命名方式，例如：

- `insured_name` → `insuredName`
- `policy_no` → `policyNo`
- `query` / `查询` / `搜索` → `search`
- `view_details` → `view_detail`

兼容转换只是执行前兜底，页面注册 ID仍然以注册中心返回的值为准。

## Agent 上下文规则

每次 continuation 请求只传递：

- `history`：历史工具操作记录
- `currentPagePath`：当前页面路径
- `currentPageRegistry`：当前页面注册信息
- `lastOperationResult`：上一次页面操作结果

不会继续累积更早的完整查询结果。查询完成后，`lastOperationResult`是查询结果；打开详情或结果抽屉后，`lastOperationResult`会替换为当前详情/抽屉结果。

列表行操作打开保单详情抽屉后，系统会将当前页面切换为注册页面 `policy_detail`，并直接加载其注册信息。下一轮仅传递当前页面路径：

```text
综合查询 -> 保单信息查询 -> 详细信息
```

不会继续传递 `policy_query` 的页面注册信息。

系统提示词不写死“被保人”“责任”等具体业务流程。LLM应该根据当前页面注册信息和执行结果自主选择下一步动作。

注册信息可以直接查看：

```bash
curl "http://127.0.0.1:3000/api/assistant/registry"
curl "http://127.0.0.1:3000/api/assistant/registry?resource=page&pageId=policy_query"
curl "http://127.0.0.1:3000/api/assistant/registry?resource=tools"
```

本地模型配置为 Ollama 的 `qwen3:8b`，地址为 `http://localhost:11434/api/chat`。

每次LLM调用只向控制台和 `logs/assistant-llm.log` 打印两条记录：

```json
{"llmInput":[...]}
{"llmOutput":"..."}
```

不打印其他 Agent 汇总字段。

LLM每轮计划还会返回 `thought` 字段，用于在页面执行期间展示一条简短的当前判断与下一步计划；任务完成后该展示自动隐藏。

## 当前目录

- `prisma/`
  承保域 Prisma Schema
- `src/underwriting/`
  承保查询的类型、样例数据、查询服务
- `src/assistant/page-registry.ts`
  菜单、页面、区域、字段和动作注册中心
- `src/assistant/policy-query-assistant.ts`
  Agent 工具类型、校验和兼容转换
- `app/api/assistant/plan/route.ts`
  Ollama 调用、系统提示词、注册信息发现、多轮规划和上下文处理
- `app/api/assistant/registry/route.ts`
  注册信息查询 API
- `app/page.tsx`
  页面导航、可关闭标签页、保单查询/详情抽屉、Agent 前端执行器和助手面板
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

## 新对话接续说明

如果开启新的开发对话，请先阅读本 README，以及以下文件：

```text
app/page.tsx
app/api/assistant/plan/route.ts
src/assistant/page-registry.ts
src/assistant/policy-query-assistant.ts
docs/frontend-style-guide.md
```

继续开发时需要保持以下原则：

1. 不通过 DOM 自动化操作页面，使用注册动作和前端内部执行器
2. 不在系统提示词中写死具体业务场景，页面能力放入注册中心
3. 不由系统根据用户关键词自动补充业务动作，让LLM根据注册信息和结果自主决策
4. 页面操作参数使用注册 ID；结果列表操作使用从1开始的行号
5. 执行后只把当前页面注册信息和上一次操作结果传给下一轮LLM
6. 详情页签的内容区应独立滚动，抽屉标题和页签保持固定
7. 修改后至少运行 `npm run build` 验证

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
