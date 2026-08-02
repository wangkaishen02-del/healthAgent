export type AssistantMenuId = "comprehensive_query" | "claim_processing" | "underwriting_config";
export type RegisteredPageId = "policy_query" | "policy_detail" | "claim_query" | "claim_registration" | "claim_entry_calculation" | "claim_review_completion" | "calculation_config";

export type RegisteredField = {
  fieldId: string;
  label: string;
  type: "text" | "number" | "select" | "boolean" | "textarea";
  description: string;
  options?: Array<{ value: string; label: string }>;
  optionSource?: "runtime";
};

export type RegisteredAction = {
  actionId: string;
  label: string;
  description: string;
  kind: "navigation" | "input" | "query" | "view";
  target: "page" | "row";
};

export type RegisteredRegion = {
  regionId: string;
  label: string;
  description: string;
  fields?: RegisteredField[];
  actions?: RegisteredAction[];
  children?: RegisteredRegion[];
};

export type MenuRegistration = {
  menuId: AssistantMenuId;
  label: string;
  description: string;
  pages: Array<{ pageId: RegisteredPageId; label: string; description: string }>;
};

export type PageRegistration = {
  pageId: RegisteredPageId;
  label: string;
  description: string;
  menuId: AssistantMenuId;
  pagePath: string[];
  regions: RegisteredRegion[];
};

const menus: MenuRegistration[] = [
  {
    menuId: "comprehensive_query",
    label: "综合查询",
    description: "查询承保和案件相关的业务信息。",
    pages: [
      { pageId: "policy_query", label: "保单信息查询", description: "按保单或被保人条件查询保单。" },
      { pageId: "claim_query", label: "案件查询", description: "只读查询案件及其关系人、事件和影像信息。" },
    ],
  },
  {
    menuId: "claim_processing",
    label: "理赔处理",
    description: "承接理赔受理、案件检索、详情查看和理算结果联查。",
    pages: [
      { pageId: "claim_registration", label: "受理立案", description: "登记出险人员、申请与领款信息、事件经过和影像资料。" },
      { pageId: "claim_entry_calculation", label: "录入与理算", description: "录入账单、事件和疾病信息，执行理算并提交审核。" },
      { pageId: "claim_review_completion", label: "审核结案", description: "查看理算结果，执行审核回退或审核结案。" },
    ],
  },
  {
    menuId: "underwriting_config",
    label: "理赔配置",
    description: "维护理赔和理算相关的业务配置。",
    pages: [{ pageId: "calculation_config", label: "保单理算配置", description: "按保单、保障计划、险种和责任维护理算参数。" }],
  },
];

const claimProcessingListRegion: RegisteredRegion = {
  regionId: "processing_case_list",
  label: "待处理案件列表",
  description: "搜索并打开当前环节的案件；后台结果中的案件 ID 可用于稳定对象操作。",
  fields: [{ fieldId: "caseKeyword", label: "案件搜索", type: "text", description: "按案件号、保单号、被保人、证件号或事件号搜索。" }],
  actions: [
    { actionId: "search", label: "搜索案件", description: "按当前关键词刷新案件列表。", kind: "query", target: "page" },
    { actionId: "refresh", label: "刷新案件", description: "刷新当前案件列表。", kind: "query", target: "page" },
    { actionId: "reset", label: "重置页面", description: "清空搜索条件并返回案件列表。", kind: "input", target: "page" },
    { actionId: "open_case", label: "打开案件", description: "打开列表指定案件。", kind: "view", target: "row" },
  ],
};

const claimDetailNavigationRegion: RegisteredRegion = {
  regionId: "processing_case_detail_navigation",
  label: "案件详情导航",
  description: "切换案件资料区域和辅助查看区域。",
  actions: [
    { actionId: "show_acceptance", label: "受理信息", description: "查看案件受理信息。", kind: "view", target: "page" },
    { actionId: "show_bills", label: "账单信息", description: "查看账单列表。", kind: "view", target: "page" },
    { actionId: "show_events", label: "事件信息", description: "查看被保人的事件列表。", kind: "view", target: "page" },
    { actionId: "show_diseases", label: "疾病信息", description: "查看案件疾病信息。", kind: "view", target: "page" },
    { actionId: "toggle_attachments", label: "影像件", description: "打开或收起影像件区域。", kind: "view", target: "page" },
    { actionId: "open_personal_ledger", label: "个人台账", description: "打开当前被保人的理算台账。", kind: "view", target: "page" },
    { actionId: "open_calculation_process", label: "理算过程", description: "打开当前案件已保存的理算过程。", kind: "view", target: "page" },
    { actionId: "back_to_list", label: "返回案件列表", description: "关闭当前案件详情并返回列表。", kind: "navigation", target: "page" },
  ],
};

