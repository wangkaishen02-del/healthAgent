# healthAgent

当前阶段只做一件事：团体险承保信息查询。

## 技术路线

这是一个按“平台化、可长期演进”思路设计的项目，整体技术路线已经先定下来：

- 前端：Next.js + TypeScript
- 后端：NestJS + TypeScript
- 数据库：PostgreSQL
- ORM：Prisma
- 智能体编排：LangGraph（TypeScript）

Prisma 使用 `relationMode = "prisma"` 保留代码层关系查询，但 PostgreSQL 不创建外键约束。关联字段均保留索引，引用完整性、删除前检查和跨表写入一致性由应用服务与事务负责。

## 本地 PostgreSQL

本地数据库运行在 Docker 中，应用仍直接在电脑上运行：

- 容器：`healthagent-postgres`
- 镜像：`postgres:17-alpine`
- 地址：`127.0.0.1:54329`
- 数据库/用户：`healthagent`
- 持久化卷：`healthagent_postgres_data`

常用命令：

```bash
npm run db:up       # 启动数据库
npm run db:push     # 将 Prisma Schema 同步到本地数据库
npm run db:seed     # 幂等导入本项目示例数据
npm run db:down     # 停止并移除容器，保留命名卷数据
```

本地连接串保存在被 Git 忽略的 `.env` 和 `.env.local` 中，公开示例位于 `.env.example`。保单查询、保单详情、被保人列表、配置对象目录、Agent 后台承保查询、受理立案、三方人员快照、人员事件和理算参数接口均已使用 Prisma 读写 PostgreSQL。保单、保障计划、险种、责任、人员承保关系、参数定义和示例事件均已写入种子脚本。

NestJS 前后端业务接口迁移已经完成。Next.js 只负责页面渲染，页面通过统一 API Client 访问 NestJS；承保、案件、事件、理算参数、附件和智能助手接口均由 NestJS 提供。

当前迁移阶段：

1. NestJS 已建立 `UnderwritingModule`、`ClaimsModule`、`CalculationModule`、`AssistantModule`、`AttachmentsModule` 和 `PrismaModule`
2. Next.js 中重复的业务 Route Handler 已移除
3. `npm run dev` 和 `npm start` 会联合启动前端与后端
4. LangGraph 已接入 NestJS 和 PostgreSQL Checkpointer，负责助手任务状态、中断、跨重启恢复和取消；页面继续使用注册中心和内部动作执行器

这样做的原因是先打稳业务底座，避免一开始就被复杂流程和多技术栈拖散。

## 当前范围

- 保单列表查询
- 全量宽度的保单详情抽屉：基本信息、责任信息、被保人清单三个页签；责任信息按保障计划、险种、责任分层展示
- 保单下险种与责任查询：以紧凑明细表展示，同一险种的代码和名称跨责任行合并
- 保单下被保人查询：分页列表展示
- 被保人与保障计划关联：人员列表展示所属保障计划，并支持按保障计划筛选
- 综合查询下的案件查询：支持案件号、保单号、被保人、案件状态和报案日期组合筛选，并只读查看关系人、事件与影像详情
- 理算配置 Agent：可查询保单、选择配置对象，并通过通用页面工具新增、编辑或删除参数
- 顶部菜单可打开保单信息查询、案件查询；工作区标签页可关闭并可从菜单重新打开
- 智能助手通过本地 Ollama LLM 自动打开页面、填写条件和执行查询
- 智能助手执行期间支持手动停止；已完成的页面操作保留，尚未执行的后续步骤取消
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

Agent 工具校验以注册中心为准，不维护页面字段和动作的硬编码白名单。动作声明 `target` 区分页面动作与列表行动作；动态下拉字段使用 `optionSource: "runtime"`，由当前页面上下文注入可用选项。前端通过 `pageId.fieldId` 和 `pageId.actionId` 绑定执行器，因此扩展新页面能力时可以复用现有 `set_field`、`click_button` 和 `click_list_row_action` 工具。

复杂页面可以实现通用 `RegisteredPageController`，统一提供字段设置、页面动作、列表行动作和运行时选项。理算配置页通过该控制器维护独立页面状态，Agent 外层执行器不依赖具体配置业务。

Agent 的一次执行过程是：

1. LLM理解用户意图
2. 根据需要通过注册信息查询工具发现菜单、页面和页面区域能力
3. LLM生成当前阶段的页面动作
4. 前端执行页面动作，并把当前页面、历史操作、当前页面注册信息和上一次操作结果反馈给LLM
5. LLM决定继续执行、查询更多注册信息或调用 `finish_task`；数据变更只有收到成功的 `mutation_result` 才视为完成

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

LLM目前可用工具分为四类：

注册信息发现工具：

- `get_menu_pages`：根据菜单注册 ID 查询菜单下的页面
- `get_page_registry`：根据页面注册 ID 查询页面区域、字段和动作

页面操作工具：

- `open_page`：打开已注册页面
- `set_field`：填写已注册字段
- `click_button`：点击已注册按钮，例如查询、重置
- `click_list_row_action`：点击列表某一行操作列中的动作

