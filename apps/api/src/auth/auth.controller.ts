import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "./auth.decorators.ts";
import type { AuthenticatedUser } from "./auth.types.ts";

@Controller("auth")
export class AuthController {
  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