const claimEntryBillRegion: RegisteredRegion = {
  regionId: "claim_entry_bills",
  label: "账单录入",
  description: "新增或编辑医疗账单；必填票据号码、患者姓名、医疗机构、收费日期和医疗总费用。",
  fields: [
    { fieldId: "invoiceCode", label: "票据代码", type: "text", description: "电子票据代码，可为空。" },
    { fieldId: "invoiceNo", label: "票据号码", type: "text", description: "医疗票据号码，必填。" },
    { fieldId: "checkCode", label: "校验码", type: "text", description: "票据校验码，可为空。" },
    { fieldId: "billType", label: "票据类型", type: "select", description: "账单类型。", options: [{ value: "1", label: "门诊" }, { value: "2", label: "住院" }, { value: "3", label: "门诊特殊病" }, { value: "4", label: "药店购药" }, { value: "9", label: "其他费用" }] },
    { fieldId: "patientName", label: "患者姓名", type: "text", description: "账单患者姓名，必填。" },
    { fieldId: "patientIdNo", label: "患者证件号", type: "text", description: "患者证件号码。" },
    { fieldId: "visitNo", label: "门诊或住院号", type: "text", description: "医院就诊流水号。" },
    { fieldId: "institution", label: "医疗机构", type: "text", description: "医院或药店名称，必填。" },
    { fieldId: "department", label: "就诊科室", type: "text", description: "就诊科室。" },
    { fieldId: "billDate", label: "收费日期", type: "text", description: "格式 YYYY-MM-DD，必填。" },
    { fieldId: "admissionDate", label: "入院日期", type: "text", description: "住院账单入院日期。" },
    { fieldId: "dischargeDate", label: "出院日期", type: "text", description: "住院账单出院日期。" },
    { fieldId: "diagnosis", label: "主要诊断", type: "text", description: "账单主要诊断。" },
    { fieldId: "medicalInsuranceType", label: "医保类型", type: "select", description: "医保结算类型。", options: [{ value: "1", label: "城镇职工基本医疗保险" }, { value: "2", label: "城乡居民基本医疗保险" }, { value: "3", label: "新型农村合作医疗" }, { value: "4", label: "商业健康保险" }, { value: "5", label: "全自费" }, { value: "9", label: "其他" }] },
    { fieldId: "settlementNo", label: "医保结算单号", type: "text", description: "医保结算单号。" },
    { fieldId: "totalAmount", label: "医疗总费用", type: "number", description: "医疗总费用，单位元，必须大于 0。" },
    { fieldId: "insuranceFundAmount", label: "医保统筹支付", type: "number", description: "医保统筹支付金额。" },
    { fieldId: "personalAccountAmount", label: "个人账户支付", type: "number", description: "个人账户支付金额。" },
    { fieldId: "cashAmount", label: "个人现金支付", type: "number", description: "个人现金支付金额。" },
    { fieldId: "selfPaidAmount", label: "自费金额", type: "number", description: "其中自费金额。" },
    { fieldId: "cashier", label: "收费员", type: "text", description: "票据收费员。" },
  ],
  actions: [
    { actionId: "start_new_bill", label: "新增账单", description: "打开空白账单编辑器。", kind: "input", target: "page" },
    { actionId: "save_bill", label: "保存账单", description: "校验并保存当前账单。", kind: "input", target: "page" },
  ],
};

const claimEntryEventRegion: RegisteredRegion = {
  regionId: "claim_entry_events",
  label: "事件录入",
  description: "筛选当前被保人的事件，或新增案件相关事件。",
  fields: [
    { fieldId: "eventKeyword", label: "事件关键词", type: "text", description: "按事件号、地点、医院、诊断或经过筛选。" },
    { fieldId: "eventTypeFilter", label: "事件类型筛选", type: "select", description: "all 表示全部。", options: [{ value: "all", label: "全部" }, { value: "1", label: "疾病" }, { value: "2", label: "意外" }, { value: "9", label: "其他" }] },
    { fieldId: "eventDateFilter", label: "事件日期筛选", type: "text", description: "格式 YYYY-MM-DD。" },
    { fieldId: "eventType", label: "事件类型", type: "select", description: "新增事件类型。", options: [{ value: "1", label: "疾病" }, { value: "2", label: "意外" }, { value: "9", label: "其他" }] },
    { fieldId: "eventOccurredDate", label: "事件发生日期", type: "text", description: "格式 YYYY-MM-DD，必填。" },
    { fieldId: "eventAdministrativeArea", label: "发生地区", type: "text", description: "省、市、区县路径。" },
    { fieldId: "eventDetailedAddress", label: "详细地点", type: "text", description: "街道或详细地址。" },
    { fieldId: "eventHospitalName", label: "就诊医院", type: "text", description: "事件就诊医院。" },
    { fieldId: "eventDiagnosis", label: "事件诊断", type: "text", description: "事件诊断。" },
    { fieldId: "eventDescription", label: "事件经过", type: "textarea", description: "事件经过，必填。" },
  ],
  actions: [
    { actionId: "start_new_event", label: "新增事件", description: "打开事件编辑器。", kind: "input", target: "page" },
    { actionId: "save_event", label: "保存事件", description: "保存当前事件。", kind: "input", target: "page" },
  ],
};

const claimEntryDiseaseRegion: RegisteredRegion = {
  regionId: "claim_entry_diseases",
  label: "疾病录入",
  description: "新增案件疾病和确诊信息。",
  fields: [
    { fieldId: "diseaseName", label: "疾病名称", type: "text", description: "疾病或诊断名称，必填。" },
    { fieldId: "diseaseIcdCode", label: "ICD 编码", type: "text", description: "疾病 ICD 编码。" },
    { fieldId: "diseaseDiagnosisDate", label: "确诊日期", type: "text", description: "格式 YYYY-MM-DD，必填。" },
    { fieldId: "diseaseHospital", label: "确诊医院", type: "text", description: "确诊医院，必填。" },
    { fieldId: "diseaseNote", label: "诊断说明", type: "textarea", description: "补充症状或检查说明。" },
  ],
  actions: [
    { actionId: "start_new_disease", label: "新增疾病", description: "打开疾病编辑器。", kind: "input", target: "page" },
    { actionId: "save_disease", label: "保存疾病", description: "保存当前疾病信息。", kind: "input", target: "page" },
  ],
};

