# 系统流程与元素图解

## 1. 系统总体架构

```mermaid
flowchart LR
    U["业务用户"] --> UI["Next.js 页面"]
    UI --> PC["页面注册控制器"]
    UI --> API["NestJS API"]

    subgraph FE["前端交互层"]
      UI
      PC
      REG["页面注册中心<br/>菜单 / 页面 / 区域 / 字段 / 动作"]
      PC --> REG
    end

    subgraph AG["智能助手编排层"]
      API --> LG["LangGraph 状态图"]
      LG --> PLAN["计划节点"]
      PLAN --> LLM["DeepSeek / Ollama"]
      PLAN --> REG
      LG --> PAGE["等待页面执行"]
      LG --> USER["等待用户补充"]
      PAGE --> PC
    end

    subgraph BE["业务服务层"]
      API --> UW["承保服务"]
      API --> CL["理赔服务"]
      API --> CALC["理算配置服务"]
      API --> ATT["影像服务"]
      API --> IDEM["幂等服务"]
    end

    subgraph DATA["数据层"]
      UW --> ORM["Prisma"]
      CL --> ORM
      CALC --> ORM
      IDEM --> ORM
      ORM --> PG[("PostgreSQL 业务数据")]
      LG --> CP[("PostgreSQL LangGraph Checkpoint")]
      ATT --> FILES[("当前影像暂存")]
    end
```

### 讲解

- Next.js 只负责页面、交互状态和执行注册动作，不直接承载业务 API。
- NestJS 是所有业务查询、保存、提交、撤件和参数维护的服务边界。
- LangGraph 只负责任务状态和流程编排；实际页面操作仍由注册控制器确定性执行。
- PostgreSQL 同时保存业务数据、幂等记录和 LangGraph 检查点，因此 API 重启后任务仍能继续。

## 2. 智能助手完整流程

```mermaid
stateDiagram-v2
    [*] --> 创建任务
    创建任务 --> 计划: taskId + 用户请求 + 当前页面上下文
    计划 --> 等待用户: 缺少必要信息
    等待用户 --> 计划: 用户补充信息 / resume
    计划 --> 等待页面: 产生页面动作
    等待页面 --> 页面执行: interrupt
    页面执行 --> 计划: 页面结果 / resume
    计划 --> 完成: 无后续动作
    创建任务 --> 已取消: 用户手动停止
    计划 --> 已取消: 用户手动停止
    等待页面 --> 已取消: 用户手动停止
    等待用户 --> 已取消: 用户取消
    完成 --> [*]
    已取消 --> [*]
```

每次进入“等待用户”或“等待页面”都会产生 PostgreSQL 检查点。恢复请求只需要原来的 `taskId`，不依赖原 NestJS 进程内存。

## 3. 页面可操作元素模型

```mermaid
flowchart TD
    MENU["菜单 Menu"] --> PAGE["页面 Page"]
    PAGE --> REGION["区域 Region"]
    REGION --> FIELD["字段 Field"]
    REGION --> ACTION["动作 Action"]

    FIELD --> TEXT["文本 / 日期 / 下拉 / 布尔"]
    ACTION --> PAGE_ACTION["页面动作<br/>查询、重置、保存、提交"]
    ACTION --> ROW_ACTION["行操作<br/>查看、编辑、关联"]
    ACTION --> ITEM_ACTION["对象操作<br/>使用稳定 itemId"]

    REGISTRY["注册中心"] --> MENU
    REGISTRY --> TOOL["Agent 工具目录"]
    TOOL --> OPEN["open_page"]
    TOOL --> SET["set_field"]
    TOOL --> CLICK["click_button"]
    TOOL --> ROW["click_list_row_action"]
    TOOL --> ITEM["click_list_item_action"]
```

### 元素职责

| 元素 | 作用 | Agent 使用方式 |
| --- | --- | --- |
| 菜单 | 组织业务入口 | 查询菜单下有哪些页面 |
| 页面 | 定义独立业务能力 | 使用 `pageId` 打开 |
| 区域 | 组织查询区、列表区、编辑区 | 帮助模型理解字段和动作上下文 |
| 字段 | 定义可填写值、类型和选项 | 使用 `fieldId` 填写 |
| 页面动作 | 查询、重置、保存、提交、撤件 | 使用 `actionId` 执行 |
| 行操作 | 对当前可见列表行操作 | 使用从 1 开始的行号 |
| 对象操作 | 对后台结果中的稳定对象操作 | 使用 `itemId`，不依赖排序 |

## 4. 业务页面与权限

```mermaid
flowchart LR
    CQ["综合查询"] --> PQ["保单信息查询<br/>只读查询"]
    CQ --> CQUERY["案件查询<br/>只读查询与详情"]
    CP["理赔处理"] --> CR["受理立案<br/>新增 / 修改 / 提交 / 撤件"]
    CFG["理赔配置"] --> CC["保单理算配置<br/>参数增删改查"]

    CQUERY -. "不暴露变更动作" .-> SAFE["查询与维护入口分离"]
    CR --> SAFE
```

综合查询下的页面只注册查询、重置和查看动作。案件保存、提交、撤件只存在于“理赔处理 → 受理立案”，从注册信息和执行器两层阻止 Agent 越权。

## 5. 变更动作幂等流程

```mermaid
sequenceDiagram
    participant G as LangGraph 任务
    participant P as 页面执行器
    participant A as NestJS API
    participant I as 幂等记录
    participant D as 业务数据

    G->>P: 执行动作 taskId:轮次:动作序号
    P->>A: 变更请求 + Idempotency-Key
    A->>I: 查询 scope + operationKey
    alt 首次请求
        I-->>A: 不存在
        A->>I: 写入 pending
        A->>D: 执行业务事务
        D-->>A: 返回结果
        A->>I: 保存 completed + response
        A-->>P: 返回业务结果
    else 重复请求
        I-->>A: 返回已完成结果
        A-->>P: 返回相同结果，不重复写业务数据
    else 同键不同请求
        I-->>A: requestHash 不一致
        A-->>P: 409 idempotency_key_reused
    end
```

Agent 的操作编号由 `taskId + 页面续跑轮次 + 动作序号` 组成。同一检查点因网络重试或恢复而再次执行时，会命中原结果，而不会重复立案、重复新增事件或重复保存参数。

当前影像上传使用进程内暂存，不缓存为幂等结果；影像删除已支持幂等。影像正文迁入对象存储后，再将上传纳入同一持久化幂等流程。
