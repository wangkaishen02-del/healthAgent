export type AssistantMenuId = "comprehensive_query" | "claim_processing" | "underwriting_config";
export type RegisteredPageId = "policy_query" | "policy_detail" | "claim_query" | "claim_registration" | "calculation_config";

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
    ],
  },
  {
    menuId: "underwriting_config",
    label: "理赔配置",
    description: "维护理赔和理算相关的业务配置。",
    pages: [{ pageId: "calculation_config", label: "保单理算配置", description: "按保单、保障计划、险种和责任维护理算参数。" }],
  },
];

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
          { fieldId: "status", label: "案件状态", type: "select", description: "按案件状态筛选；空值表示全部。", options: [{ value: "", label: "全部状态" }, { value: "registered", label: "受理中" }, { value: "processing", label: "处理中" }, { value: "completed", label: "已结案" }, { value: "cancelled", label: "已撤件" }] },
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
        description: "通过人员证件号查询其全部关联保单；唯一保单自动选择，多张保单由用户选择，并登记受理日期、渠道和备注。",
        fields: [
          { fieldId: "insuredIdNo", label: "被保人证件号", type: "text", description: "用于查询该人员全部关联保单的完整证件号码。" },
          { fieldId: "reportDate", label: "报案日期", type: "text", description: "格式为 YYYY-MM-DD；页面默认当前系统日期，用户未指定时无需覆盖。" },
          { fieldId: "reportChannel", label: "报案渠道", type: "select", description: "客户报案来源。", options: [{ value: "online", label: "线上报案" }, { value: "phone", label: "电话报案" }, { value: "counter", label: "柜面报案" }, { value: "other", label: "其他" }] },
          { fieldId: "remark", label: "立案备注", type: "textarea", description: "补充报案来源或特殊事项，可为空。" },
        ],
        actions: [
          { actionId: "lock_insured", label: "查询关联保单", description: "按证件号查询承保关系；唯一保单自动锁定，多张保单等待用户选择。", kind: "query", target: "page" },
          { actionId: "reset", label: "重置", description: "清空当前未提交的立案内容。", kind: "input", target: "page" },
        ],
      },
      {
        regionId: "claim_case_list",
        label: "受理中案件",
        description: "只展示受理中的案件；提交后转为处理中并进入录入与理算页面。",
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
          { fieldId: "eventTypeFilter", label: "事件类型筛选", type: "select", description: "筛选当前人员事件；all 表示全部。", options: [{ value: "all", label: "全部类型" }, { value: "disease", label: "疾病" }, { value: "accident", label: "意外" }, { value: "other", label: "其他" }] },
          { fieldId: "eventDateFilter", label: "事件日期筛选", type: "text", description: "按发生日期筛选当前人员事件，格式为 YYYY-MM-DD。" },
          { fieldId: "eventType", label: "事件类型", type: "select", description: "新增事件的类型。", options: [{ value: "disease", label: "疾病" }, { value: "accident", label: "意外" }, { value: "other", label: "其他" }] },
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
          { actionId: "save_case", label: "保存立案/保存修改", description: "新建状态显示“保存立案”并创建受理中案件；打开受理中案件后显示“保存修改”。新建立案成功后页面自动清空重置。", kind: "input", target: "page" },
          { actionId: "cancel_case", label: "撤件", description: "将当前受理中案件变更为已撤件。", kind: "input", target: "page" },
          { actionId: "submit_case", label: "提交", description: "将当前受理中案件提交为处理中，并转入录入与理算页面。", kind: "input", target: "page" },
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