后台数据工具：

- `query_underwriting`：按保单号、被保人姓名或证件号在后台查询承保关系，返回保单、人员与保障计划信息；不会为了取数操作前端查询页面

任务控制工具：

- `ask_user`：缺少系统无法查询、也不能合理推断的必要信息时暂停任务并追问；用户回复后继续原任务
- `finish_task`：结束当前任务

工具 ID 和参数 ID 仅用于系统内部执行。助手面板中的“工具执行记录”统一通过注册中心转换为中文业务名称，例如 `查询承保信息{被保人姓名：陈浩}`、`填写字段{页面：受理立案，字段：保单号，值：GI2026000001}`。中途追问使用自然语言，不要求用户按字段 ID、枚举值或日期技术格式回答。

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
- `backendToolResults`：本任务已经取得、后续步骤仍需使用的后台工具结果

不会继续累积更早的完整前端查询结果。查询完成后，`lastOperationResult`是查询结果；打开详情或结果抽屉后，`lastOperationResult`会替换为当前详情/抽屉结果。后台工具结果独立保留，避免打开目标页面后丢失已定位的业务对象。后台结果会声明已解析字段，规划器会阻止 Agent 再次向用户索取这些字段。保单查询结果会保留完整命中总数，但为限制模型上下文，`policies` 最多仅传递前 5 条；系统会明确告知模型总数、已传递条数以及是否截断，模型不得把这 5 条当作完整结果集。

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

## 模型配置

默认使用本地 Ollama 的 `qwen3:8b`，地址为 `http://localhost:11434/api/chat`。可复制 `.env.example` 为本机 `.env.local` 并按需修改。

若要对比 DeepSeek 的响应速度，在 `.env.local` 中配置：

```bash
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_MODEL=deepseek-v4-flash
```

DeepSeek 请求使用非 thinking 模式和 JSON 输出，以减少页面操作 Agent 的响应时间。日志会记录实际 `provider`、`model` 与耗时，便于对比。健康险真实环境接入外部模型前，应先完成个人信息、健康信息的脱敏和数据出境合规评估；当前仅建议使用脱敏或模拟数据测试。

智能助手面板支持在“本地模型”和“DeepSeek”之间快速切换，选择会保存在浏览器中并应用于后续请求。任务执行期间切换器会暂时锁定，确保一次多轮 Agent 任务始终使用同一个模型。

界面中的下拉选择统一使用项目自绘组件，不使用浏览器或操作系统原生下拉菜单，以保持视觉和交互一致。

Agent 显式执行 `open_page` 时采用强制重开语义：即使页面标签已经存在，也会先关闭并清空页面状态，再以默认条件重新打开。其他页面动作因前置条件触发的隐式打开不会重复重置页面。

每次 LLM 调用会向控制台和 `logs/assistant-llm.log` 写入两个可读区块：`INPUT` 和 `OUTPUT`。区块带有本次运行 ID、轮次、时间和模型响应耗时；输入会按 `SYSTEM` / `USER` / `ASSISTANT` 分段，JSON 输出会自动缩进。

```text
====================================================================================
[assistant-llm] 2026-07-11T...Z | run=1a2b3c4d | turn=1 | OUTPUT
------------------------------------------------------------------------------------
duration=18234ms
{
  "decision": "continue",
  "toolCalls": []
}
====================================================================================
```

不额外打印 Agent 汇总字段，便于按运行 ID 与轮次追踪单次模型调用。

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
- `apps/api/src/assistant/assistant-graph.service.ts`
  LangGraph 任务状态、页面/用户中断、恢复和取消
- `src/assistant/plan-service.ts`
  模型调用、系统提示词、注册信息发现和单轮规划
- `app/page.tsx`
  页面导航、可关闭标签页、保单查询/详情抽屉、理赔配置入口、Agent 前端执行器和助手面板
- `app/components/CalculationConfigPage.tsx`
  保单、保障计划、险种和责任四级理算参数维护页面
- `app/api/calculation-parameters/route.ts`
  理算配置对象目录与参数增删改查 API
- `docs/reset-retrospective.md`
  重启前复盘
- `docs/identifier-conventions.md`
  编号与代码口径
- `docs/frontend-style-guide.md`
  前端统一风格规则
- `docs/system-flow-and-elements.md`
  系统架构、Agent 流程、页面元素和幂等机制图解
- `legacy/claims-agent-mvp/`
  旧版理赔 Agent 原型归档

## 当前状态

仓库已经完成 Next.js 前端与 NestJS 后端分离。

当前状态是：

- `app/`：Next.js App Router 前端页面
- `apps/api/`：NestJS 正式业务 API
- `src/underwriting/`：承保域查询模型和 Prisma 业务服务
- `prisma/`：保障计划、参数定义和通用理算参数表结构；参数按 `scope + target_id + definition_id` 唯一