const pages: PageRegistration[] = [
  {
    pageId: "policy_query",
    label: "保单信息查询",
    description: "查询保单基本信息、保障计划信息、险种责任信息和被保人信息。",
    menuId: "comprehensive_query",
    pagePath: ["综合查询", "保单信息查询"],
    regions: [
      {
        regionId: "policy_search_form",
        label: "保单查询条件",
        description: "填写一个或多个条件后点击查询。",
        fields: [
          { fieldId: "policyNo", label: "保单号", type: "text", description: "保单的业务编号。" },
          { fieldId: "applicantName", label: "投保单位", type: "text", description: "团体投保单位名称。" },
          { fieldId: "insuredName", label: "被保人姓名", type: "text", description: "被保人姓名，例如张三。" },
          { fieldId: "insuredIdNo", label: "被保人证件号", type: "text", description: "被保人的身份证件号码。" },
          {
            fieldId: "policyStatus",
            label: "保单状态",
            type: "select",
            description: "保单当前状态。",
            options: [{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }],
          },
        ],
        actions: [
          { actionId: "search", label: "查询", description: "按当前条件查询保单列表。", kind: "query", target: "page" },
          { actionId: "reset", label: "重置", description: "清空所有保单查询条件。", kind: "input", target: "page" },
        ],
      },
      {
        regionId: "policy_result_table",
        label: "保单结果列表",
        description: "展示符合条件的保单，支持查看详情、责任信息和被保人信息。",
        actions: [
          { actionId: "view_detail", label: "详细信息", description: "打开选中保单的基本信息。", kind: "view", target: "row" },
          { actionId: "view_benefits", label: "责任信息", description: "打开选中保单的保障计划、险种和责任层级列表。", kind: "view", target: "row" },
          { actionId: "view_insureds", label: "被保人信息", description: "打开选中保单的被保人列表，列表展示关联保障计划并支持按保障计划筛选。", kind: "view", target: "row" },
        ],
      },
    ],
  },
  {
    pageId: "policy_detail",
    label: "保单详细信息",
    description: "展示选中保单的基本信息、概览、保障计划、险种责任和被保人信息。",
    menuId: "comprehensive_query",
    pagePath: ["综合查询", "保单信息查询", "详细信息"],
    regions: [
      {
        regionId: "policy_basic_info",
        label: "保单基本信息",
        description: "展示保单号、保单名称、投保单位、保障期间和保单状态。",
      },
      {
        regionId: "policy_overview",
        label: "保单概览",
        description: "展示保障计划数、险种数、责任数和被保人数。",
      },
      {
        regionId: "policy_detail_tabs",
        label: "详情页签",
        description: "在保单基本信息、责任信息、被保人清单之间切换；责任信息包含保障计划、险种和责任层级。",
        actions: [
          { actionId: "view_detail", label: "基本信息", description: "查看保单基本信息和概览。", kind: "view", target: "page" },
          { actionId: "view_benefits", label: "责任信息", description: "查看保障计划、险种和责任层级列表。", kind: "view", target: "page" },
          { actionId: "view_insureds", label: "被保人清单", description: "查看被保人及其关联保障计划，并可按保障计划筛选。", kind: "view", target: "page" },
        ],
      },
      {
        regionId: "policy_insured_list",
        label: "被保人列表",
        description: "展示当前详情对象下的人员，可使用已注册筛选字段缩小结果范围。",
        fields: [
          {
            fieldId: "coveragePlanId",
            label: "保障计划",
            type: "select",
            description: "按当前页面上下文提供的保障计划筛选人员；空值表示全部。",
            optionSource: "runtime",
          },
        ],
      },
    ],
  },
  {
    pageId: "claim_query",
    label: "案件查询",
    description: "按案件号、保单号、被保人、案件状态和报案日期查询案件，仅支持查看，不提供新增、修改、提交或撤件操作。",
    menuId: "comprehensive_query",
    pagePath: ["综合查询", "案件查询"],
    regions: [
      {
        regionId: "claim_query_filters",
        label: "案件查询条件",
        description: "组合条件检索理赔案件；条件均可为空。",
        fields: [
          { fieldId: "caseNo", label: "案件号", type: "text", description: "完整案件号，例如 CL202607190001。" },
          { fieldId: "policyNo", label: "保单号", type: "text", description: "完整保单号。" },
          { fieldId: "insuredName", label: "被保人姓名", type: "text", description: "支持姓名模糊匹配。" },
          { fieldId: "insuredIdNo", label: "被保人证件号", type: "text", description: "按完整证件号匹配。" },
          { fieldId: "status", label: "案件状态", type: "select", description: "按案件状态筛选；空值表示全部。", options: [{ value: "", label: "全部状态" }, { value: "registered", label: "受理" }, { value: "entering", label: "录入" }, { value: "calculating", label: "理算" }, { value: "reviewing", label: "审核" }, { value: "completed", label: "结案" }, { value: "cancelled", label: "已撤件" }] },
          { fieldId: "reportDateFrom", label: "报案日期起", type: "text", description: "报案日期范围开始，格式 YYYY-MM-DD。" },
          { fieldId: "reportDateTo", label: "报案日期止", type: "text", description: "报案日期范围结束，格式 YYYY-MM-DD。" },
        ],
        actions: [
          { actionId: "search", label: "查询", description: "按当前条件刷新案件列表。", kind: "query", target: "page" },
          { actionId: "reset", label: "重置", description: "清空条件并查询全部案件。", kind: "view", target: "page" },
        ],
      },
      {
        regionId: "claim_query_results",
        label: "案件查询结果",
        description: "展示匹配案件；详情页中的案件、关系人、事件与影像数据全部只读。",
        actions: [
          { actionId: "view_case", label: "查看详情", description: "打开指定案件的只读详情。", kind: "view", target: "row" },
        ],
      },
    ],
  },
  {
    pageId: "claim_registration",
    label: "受理立案",
    description: "查询、创建和维护理赔案件，支持人员快照、事件信息、影像资料及案件状态流转。",
    menuId: "claim_processing",
    pagePath: ["理赔处理", "受理立案"],
    regions: [
      {
        regionId: "claim_case_basic",
        label: "立案基本信息",
        description: "通过人员证件号查询其全部关联保单；唯一保单自动选择，多张保单由用户选择，并登记受理日期和渠道。",
        fields: [
          { fieldId: "insuredIdNo", label: "被保人证件号", type: "text", description: "用于查询该人员全部关联保单的完整证件号码。" },
          { fieldId: "reportDate", label: "报案日期", type: "text", description: "格式为 YYYY-MM-DD；页面默认当前系统日期，用户未指定时无需覆盖。" },
          { fieldId: "reportChannel", label: "报案渠道", type: "select", description: "客户报案来源。", options: [{ value: "online", label: "线上报案" }, { value: "phone", label: "电话报案" }, { value: "counter", label: "柜面报案" }, { value: "other", label: "其他" }] },
        ],
        actions: [
          { actionId: "lock_insured", label: "查询关联保单", description: "按证件号查询承保关系；唯一保单自动锁定，多张保单等待用户选择。", kind: "query", target: "page" },
          { actionId: "reset", label: "重置", description: "清空当前未提交的立案内容。", kind: "input", target: "page" },
        ],
      },
      {
        regionId: "claim_case_remark",
        label: "案件备注",
        description: "独立记录本案受理、理算和审核过程中需要持续关注的补充事项。",
        fields: [
          { fieldId: "remark", label: "案件备注", type: "textarea", description: "补充报案来源、特殊情况或后续处理提醒，可为空。" },
        ],
      },
      {
        regionId: "claim_case_list",
        label: "受理案件",
        description: "只展示受理状态的案件；提交后转为录入状态并进入录入与理算页面。",
        actions: [
          { actionId: "new_case", label: "新建立案", description: "清空当前案件上下文并进入新建立案状态。", kind: "input", target: "page" },
          { actionId: "edit_case", label: "打开案件", description: "选中并打开列表中的指定案件进行查看或维护，效果与人工双击案件行一致；可按行号或后台返回的稳定对象标识执行。", kind: "view", target: "row" },
        ],
      },
      {
        regionId: "claim_party_information",
        label: "被保人、申请人与领款人信息",
        description: "被保人信息由承保关系带出并允许补充；申请人和领款人可复用已有资料或独立填写。",
        fields: [
          { fieldId: "insuredName", label: "被保人姓名", type: "text", description: "案件被保人姓名。" },
          { fieldId: "insuredGender", label: "被保人性别", type: "select", description: "被保人性别。", options: [{ value: "unknown", label: "未知" }, { value: "male", label: "男" }, { value: "female", label: "女" }] },
          { fieldId: "insuredBirthDate", label: "被保人出生日期", type: "text", description: "被保人出生日期，格式 YYYY-MM-DD。" },
          { fieldId: "insuredIdType", label: "被保人证件类型", type: "select", description: "被保人的证件类型。", options: [{ value: "id_card", label: "身份证" }, { value: "passport", label: "护照" }, { value: "other", label: "其他" }] },
          { fieldId: "insuredPartyIdNo", label: "被保人信息中的证件号", type: "text", description: "关系人快照中的被保人证件号码；锁定承保关系应使用立案基本信息中的 insuredIdNo。" },
          { fieldId: "insuredIdValidFrom", label: "被保人证件有效期起", type: "text", description: "被保人证件有效期起始日期。" },
          { fieldId: "insuredIdValidTo", label: "被保人证件有效期止", type: "text", description: "被保人证件有效期截止日期；填写后自动取消长期有效。" },
          { fieldId: "insuredIdLongTerm", label: "被保人证件长期有效", type: "boolean", description: "与证件有效期止互斥；设为 true 时自动清空有效期止。" },
          { fieldId: "insuredPhone", label: "被保人电话", type: "text", description: "被保人联系电话。" },
          { fieldId: "insuredAddress", label: "被保人联系地址", type: "text", description: "被保人联系地址。" },
          { fieldId: "applicantSameAsInsured", label: "申请人同被保人", type: "boolean", description: "设为 true 时自动复制被保人资料到申请人。", options: [{ value: "true", label: "同被保人" }, { value: "false", label: "独立填写" }] },
          { fieldId: "applicantName", label: "申请人姓名", type: "text", description: "理赔申请人姓名。" },
          { fieldId: "applicantRelationToInsured", label: "申请人与被保人关系", type: "text", description: "申请人与被保人的关系。" },
          { fieldId: "applicantGender", label: "申请人性别", type: "select", description: "申请人性别。", options: [{ value: "unknown", label: "未知" }, { value: "male", label: "男" }, { value: "female", label: "女" }] },
          { fieldId: "applicantBirthDate", label: "申请人出生日期", type: "text", description: "申请人出生日期；完整日期使用 YYYY-MM-DD。" },
          { fieldId: "applicantIdType", label: "申请人证件类型", type: "select", description: "申请人的证件类型。", options: [{ value: "id_card", label: "身份证" }, { value: "passport", label: "护照" }, { value: "other", label: "其他" }] },
          { fieldId: "applicantIdNo", label: "申请人证件号", type: "text", description: "理赔申请人证件号码。" },
          { fieldId: "applicantIdValidFrom", label: "申请人证件有效期起", type: "text", description: "申请人证件有效期起始日期。可填写完整日期；已有日期时也可只填写年份，系统保留原月日。" },
          { fieldId: "applicantIdValidTo", label: "申请人证件有效期止", type: "text", description: "与长期有效互斥；填写后自动取消长期有效。可填写完整日期，已有日期时也可只填写年份并保留原月日。" },
          { fieldId: "applicantIdLongTerm", label: "申请人证件长期有效", type: "boolean", description: "与证件有效期止互斥；设为 true 时自动清空有效期止。" },
          { fieldId: "applicantPhone", label: "申请人电话", type: "text", description: "理赔申请人联系电话。" },
          { fieldId: "applicantAddress", label: "申请人联系地址", type: "text", description: "申请人的联系地址。" },
          { fieldId: "payeeSource", label: "领款人信息来源", type: "select", description: "选择复用被保人、申请人资料，或另行填写。", options: [{ value: "insured", label: "同被保人" }, { value: "applicant", label: "同申请人" }, { value: "other", label: "另行填写" }] },
          { fieldId: "payeeName", label: "领款人姓名", type: "text", description: "赔款领取人姓名。" },
          { fieldId: "payeeRelationToInsured", label: "领款人与被保人关系", type: "text", description: "领款人与被保人的关系。" },
          { fieldId: "payeeGender", label: "领款人性别", type: "select", description: "领款人性别。", options: [{ value: "unknown", label: "未知" }, { value: "male", label: "男" }, { value: "female", label: "女" }] },
          { fieldId: "payeeBirthDate", label: "领款人出生日期", type: "text", description: "领款人出生日期；完整日期使用 YYYY-MM-DD。" },
          { fieldId: "payeeIdType", label: "领款人证件类型", type: "select", description: "领款人的证件类型。", options: [{ value: "id_card", label: "身份证" }, { value: "passport", label: "护照" }, { value: "other", label: "其他" }] },
          { fieldId: "payeeIdNo", label: "领款人证件号", type: "text", description: "赔款领取人证件号码。" },
          { fieldId: "payeeIdValidFrom", label: "领款人证件有效期起", type: "text", description: "领款人证件有效期起始日期。可填写完整日期；已有日期时也可只填写年份，系统保留原月日；两位年份 00 表示 2000 年。" },
          { fieldId: "payeeIdValidTo", label: "领款人证件有效期止", type: "text", description: "与长期有效互斥；填写后自动取消长期有效。可填写完整日期，已有日期时也可只填写年份并保留原月日。" },
          { fieldId: "payeeIdLongTerm", label: "领款人证件长期有效", type: "boolean", description: "与证件有效期止互斥；设为 true 时自动清空有效期止。" },
          { fieldId: "payeePhone", label: "领款人电话", type: "text", description: "赔款领取人联系电话。" },
          { fieldId: "payeeAddress", label: "领款人联系地址", type: "text", description: "领款人的联系地址。" },
          { fieldId: "payeePaymentMethod", label: "领款方式", type: "select", description: "赔款领取方式；立案时尚未确定可使用 pending。", options: [{ value: "pending", label: "待确定" }, { value: "bank_transfer", label: "银行转账" }, { value: "cash", label: "现金领取" }, { value: "other", label: "其他方式" }] },
          { fieldId: "payeeBankName", label: "开户银行", type: "text", description: "领款账户开户银行。" },
          { fieldId: "payeeBankAccountName", label: "账户名称", type: "text", description: "领款银行账户名称。" },
          { fieldId: "payeeBankAccountNo", label: "银行账号", type: "text", description: "领款银行账号。" },
        ],
      },
      {
        regionId: "claim_event_information",
        label: "事件信息",
        description: "仅展示当前被保人的事件列表，列表包含被保人姓名；可选择已有事件关联案件、新增事件，或打开已有事件进行编辑。",
        fields: [
          { fieldId: "eventKeyword", label: "事件关键词", type: "text", description: "按事件号、地点、医院、诊断或事件经过筛选当前人员事件。" },
          { fieldId: "eventTypeFilter", label: "事件类型筛选", type: "select", description: "筛选当前人员事件；all 表示全部。", options: [{ value: "all", label: "全部类型" }, { value: "1", label: "疾病" }, { value: "2", label: "意外" }, { value: "9", label: "其他" }] },
          { fieldId: "eventDateFilter", label: "事件日期筛选", type: "text", description: "按发生日期筛选当前人员事件，格式为 YYYY-MM-DD。" },
          { fieldId: "eventType", label: "事件类型", type: "select", description: "新增事件的类型。", options: [{ value: "1", label: "疾病" }, { value: "2", label: "意外" }, { value: "9", label: "其他" }] },
          { fieldId: "occurredDate", label: "事件发生日期", type: "text", description: "必填字段，页面工具值使用 YYYY-MM-DD；用户未提供时必须追问，但不得要求用户遵守技术格式，用户可用自然语言回答。" },
          { fieldId: "administrativeArea", label: "发生地点", type: "text", description: "可选字段。省、市、区县组成的完整行政区路径；仅在用户明确提供地点时填写。" },
          { fieldId: "detailedAddress", label: "详细地点", type: "text", description: "可选字段。街道、门牌号等详细地址；不得自行编造。" },
          { fieldId: "hospitalName", label: "就诊医院", type: "text", description: "可选字段。仅在用户明确提供或系统已有信息时填写。" },
          { fieldId: "diagnosis", label: "诊断", type: "text", description: "可选字段。仅在用户明确提供或系统已有信息时填写。" },
          { fieldId: "eventDescription", label: "事件经过", type: "textarea", description: "事故或疾病发生、就诊及治疗经过。" },
        ],
        actions: [
          { actionId: "reset_event_filters", label: "清空事件筛选", description: "清空事件列表的关键词、类型和日期筛选条件。", kind: "input", target: "page" },
          { actionId: "open_event_editor", label: "新增事件", description: "打开当前人员的事件新增区域。", kind: "input", target: "page" },
          { actionId: "close_event_editor", label: "取消事件编辑", description: "关闭事件新增或编辑区域并放弃未保存内容。", kind: "input", target: "page" },
          { actionId: "create_event", label: "保存事件", description: "保存新增事件并自动关联，或保存当前正在编辑的已有事件。", kind: "input", target: "page" },
          { actionId: "select_event", label: "关联事件", description: "选择事件列表指定行并关联到当前案件。", kind: "input", target: "row" },
          { actionId: "edit_event", label: "编辑事件", description: "打开事件列表指定行并带出已有信息进行编辑。", kind: "input", target: "row" },
        ],
      },
      {
        regionId: "claim_attachments",
        label: "影像资料",
        description: "选择影像分类、人工选择文件上传，并可删除当前影像。出于本地文件权限安全限制，文件选择仍由用户完成。",
        fields: [
          { fieldId: "attachmentCategory", label: "影像分类", type: "select", description: "下一次人工上传文件所使用的资料分类。", options: [{ value: "application", label: "理赔申请书" }, { value: "identity", label: "身份证明" }, { value: "medical", label: "病历资料" }, { value: "invoice", label: "发票费用清单" }, { value: "bank", label: "银行卡资料" }, { value: "other", label: "其他资料" }] },
        ],
        actions: [
          { actionId: "remove_attachment", label: "删除影像", description: "删除影像列表中指定的文件；支持按行号或 uploadId 操作。", kind: "input", target: "row" },
        ],
      },
      {
        regionId: "claim_submission",
        label: "案件操作",
        description: "保存新案件或修改，或者将已保存案件提交、撤件。",
        actions: [
          { actionId: "save_case", label: "保存立案/保存修改", description: "新建状态显示“保存立案”并创建受理案件；打开受理案件后显示“保存修改”。新建立案成功后页面自动清空重置。", kind: "input", target: "page" },
          { actionId: "cancel_case", label: "撤件", description: "将当前受理案件变更为已撤件。", kind: "input", target: "page" },
          { actionId: "submit_case", label: "提交", description: "将当前受理案件提交为录入状态，并转入录入与理算页面。", kind: "input", target: "page" },
        ],
      },
    ],
  },
  {
    pageId: "claim_entry_calculation",
    label: "录入与理算",
    description: "搜索录入或理算状态案件，录入账单、事件和疾病信息，执行自动理算并提交审核。",
    menuId: "claim_processing",
    pagePath: ["理赔处理", "录入与理算"],
    regions: [
      claimProcessingListRegion,
      claimDetailNavigationRegion,
      claimEntryBillRegion,
      claimEntryEventRegion,
      claimEntryDiseaseRegion,
      {
        regionId: "claim_calculation_workflow",
        label: "理算与流转操作",
        description: "执行理算、回退、提交审核、退回受理或撤件；回退和撤件必须先请求确认，再执行确认动作。",
        actions: [
          { actionId: "run_calculation", label: "开始理算", description: "对当前账单执行自动理算并更新台账。", kind: "input", target: "page" },
          { actionId: "request_calculation_rollback", label: "理算回退", description: "打开理算回退二次确认。", kind: "input", target: "page" },
          { actionId: "confirm_calculation_rollback", label: "确认理算回退", description: "仅在已经请求理算回退后执行，删除本次理算结果并冲回台账。", kind: "input", target: "page" },
          { actionId: "submit_review", label: "提交审核", description: "将已完成理算的案件提交审核。", kind: "input", target: "page" },
          { actionId: "request_case_rollback", label: "退回受理", description: "打开退回上一状态的二次确认。", kind: "input", target: "page" },
          { actionId: "confirm_case_rollback", label: "确认退回受理", description: "仅在已经请求退回后执行，将案件退回上一状态和提交人。", kind: "input", target: "page" },
          { actionId: "request_withdraw", label: "撤件", description: "打开撤件二次确认。", kind: "input", target: "page" },
          { actionId: "confirm_withdraw", label: "确认撤件", description: "仅在已经请求撤件后执行。", kind: "input", target: "page" },
        ],
      },
    ],
  },
  {
    pageId: "claim_review_completion",
    label: "审核结案",
    description: "搜索审核状态案件，只读查看受理、账单、事件、疾病、理算过程和台账，并执行审核回退或结案。",
    menuId: "claim_processing",
    pagePath: ["理赔处理", "审核结案"],
    regions: [
      { ...claimProcessingListRegion, regionId: "review_case_list", label: "审核案件列表" },
      claimDetailNavigationRegion,
      {
        regionId: "claim_review_workflow",
        label: "审核操作",
        description: "审核页面数据只读；审核回退必须先请求确认。",
        actions: [
          { actionId: "request_case_rollback", label: "审核回退", description: "打开审核回退二次确认。", kind: "input", target: "page" },
          { actionId: "confirm_case_rollback", label: "确认审核回退", description: "仅在已经请求审核回退后执行，将案件退回理算并退给提交人。", kind: "input", target: "page" },
          { actionId: "complete_review", label: "审核结案", description: "审核通过并将当前案件结案。", kind: "input", target: "page" },
        ],
      },
    ],
  },
  {
    pageId: "calculation_config",
    label: "保单理算配置",
    description: "为保单、保障计划、险种和责任维护可扩展的理算参数。",
    menuId: "underwriting_config",
    pagePath: ["理赔配置", "保单理算配置"],
    regions: [
      {
        regionId: "calculation_policy_search",
        label: "保单查询",
        description: "按完整保单号查询需要维护理算配置的保单。",
        fields: [
          { fieldId: "policyNo", label: "保单号", type: "text", description: "需要维护配置的完整保单号。" },
        ],
        actions: [
          { actionId: "search", label: "查询", description: "按当前字段查询保单及其配置对象。", kind: "query", target: "page" },
          { actionId: "reset", label: "重置", description: "清空查询和当前配置上下文。", kind: "input", target: "page" },
        ],
      },
      {
        regionId: "calculation_policy_hierarchy",
        label: "保单配置对象列表",
        description: "展示保单基本信息以及保单、保障计划、险种、责任四级配置对象。",
        actions: [
          { actionId: "configure", label: "配置", description: "打开列表选中行的参数配置页。", kind: "view", target: "row" },
        ],
      },
      {
        regionId: "calculation_parameter_editor",
        label: "参数编辑器",
        description: "为当前配置对象新增或编辑参数；可用参数名称由运行时上下文提供。",
        fields: [
          { fieldId: "definitionCode", label: "参数名称", type: "select", description: "选择适用于当前对象且尚未重复配置的参数定义。", optionSource: "runtime" },
          { fieldId: "parameterValue", label: "参数值", type: "text", description: "按照所选参数定义的值类型填写；布尔值使用 true 或 false。" },
          { fieldId: "description", label: "参数说明", type: "textarea", description: "补充参数计算口径或适用范围，可为空。" },
          {
            fieldId: "enabled",
            label: "状态",
            type: "boolean",
            description: "参数是否启用。",
            options: [{ value: "true", label: "启用" }, { value: "false", label: "停用" }],
          },
        ],
        actions: [
          { actionId: "create_parameter", label: "新增参数", description: "打开当前对象的新增参数编辑器。", kind: "input", target: "page" },
          { actionId: "save_parameter", label: "保存参数", description: "校验并保存当前编辑器内容。", kind: "input", target: "page" },
          { actionId: "cancel_edit", label: "取消编辑", description: "关闭编辑器并放弃未保存内容。", kind: "input", target: "page" },
          { actionId: "back_to_objects", label: "返回上一页", description: "返回当前保单的配置对象列表。", kind: "navigation", target: "page" },
        ],
      },
      {
        regionId: "calculation_parameter_list",
        label: "理算参数列表",
        description: "展示当前对象已经配置的参数，支持编辑和删除。",
        actions: [
          { actionId: "edit_parameter", label: "编辑", description: "将选中行加载到参数编辑器。", kind: "input", target: "row" },
          { actionId: "request_delete_parameter", label: "删除", description: "请求删除选中行；需要页面确认动作后才会实际删除。", kind: "input", target: "row" },
          { actionId: "confirm_delete_parameter", label: "确认删除", description: "确认删除当前待删除参数。", kind: "input", target: "page" },
          { actionId: "cancel_delete_parameter", label: "取消删除", description: "取消当前删除请求。", kind: "input", target: "page" },
        ],
      },
    ],
  },
];

