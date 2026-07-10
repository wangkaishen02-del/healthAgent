export type AssistantMenuId = "comprehensive_query" | "claim_processing";
export type RegisteredPageId = "policy_query" | "policy_detail" | "claim_query";

export type RegisteredField = {
  fieldId: string;
  label: string;
  type: "text" | "select";
  description: string;
  options?: Array<{ value: string; label: string }>;
};

export type RegisteredAction = {
  actionId: string;
  label: string;
  description: string;
  kind: "navigation" | "input" | "query" | "view";
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
      { pageId: "claim_query", label: "案件查询", description: "案件查询入口，当前仅提供页面占位。" },
    ],
  },
  {
    menuId: "claim_processing",
    label: "理赔处理",
    description: "承接理赔受理、案件检索、详情查看和理算结果联查。",
    pages: [{ pageId: "claim_query", label: "案件查询", description: "案件查询入口，当前仅提供页面占位。" }],
  },
];

const pages: PageRegistration[] = [
  {
    pageId: "policy_query",
    label: "保单信息查询",
    description: "查询保单基本信息、险种责任信息和被保人信息。",
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
          { actionId: "search", label: "查询", description: "按当前条件查询保单列表。", kind: "query" },
          { actionId: "reset", label: "重置", description: "清空所有保单查询条件。", kind: "input" },
        ],
      },
      {
        regionId: "policy_result_table",
        label: "保单结果列表",
        description: "展示符合条件的保单，支持查看详情、责任信息和被保人信息。",
        actions: [
          { actionId: "view_detail", label: "详细信息", description: "打开选中保单的基本信息。", kind: "view" },
          { actionId: "view_benefits", label: "责任信息", description: "打开选中保单的险种和责任列表。", kind: "view" },
          { actionId: "view_insureds", label: "被保人信息", description: "打开选中保单的被保人列表。", kind: "view" },
        ],
      },
    ],
  },
  {
    pageId: "policy_detail",
    label: "保单详细信息",
    description: "展示选中保单的基本信息、概览、险种责任和被保人信息。",
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
        description: "展示险种数、责任数和被保人数。",
      },
      {
        regionId: "policy_detail_tabs",
        label: "详情页签",
        description: "在保单基本信息、险种与责任、被保人清单之间切换。",
        actions: [
          { actionId: "view_detail", label: "基本信息", description: "查看保单基本信息和概览。", kind: "view" },
          { actionId: "view_benefits", label: "险种与责任", description: "查看险种和责任列表。", kind: "view" },
          { actionId: "view_insureds", label: "被保人清单", description: "查看被保人列表。", kind: "view" },
        ],
      },
    ],
  },
  {
    pageId: "claim_query",
    label: "案件查询",
    description: "案件查询页面当前为空白占位页，尚未注册可执行的查询动作。",
    menuId: "comprehensive_query",
    pagePath: ["综合查询", "案件查询"],
    regions: [],
  },
];

export function getNavigationRegistry() { return { menus }; }
export function getMenuPages(menuId: string) { return menus.find((menu) => menu.menuId === menuId) ?? null; }

export function getPageRegistration(pageId: string) {
  return pages.find((item) => item.pageId === pageId) ?? null;
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
  ];
}

export function getAssistantControlToolCatalog() {
  return [
    { tool: "finish_task", args: { reason: "string" }, description: "任务已完成或当前无法继续时结束循环。" },
  ];
}

export function getAssistantRegistryToolCatalog() {
  return [
    ...getAssistantDiscoveryToolCatalog(),
    ...getAssistantActionToolCatalog(),
    ...getAssistantControlToolCatalog(),
  ];
}
