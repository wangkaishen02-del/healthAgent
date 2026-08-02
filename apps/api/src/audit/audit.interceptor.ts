import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { catchError, Observable, tap, throwError } from "rxjs";
import { AuditService } from "./audit.service.ts";
import type { AuthenticatedUser } from "../auth/auth.types.ts";

type AuditRequest = {
  method: string;
  originalUrl?: string;
  url?: string;
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  user?: AuthenticatedUser;
};

type AuditResponse = { statusCode: number; setHeader(name: string, value: string): void };

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RESOURCE_ID_KEYS = ["claimCaseId", "caseId", "policyId", "uploadId", "id"];

function resourceId(request: AuditRequest) {
  for (const key of RESOURCE_ID_KEYS) {
    const value = request.params?.[key] ?? request.body?.[key];
    if (typeof value === "string" && value.trim()) return value.slice(0, 100);
  }
  return undefined;
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "unknown_error";
  const response = (error as { response?: unknown }).response;
  if (typeof response === "string") return response.slice(0, 100);
  if (response && typeof response === "object") {
    const message = (response as { message?: unknown }).message;
    if (typeof message === "string") return message.slice(0, 100);
  }
  return error instanceof Error ? error.name.slice(0, 100) : "unknown_error";
}

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(AuditService) private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditRequest>();
    const response = context.switchToHttp().getResponse<AuditResponse>();
    if (request.user) void this.auditService.observeUser(request.user);
    if (!request.user || !MUTATION_METHODS.has(request.method)) return next.handle();

    const path = (request.originalUrl ?? request.url ?? "unknown").split("?", 1)[0];
    const requestIdHeader = request.headers["x-request-id"];
    const requestId = (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) || randomUUID();
    response.setHeader("X-Request-Id", requestId);
    const base = {
      user: request.user,
      method: request.method,
      path,
      resourceType: path.replace(/^\/api\//, "").split("/", 1)[0] || "unknown",
      resourceId: resourceId(request),
      requestId,
      ipAddress: request.ip,
      userAgent: Array.isArray(request.headers["user-agent"])
        ? request.headers["user-agent"]?.[0]
        : request.headers["user-agent"],
    };
    return next.handle().pipe(
      tap(() => void this.auditService.record({ ...base, outcome: "success", statusCode: response.statusCode }).catch(() => undefined)),
      catchError((error: unknown) => {
        const statusCode = typeof (error as { status?: unknown })?.status === "number"
          ? (error as { status: number }).status
          : response.statusCode >= 400
            ? response.statusCode
            : 500;
        void this.auditService.record({ ...base, outcome: "failure", statusCode, errorCode: errorCode(error) }).catch(() => undefined);
        return throwError(() => error);
      }),
    );
  }
}