export function getNavigationRegistry() { return { menus }; }
export function getAllMenuRegistrations() { return menus; }
export function getMenuPages(menuId: string) { return menus.find((menu) => menu.menuId === menuId) ?? null; }

export function getPageRegistration(pageId: string) {
  return pages.find((item) => item.pageId === pageId) ?? null;
}

function compactRegion(region: RegisteredRegion): Record<string, unknown> {
  return {
    regionId: region.regionId,
    label: region.label,
    ...(region.fields?.length ? {
      fields: region.fields.map((field) => ({
        fieldId: field.fieldId,
        label: field.label,
        ...(field.type !== "text" ? { type: field.type } : {}),
        ...(field.optionSource ? { optionSource: field.optionSource } : {}),
        ...(field.options ? { options: field.options } : {}),
      })),
    } : {}),
    ...(region.actions?.length ? {
      actions: region.actions.map((action) => ({
        actionId: action.actionId,
        label: action.label,
        target: action.target,
      })),
    } : {}),
    ...(region.children?.length ? { children: region.children.map(compactRegion) } : {}),
  };
}

export function getCompactPageRegistration(pageId: string) {
  const page = getPageRegistration(pageId);
  if (!page) return null;
  return {
    pageId: page.pageId,
    label: page.label,
    pagePath: page.pagePath,
    regions: page.regions.map(compactRegion),
  };
}

