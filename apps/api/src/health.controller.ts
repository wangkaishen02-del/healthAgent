import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/auth.decorators.ts";

@Controller("health")
export class HealthController {
  @Get()
  @Public()
  health() {
    return { status: "ok", service: "health-agent-api", framework: "nestjs" };
  }
}
