import type { MenuRegistration, RegisteredPageId } from "./page-registry.ts";

export type AssistantRole = "claim_viewer" | "claim_acceptor" | "claim_calculator" | "claim_reviewer" | "claim_admin";

const PAGE_ROLES: Record<RegisteredPageId, AssistantRole[]> = {
  policy_query: ["claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer"],
  policy_detail: ["claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer"],
  claim_query: ["claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer"],
  claim_registration: ["claim_acceptor"],
  claim_entry_calculation: ["claim_calculator"],
  claim_review_completion: ["claim_reviewer"],
  calculation_config: ["claim_admin"],
  standard_formula_management: ["claim_admin"],
};

export function canAccessAssistantPage(pageId: string, roles: readonly string[] = []) {
  const required = PAGE_ROLES[pageId as RegisteredPageId];
  if (!required) return false;
  return roles.includes("claim_admin") || required.some((role) => roles.includes(role));
}

export function filterAssistantMenus(menus: MenuRegistration[], roles: readonly string[] = []) {
  return menus
    .map((menu) => ({ ...menu, pages: menu.pages.filter((page) => canAccessAssistantPage(page.pageId, roles)) }))
    .filter((menu) => menu.pages.length > 0);
}