function flattenRegions(regions: RegisteredRegion[]): RegisteredRegion[] {
  return regions.flatMap((region) => [region, ...flattenRegions(region.children ?? [])]);
}

export function getRegisteredField(pageId: string, fieldId: string) {
  const page = getPageRegistration(pageId);
  if (!page) return null;
  return flattenRegions(page.regions)
    .flatMap((region) => region.fields ?? [])
    .find((field) => field.fieldId === fieldId) ?? null;
}

export function getRegisteredAction(pageId: string, actionId: string, target?: RegisteredAction["target"]) {
  const page = getPageRegistration(pageId);
  if (!page) return null;
  return flattenRegions(page.regions)
    .flatMap((region) => region.actions ?? [])
    .find((action) => action.actionId === actionId && (!target || action.target === target)) ?? null;
}

export function isNavigablePage(pageId: string) {
  return menus.some((menu) => menu.pages.some((page) => page.pageId === pageId));
}
export function getAssistantDiscoveryToolCatalog() {
  return [
    { tool: "get_menu_pages", args: { menuId: "目标菜单的menuId" }, description: "根据目标菜单的menuId查询该菜单下的页面。" },
    { tool: "get_page_registry", args: { pageId: "目标页面的pageId" }, description: "根据目标页面的pageId查询页面的区域、字段和动作注册信息。" },
  ];
}

