import { Body, Controller, Get, HttpException, Post, Query } from "@nestjs/common";
import {
  getAssistantRegistryToolCatalog,
  getCompactPageRegistration,
  getMenuPages,
  getNavigationRegistry,
  getPageRegistration,
} from "../../../../src/assistant/page-registry.ts";
import { createAssistantPlan, type AssistantContinuationContext } from "../../../../src/assistant/plan-service.ts";

@Controller("assistant")
export class AssistantController {
  @Get("registry")
  registry(@Query() query: Record<string, string | undefined>) {
    const resource = query.resource ?? "navigation";
    if (resource === "tools") return { tools: getAssistantRegistryToolCatalog() };
    if (resource === "menu") return { menu: query.menuId ? getMenuPages(query.menuId) : null };
    if (resource === "page") return {
      page: query.pageId
        ? query.view === "compact"
          ? getCompactPageRegistration(query.pageId)
          : getPageRegistration(query.pageId)
        : null,
    };
    return getNavigationRegistry();
  }

  @Post("plan")
  async plan(@Body() body: { text?: string; provider?: unknown; context?: AssistantContinuationContext } | null) {
    const result = await createAssistantPlan(body);
    if (result.status !== 200) throw new HttpException(result.body, result.status);
    return result.body;
  }
}