“理赔配置 → 保单理算配置”按完整保单号精确查询，查到后直接展示保单基本信息和“保单 → 保障计划 → 险种 → 责任”四级对象列表；点击具体对象的“配置”按钮后才进入参数维护页，可维护文本、数值、百分比、金额和布尔类型的理算参数。配置通过 NestJS API 和 Prisma 持久化到 PostgreSQL 的 `coverage_plan`、`calculation_parameter_definition` 和 `calculation_parameter` 等表。

参数名称由统一参数定义中心提供，不允许自由输入。每个定义唯一绑定参数编码、值类型、默认单位和适用层级；新增其他参数时只需扩展参数定义数据，配置页面和 API 会自动加载并校验。数据库使用 `calculation_parameter_definition` 保存定义，`calculation_parameter` 通过 `definition_id` 引用定义，从结构上保证名称和编码一一对应。

## 新对话接续说明

如果开启新的开发对话，请先阅读本 README，以及以下文件：

```text
app/page.tsx
apps/api/src/assistant/assistant-graph.service.ts
src/assistant/plan-service.ts
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

下一步架构工作：

1. 将 Prisma 业务服务进一步收敛为 NestJS Provider 内部实现
2. 为 LangGraph checkpoint 和幂等记录增加归档与过期清理
3. 将影像正文迁移到对象存储

## 受理立案

“综合查询 → 案件查询”是独立的只读入口。查询结果只提供“查看详情”，页面和 Agent 注册中心均不暴露新增、修改、提交、撤件或删除动作；案件维护统一从“理赔处理 → 受理立案”进入。

“理赔处理 → 受理立案”提供立案闭环：页面顶部只展示可收起的受理中案件列表，双击案件可打开查看或编辑。新建立案只需输入被保人证件号，系统查询该人员的全部关联保单；唯一命中时自动选择，多张保单时由用户从列表选择。匹配后自动带出承保人员表已有的姓名、性别、出生日期、证件和电话。申请人、领款人可以复用被保人资料或独立填写，并支持领款账户信息。页面同时登记报案渠道、事件时间、地点、医院、诊断、事件经过和立案备注。

保存、撤件、提交操作固定在浏览器工作区最下方。新建状态按钮显示“保存立案”，打开受理中案件后显示“保存修改”；新建立案成功后顶部弹出案件号提示，同时刷新案件列表并清空表单回到新建状态。案件状态按“受理中 → 处理中 → 已结案”流转，也可从受理中或处理中撤件；受理立案只显示受理中案件，录入与理算只显示处理中案件，已结案和已撤件可在案件查询中查看。页面内所有下拉组件均使用项目统一的自定义下拉组件。

被保人、申请人和领款人的“证件有效期止”与“证件长期有效”双向互斥：勾选长期有效会清空有效期止，选择有效期止会自动取消长期有效；页面、Agent 和服务端使用同一约束。

事件信息采用独立的人员事件库。锁定被保人后仅显示该人员的全部事件，列表同时展示被保人姓名，并可按关键词、事件类型和发生日期筛选；单击“关联”选择案件事件，双击事件行则带出已有信息进行编辑。也可以在页面新增事件，保存后自动关联。事件发生日期使用日期选择器，发生地点通过一个支持模糊查询的自定义下拉展示“省 / 市 / 区县”完整路径，街道和门牌号在详细地点中单独填写。领款人支持银行转账、现金领取和其他方式，选择银行转账时开户行、账户名称及账号为必填。

页面所有必填字段均有红色标记；保存时会同时标红未完成字段并在字段下方给出具体提示，事件新增也使用相同校验方式。

影像资料支持理赔申请书、身份证明、病历、发票、银行卡及其他分类，允许上传 JPG、PNG、WebP 和 PDF，单件最大 10MB。案件、人员快照、事件和影像元数据已经写入 PostgreSQL；影像文件二进制目前仍保存在应用进程内，后续应迁移到对象存储。数据库表只保留关联字段和查询索引，不创建数据库外键，关联完整性由应用服务与事务校验。

受理立案页面已经注册到通用 Agent 页面注册中心。Agent 可以按证件号查询关联保单并锁定人员、打开或新建案件、操作全部关系人字段与资料复用开关、筛选和维护事件、选择影像分类、删除影像，以及保存、撤件和提交；注册信息描述的是可复用的页面能力，不在提示词中绑定具体案件。出于本地文件权限与安全考虑，影像文件仍由用户手动选择上传。

当用户只提供人员姓名发起立案时，Agent 会先使用保单查询能力定位承保关系。唯一命中时，查询结果会把保单号、承保关系编号、人员编号和证件号传递给后续步骤，Agent 无需再次向用户索要系统已有编号。规划器不会把“只打开页面”视为数据变更完成，并禁止补造用户未提供的事故地点、医院、诊断或账户信息。

## 本地启动

安装依赖并启动 PostgreSQL 后，一条命令同时启动 Next.js 页面和 NestJS API：

```bash
npm run dev
```

默认地址：

- Next.js：`http://127.0.0.1:3000`
- NestJS API：`http://127.0.0.1:3001/api/health`

示例：

```bash
open http://127.0.0.1:3000
curl http://127.0.0.1:3001/api/policies
curl http://127.0.0.1:3001/api/policies/policy-001/full-view
```
