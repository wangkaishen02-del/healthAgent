import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "./auth.service.ts";
import { IS_PUBLIC_KEY, ROLES_KEY } from "./auth.decorators.ts";
import { DEVELOPMENT_USER, type AppRole, type AuthenticatedRequest } from "./auth.types.ts";

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest & { headers: { authorization?: string } }>();
    request.user = this.authService.enabled
      ? await this.authService.verifyAuthorizationHeader(request.headers.authorization)
      : DEVELOPMENT_USER;
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const roles = request.user?.roles ?? [];
    if (roles.includes("claim_admin") || required.some((role) => roles.includes(role))) return true;
    throw new ForbiddenException("insufficient_role");
  }
}
