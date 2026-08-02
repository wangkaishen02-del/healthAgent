import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { AppRole, AuthenticatedRequest, AuthenticatedUser } from "./auth.types.ts";

export const IS_PUBLIC_KEY = "healthagent:is-public";
export const ROLES_KEY = "healthagent:roles";

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) throw new Error("authenticated_user_missing");
  return request.user;
});
