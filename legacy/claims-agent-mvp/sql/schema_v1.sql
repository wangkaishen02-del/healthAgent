PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
    product_id TEXT PRIMARY KEY,
    product_code TEXT NOT NULL UNIQUE,
    product_name TEXT NOT NULL,
    product_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS insureds (
    insured_id TEXT PRIMARY KEY,
    insured_name TEXT NOT NULL,
    id_no TEXT,
    gender TEXT,
    birth_date TEXT,
    mobile TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS policies (
    policy_id TEXT PRIMARY KEY,
    policy_no TEXT NOT NULL UNIQUE,
    product_id TEXT NOT NULL,
    holder_name TEXT,
    effective_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_force',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(product_id)
);

CREATE TABLE IF NOT EXISTS policy_insureds (
    policy_insured_id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL,
    insured_id TEXT NOT NULL,
    relation_to_holder TEXT,
    coverage_start_date TEXT NOT NULL,
    coverage_end_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (policy_id, insured_id),
    FOREIGN KEY (policy_id) REFERENCES policies(policy_id),
    FOREIGN KEY (insured_id) REFERENCES insureds(insured_id)
);

CREATE TABLE IF NOT EXISTS claims (
    claim_id TEXT PRIMARY KEY,
    claim_no TEXT NOT NULL UNIQUE,
    policy_id TEXT NOT NULL,
    insured_id TEXT NOT NULL,
    claim_type TEXT NOT NULL,
    source_channel TEXT,
    report_time TEXT,
    current_stage TEXT NOT NULL DEFAULT 'acceptance',
    status TEXT NOT NULL DEFAULT 'created',
    suggested_action TEXT,
    risk_level TEXT,
    is_standard_case INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (policy_id) REFERENCES policies(policy_id),
    FOREIGN KEY (insured_id) REFERENCES insureds(insured_id)
);

CREATE TABLE IF NOT EXISTS claim_visits (
    visit_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL UNIQUE,
    visit_type TEXT NOT NULL,
    hospital_name TEXT NOT NULL,
    hospital_level TEXT,
    department_name TEXT,
    admission_date TEXT,
    discharge_date TEXT,
    visit_days INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
);

CREATE TABLE IF NOT EXISTS claim_diagnoses (
    diagnosis_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    diagnosis_seq INTEGER NOT NULL,
    diagnosis_name TEXT NOT NULL,
    diagnosis_code_system TEXT,
    diagnosis_code TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_diagnoses_claim_id
ON claim_diagnoses(claim_id);

CREATE TABLE IF NOT EXISTS claim_documents (
    document_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    file_name TEXT,
    file_uri TEXT,
    receive_status TEXT NOT NULL DEFAULT 'received',
    ocr_status TEXT NOT NULL DEFAULT 'pending',
    extraction_status TEXT NOT NULL DEFAULT 'pending',
    document_time TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_documents_claim_id
ON claim_documents(claim_id);

CREATE TABLE IF NOT EXISTS claim_expense_items (
    expense_item_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    item_seq INTEGER,
    item_category TEXT,
    item_name TEXT NOT NULL,
    amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    quantity NUMERIC(18,2),
    unit_price NUMERIC(18,2),
    social_insurance_scope TEXT,
    self_pay_flag INTEGER NOT NULL DEFAULT 0,
    excluded_flag INTEGER NOT NULL DEFAULT 0,
    exclusion_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_expense_items_claim_id
ON claim_expense_items(claim_id);

CREATE TABLE IF NOT EXISTS rule_sets (
    rule_set_id TEXT PRIMARY KEY,
    rule_set_code TEXT NOT NULL UNIQUE,
    rule_set_name TEXT NOT NULL,
    claim_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rule_set_versions (
    rule_version_id TEXT PRIMARY KEY,
    rule_set_id TEXT NOT NULL,
    version_no TEXT NOT NULL,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    waiting_period_days INTEGER,
    deductible NUMERIC(18,2),
    reimbursement_rate NUMERIC(8,4),
    annual_limit NUMERIC(18,2),
    approval_threshold NUMERIC(18,2),
    rule_payload TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (rule_set_id, version_no),
    FOREIGN KEY (rule_set_id) REFERENCES rule_sets(rule_set_id)
);

CREATE TABLE IF NOT EXISTS claim_rule_applications (
    claim_rule_application_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    rule_version_id TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    waiting_period_passed INTEGER NOT NULL DEFAULT 0,
    hit_exclusion_flag INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id),
    FOREIGN KEY (rule_version_id) REFERENCES rule_set_versions(rule_version_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_rule_applications_claim_id
ON claim_rule_applications(claim_id);

CREATE TABLE IF NOT EXISTS claim_calculations (
    calculation_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    calc_version INTEGER NOT NULL DEFAULT 1,
    total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    social_insurance_paid NUMERIC(18,2) NOT NULL DEFAULT 0,
    self_paid_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    excluded_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    deductible_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    eligible_base NUMERIC(18,2) NOT NULL DEFAULT 0,
    reimbursement_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
    payable_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    within_limit_flag INTEGER NOT NULL DEFAULT 1,
    suggested_action TEXT NOT NULL,
    calc_status TEXT NOT NULL DEFAULT 'draft',
    calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_calculations_claim_id
ON claim_calculations(claim_id);

CREATE TABLE IF NOT EXISTS claim_calculation_items (
    calculation_item_id TEXT PRIMARY KEY,
    calculation_id TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_name TEXT NOT NULL,
    source_ref_type TEXT,
    source_ref_id TEXT,
    amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (calculation_id) REFERENCES claim_calculations(calculation_id)
);

CREATE TABLE IF NOT EXISTS claim_reviews (
    review_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    review_stage TEXT NOT NULL,
    reviewer_name TEXT,
    reviewer_role TEXT,
    review_result TEXT NOT NULL,
    review_note TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_reviews_claim_id
ON claim_reviews(claim_id);

CREATE TABLE IF NOT EXISTS claim_actions (
    action_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_stage TEXT NOT NULL,
    actor_name TEXT,
    actor_role TEXT,
    action_note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_actions_claim_id
ON claim_actions(claim_id);

CREATE TABLE IF NOT EXISTS claim_settlements (
    settlement_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL UNIQUE,
    settlement_result TEXT NOT NULL,
    payable_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    settlement_note TEXT,
    settlement_time TEXT,
    document_uri TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
    agent_run_id TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    trigger_source TEXT,
    model_name TEXT,
    run_status TEXT NOT NULL DEFAULT 'created',
    input_snapshot TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    FOREIGN KEY (claim_id) REFERENCES claims(claim_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_claim_id
ON agent_runs(claim_id);

CREATE TABLE IF NOT EXISTS agent_findings (
    finding_id TEXT PRIMARY KEY,
    agent_run_id TEXT NOT NULL,
    finding_type TEXT NOT NULL,
    severity TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    structured_payload TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_run_id) REFERENCES agent_runs(agent_run_id)
);
