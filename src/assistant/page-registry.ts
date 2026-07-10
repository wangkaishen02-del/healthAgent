export type AssistantMenuId = "comprehensive_query" | "claim_processing";
export type RegisteredPageId = "policy_query" | "claim_query";

export type RegisteredField = {
  id: string;
  label: string;
  type: "text" | "select";
  description: string;
  options?: Array<{ value: string; label: string }>;
};

export type RegisteredAction = {
  id: string;
  label: string;
  description: string;
  kind: "navigation" | "input" | "query" | "view";
};

export type RegisteredRegion = {
  id: string;
  label: string;
  description: string;
  fields?: RegisteredField[];
  actions?: RegisteredAction[];
  children?: RegisteredRegion[];
};

export type MenuRegistration = {
  id: AssistantMenuId;
  label: string;
  description: string;
  pages: Array<{ pageId: RegisteredPageId; label: string; description: string }>;
};

export type PageRegistration = {
  pageId: RegisteredPageId;
  label: string;
  description: string;
  menuId: AssistantMenuId;
  regions: RegisteredRegion[];
};

const menus: MenuRegistration[] = [
  {
    id: "comprehensive_query",
    label: "综合查询",
    description: "查询承保和案件相关的业务信息。",
    pages: [
      { pageId: "policy_query", label: "保单信息查询", description: "按保单或被保人条件查询保单。" },
      { pageId: "claim_query", label: "案件查询", description: "案件查询入口，当前仅提供页面占位。" },
    ],
  },
  {
    id: "claim_processing",
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
    regions: [
      {
        id: "policy_search_form",
        label: "保单查询条件",
        description: "填写一个或多个条件后点击查询。",
        fields: [
          { id: "policyNo", label: "保单号", type: "text", description: "保单的业务编号。" },
          { id: "applicantName", label: "投保单位", type: "text", description: "团体投保单位名称。" },
          { id: "insuredName", label: "被保人姓名", type: "text", description: "被保人姓名，例如张三。" },
          { id: "insuredIdNo", label: "被保人证件号", type: "text", description: "被保人的身份证件号码。" },
          {
            id: "policyStatus",
            label: "保单状态",
            type: "select",
            description: "保单当前状态。",
            options: [{ value: "enabled", label: "启用" }, { value: "disabled", label: "停用" }],
          },
        ],
        actions: [
          { id: "search", label: "查询", description: "按当前条件查询保单列表。", kind: "query" },
          { id: "reset", label: "重置", description: "清空所有保单查询条件。", kind: "input" },
        ],
      },
      {
        id: "policy_result_table",
        label: "保单结果列表",
        description: "展示符合条件的保单，支持查看详情、责任信息和被保人信息。",
        actions: [
          { id: "view_detail", label: "详细信息", description: "打开选中保单的基本信息。", kind: "view" },
          { id: "view_benefits", label: "责任信息", description: "打开选中保单的险种和责任列表。", kind: "view" },
          { id: "view_insureds", label: "被保人信息", description: "打开选中保单的被保人列表。", kind: "view" },
        ],
      },
    ],
  },
  {
    pageId: "claim_query",
    label: "案件查询",
    description: "案件查询页面当前为空白占位页，尚未注册可执行的查询动作。",
    menuId: "comprehensive_query",
    regions: [],
  },
];

export function getNavigationRegistry() { return { menus }; }
export function getMenuPages(menuId: string) { return menus.find((menu) => menu.id === menuId) ?? null; }
export function getPageRegistration(pageId: string) { return pages.find((page) => page.pageId === pageId) ?? null; }
export function getAssistantDiscoveryToolCatalog() {
  return [
    { tool: "get_menu_pages", args: { menuId: "菜单注册ID" }, description: "根据菜单注册ID查询指定菜单下的页面。" },
    { tool: "get_page_registry", args: { pageId: "页面注册ID" }, description: "根据页面注册ID查询页面的区域、字段和动作注册信息。" },
  ];
}

export function getAssistantActionToolCatalog() {
  return [
    { tool: "open_page", args: { page: "页面注册ID" }, description: "打开已注册页面，参数填写页面注册ID。" },
    { tool: "set_field", args: { page: "页面注册ID", field: "字段注册ID", value: "字段值" }, description: "填写已注册的页面字段，参数填写页面和字段注册ID。" },
    { tool: "click_button", args: { page: "页面注册ID", button: "动作注册ID" }, description: "点击已注册的页面动作，参数填写页面和动作注册ID。" },
    { tool: "click_result_action", args: { page: "页面注册ID", action: "结果操作注册ID", row: "例如：1" }, description: "点击结果列表中已注册的行操作，row填写从1开始的数字，例如1表示第一行。" },
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
