# 健康险理赔 AI Agent MVP

这是一个面向健康险理赔人员的简版理算理赔 Agent，当前已经具备一个最小可运行闭环：

- `SQLite` 存储示例案件和理算规则
- 规则引擎完成等待期、免赔额、剔除项、赔付比例计算
- 本地 `Ollama` 上的 `qwen3:8b` 生成审批摘要
- 单页工作台支持多案件切换、重新理算、审批动作和日志留痕

目标是先把 `受理 -> 理算 -> 审批 -> 结案` 四个关键环节跑通，并明确哪些能力适合由 AI 辅助，哪些能力必须由规则和人工控制。

## 0. 如何运行

先确认本机已经启动 Ollama，并且模型可用，例如：

```bash
curl http://localhost:11434/api/chat -d '{
  "model": "qwen3:8b",
  "messages": [{"role": "user", "content": "你好"}],
  "stream": false
}'
```

然后在项目目录运行：

```bash
python3 app.py
```

启动后访问：

- `http://127.0.0.1:8000`
- `http://127.0.0.1:8000/api/demo`

主要接口：

- `GET /api/claims`：案件列表
- `GET /api/claims?claimId=...`：案件详情
- `POST /api/evaluate`：用传入案件和规则做试算
- `POST /api/claims/action`：写入审批动作和日志

可选环境变量：

- `OLLAMA_URL`
- `OLLAMA_MODEL`
- `OLLAMA_TIMEOUT_SECONDS`

## 0.1 当前已实现能力

- 标准件、高金额件、等待期件三类示例案件
- 自动给出 `approve / escalate / reject` 建议动作
- 人工审批动作回写案件状态
- 操作日志写入本地 SQLite
- 本地模型超时时自动回退模板，避免页面空白

## 1. 产品目标

- 提升理赔案件处理效率
- 降低错赔、漏赔、超赔风险
- 让审批依据更透明，方便审计追踪
- 沉淀标准化处理经验，降低新人上手门槛

## 2. MVP 范围

MVP 先聚焦住院医疗险标准案件，不覆盖全部险种，也不追求全自动结案。

包含能力：

- 资料上传与案件建档
- 材料 OCR 后的结构化抽取
- 缺件校验
- 条款责任匹配
- 费用理算试算
- 审批摘要生成
- 结案通知草稿生成

不包含能力：

- 全险种通用配置平台
- 深度反欺诈模型
- 外部医院实时系统对接
- 自动付款

## 3. 业务流程

### 受理

输入：

- 保单号
- 身份证件
- 病案首页
- 出院小结
- 发票
- 费用清单
- 医保结算单

AI 辅助：

- 文档分类
- 关键信息抽取
- 缺件识别
- 案件摘要生成

系统输出：

- 受理视图
- 缺件清单
- 初始风险标签

### 理算

AI 与规则协同：

- 校验保单有效性
- 识别保障责任
- 拆分医保内外费用
- 根据免赔额、比例、限额试算应赔金额
- 生成剔除项说明

系统输出：

- 理算明细
- 应赔金额
- 剔除原因
- 理算说明

### 审批

AI 辅助：

- 汇总案件摘要
- 汇总条款依据
- 汇总风险点
- 生成审批意见草稿

人工控制：

- 高额案件审批
- 异常案件审批
- 拒赔确认

### 结案

系统输出：

- 赔付通知书草稿
- 拒赔通知书草稿
- 结案归档标签
- 审计留痕

## 4. Agent 拆分

建议先做 4 个轻量 Agent：

1. `受理Agent`
   负责材料识别、抽取、缺件判断
2. `理算Agent`
   负责责任判断、费用拆分、赔付试算
3. `审批Agent`
   负责审批摘要、意见草稿、升级建议
4. `结案Agent`
   负责文书生成、归档标签、结案说明

## 5. 技术建议

前端：

- `Next.js` 或 `React`
- 工作台页面 + 案件详情页 + 审批页

后端：

- `FastAPI` 或 `Node.js`
- 工作流引擎负责串联多 Agent

核心能力：

- OCR/文档解析
- 规则引擎
- LLM 推理与摘要
- 向量检索用于条款和案例问答

数据对象：

- 保单
- 被保险人
- 理赔案件
- 医疗单证
- 理算结果
- 审批记录
- 结案文书

## 6. 规则与模型分工

必须规则优先：

- 保障期间
- 等待期
- 责任范围
- 除外责任
- 免赔额
- 赔付比例
- 赔付上限

可以由 AI 辅助：

- 病历摘要
- 缺件判断建议
- 诊疗合理性提示
- 审批摘要
- 结案文书草稿

## 7. 一个典型案件处理示例

1. 受理人员上传病历、发票、费用清单
2. `受理Agent` 自动抽取诊断、住院天数、总费用、医保报销额
3. `理算Agent` 读取保单规则，试算应赔金额
4. `审批Agent` 生成审批摘要并标记异常费用
5. 审批人员确认后，`结案Agent` 生成通知书草稿

## 8. 下一步建议

如果继续往下做，推荐按这个顺序推进：

1. 先按 [docs/domain-model.md](/Users/stephenwang/Documents/project/healthAgent/docs/domain-model.md) 定领域模型
2. 再按 [sql/schema_v1.sql](/Users/stephenwang/Documents/project/healthAgent/sql/schema_v1.sql) 建正式表
3. 按 [docs/migration-plan-v1.md](/Users/stephenwang/Documents/project/healthAgent/docs/migration-plan-v1.md) 把当前 JSON 结构迁过去
4. 再增加案件新建和材料上传
5. 接 OCR 抽取和字段人工修正
6. 把规则从 JSON 抽到可配置规则中心
7. 增加审批角色、权限和流转状态机
8. 接医院项目库、药品库和医学合理性审核

---

前端入口是 [index.html](/Users/stephenwang/Documents/project/healthAgent/index.html)。
服务入口是 [app.py](/Users/stephenwang/Documents/project/healthAgent/app.py)。
领域模型见 [docs/domain-model.md](/Users/stephenwang/Documents/project/healthAgent/docs/domain-model.md)。
正式表结构见 [sql/schema_v1.sql](/Users/stephenwang/Documents/project/healthAgent/sql/schema_v1.sql)。
