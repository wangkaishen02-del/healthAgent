import { Body, Controller, Get, HttpException, Inject, Param, Post, Query } from "@nestjs/common";
import {
  getAssistantRegistryToolCatalog,
  getCompactPageRegistration,
  getMenuPages,
  getNavigationRegistry,
  getPageRegistration,
} from "../../../../src/assistant/page-registry.ts";
import { createAssistantPlan, type AssistantContinuationContext } from "../../../../src/assistant/plan-service.ts";
import {
  AssistantGraphService,
  type AssistantTaskResume,
} from "./assistant-graph.service.ts";

@Controller("assistant")
export class AssistantController {
  constructor(@Inject(AssistantGraphService) private readonly graphService: AssistantGraphService) {}

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

  @Post("tasks")
  async startTask(@Body() body: {
    taskId?: string;
    text?: string;
    provider?: unknown;
    context?: AssistantContinuationContext;
  } | null) {
    const text = body?.text?.trim();
    if (!text) throw new HttpException({ message: "text is required" }, 400);
    const provider = body?.provider;
    if (provider !== "ollama" && provider !== "deepseek") {
      throw new HttpException({ message: "unsupported_llm_provider" }, 400);
    }
    try {
      return await this.graphService.startTask({
        taskId: typeof body?.taskId === "string" && body.taskId.trim() ? body.taskId : undefined,
        text,
        provider,
        context: body?.context,
      });
    } catch (error) {
      throw this.toTaskException(error);
    }
  }

  @Post("tasks/:taskId/resume")
  async resumeTask(
    @Param("taskId") taskId: string,
    @Body() body: AssistantTaskResume | null,
  ) {
    if (!body || (body.type !== "page_result" && body.type !== "user_input")) {
      throw new HttpException({ message: "invalid_resume_payload" }, 400);
    }
    try {
      return await this.graphService.resumeTask(taskId, body);
    } catch (error) {
      throw this.toTaskException(error);
    }
  }

  @Post("tasks/:taskId/cancel")
  async cancelTask(@Param("taskId") taskId: string) {
    try {
      return await this.graphService.cancelTask(taskId);
    } catch (error) {
      throw this.toTaskException(error);
    }
  }

  @Get("tasks/:taskId")
  async task(@Param("taskId") taskId: string) {
    try {
      return await this.graphService.getTask(taskId);
    } catch (error) {
      throw this.toTaskException(error);
    }
  }

  private toTaskException(error: unknown) {
    const message = error instanceof Error ? error.message : "assistant_task_failed";
    const status = message === "assistant_task_not_found"
      ? 404
      : message === "assistant_task_cancelled"
        ? 409
        : message.endsWith("_required") || message === "assistant_task_already_exists"
          ? 400
          : 502;
    return new HttpException({ message }, status);
  }
}