export function getAssistantActionToolCatalog() {
  return [
    { tool: "open_page", args: { pageId: "目标页面的pageId" }, description: "打开目标页面，参数填写目标页面的pageId。" },
    { tool: "set_field", args: { pageId: "目标页面的pageId", fieldId: "目标字段的fieldId", value: "你想输入的值" }, description: "填写目标页面中已注册的字段，参数填写目标页面的pageId和目标字段的fieldId。" },
    { tool: "click_button", args: { pageId: "目标页面的pageId", actionId: "目标动作的actionId" }, description: "点击目标页面中已注册的动作，参数填写目标页面的pageId和目标动作的actionId。" },
    { tool: "click_list_row_action", args: { pageId: "目标页面的pageId", actionId: "目标列表操作的actionId", row: "例如：1" }, description: "点击目标页面列表第 row 行操作列中已注册的动作，row填写从1开始的数字，例如1表示第一行。" },
    { tool: "click_list_item_action", args: { pageId: "目标页面的pageId", actionId: "目标列表操作的actionId", itemId: "后台查询结果返回的itemId" }, description: "使用后台查询结果返回的稳定对象标识，对页面列表中的指定对象执行已注册动作；不依赖当前排序和行号。" },
  ];
}

export function getAssistantBackendToolCatalog() {
  return [
    { tool: "query_underwriting", args: { policyNo: "可选", insuredName: "可选", insuredIdNo: "可选" }, description: "在后台查询承保关系，至少提供一个条件；返回保单、承保关系、被保人和保障计划信息，不操作前端查询页面。" },
    { tool: "query_claim_cases", args: { caseNo: "可选", policyNo: "可选", insuredName: "可选", insuredIdNo: "可选" }, description: "在后台查询理赔案件，至少提供一个条件；案件号应使用 caseNo，返回可用于页面列表对象操作的 itemId、案件、人员及关联事件信息。" },
  ];
}

export function getAssistantControlToolCatalog() {
  return [
    { tool: "ask_user", args: { question: "需要向用户提出的问题", requestedFields: ["需要补充的字段ID"] }, description: "任务缺少系统无法查询且不能推断的必要信息时暂停执行并询问用户；用户回答后从原任务继续。" },
    { tool: "finish_task", args: { reason: "string" }, description: "任务已完成或当前无法继续时结束循环。" },
  ];
}

export function getAssistantRegistryToolCatalog() {
  return [
    ...getAssistantDiscoveryToolCatalog(),
    ...getAssistantActionToolCatalog(),
    ...getAssistantBackendToolCatalog(),
    ...getAssistantControlToolCatalog(),
  ];
}
