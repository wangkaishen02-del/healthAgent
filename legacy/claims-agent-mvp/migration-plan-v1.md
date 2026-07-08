# 从原型库迁移到正式表结构的计划

## 1. 当前原型库

当前 `data/claims.db` 只有 3 张业务表：

- `claims(claim_id, payload)`
- `rules(rule_set_id, payload)`
- `claim_actions(id, claim_id, action, note, created_at)`

这意味着：

- 业务主数据被包在 JSON 里
- 查询和统计困难
- Agent 能读到数据，但很难细粒度复用

## 2. 迁移目标

迁移到 [schema_v1.sql](/Users/stephenwang/Documents/project/healthAgent/sql/schema_v1.sql) 对应的正式结构。

## 3. 字段映射

### `claims.payload` -> `claims`

- `claimId` -> `claims.claim_id`
- `claimId` 也可暂时作为 `claim_no`
- `claimType` -> `claims.claim_type`
- `status` -> `claims.status`
- `policyNo` 先映射到 `policies.policy_no`

### `claims.payload.insured` -> `insureds`

- `name` -> `insured_name`
- `idNo` -> `id_no`
- `gender` -> `gender`

### `claims.payload.incident` -> `claim_visits`

- `hospitalName` -> `hospital_name`
- `admissionDate` -> `admission_date`
- `dischargeDate` -> `discharge_date`

### `claims.payload.incident.diagnosis[]` -> `claim_diagnoses`

- 数组逐项拆分
- 第一项标记为 `is_primary = 1`

### `claims.payload.documents[]` -> `claim_documents`

- `type` -> `document_type`
- `status` -> `receive_status`

### `claims.payload.expense` -> `claim_calculations`

- `totalAmount` -> `total_amount`
- `socialInsurancePaid` -> `social_insurance_paid`
- `selfPaidAmount` -> `self_paid_amount`

### `claims.payload.expense.suspectedExcludedItems[]` -> 两类表

1. `claim_expense_items`
   用于保留“费用项”
2. `claim_calculation_items`
   用于保留“理算剔除项”

### `rules.payload` -> `rule_sets` + `rule_set_versions`

- `ruleSetId` -> `rule_sets.rule_set_id`
- `productName` -> `rule_sets.rule_set_name`
- `coverage.waitingPeriodDays` -> `rule_set_versions.waiting_period_days`
- `coverage.deductible` -> `rule_set_versions.deductible`
- `coverage.reimbursementRate` -> `rule_set_versions.reimbursement_rate`
- `coverage.annualLimit` -> `rule_set_versions.annual_limit`
- `approvalRouting.manualReviewThreshold` -> `rule_set_versions.approval_threshold`

### `claim_actions` -> `claim_actions`

当前表保留业务语义，但正式表建议补字段：

- `action` -> `action_type`
- 默认 `action_stage` 可根据动作推断
- `note` -> `action_note`
- `actor_name` / `actor_role` 先允许为空

## 4. 实施顺序

1. 建正式表
2. 写一次性迁移脚本，把现有 JSON 拆进正式表
3. 新旧仓储同时保留一小段时间
4. 新接口改读正式表
5. 最后废弃 `claims.payload` 风格

## 5. 推荐下一步开发

下一步最值得做的不是继续扩前端，而是：

1. 写 `sql/schema_v1.sql` 的初始化执行逻辑
2. 写 `scripts/migrate_from_payload.py`
3. 重写仓储层，先从正式表读案件主信息和动作日志
4. 再重写理算输入组装逻辑
