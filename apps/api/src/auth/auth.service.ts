import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { APP_ROLES, type AppRole, type AuthenticatedUser } from "./auth.types.ts";

type KeycloakPayload = JWTPayload & {
  preferred_username?: unknown;
  name?: unknown;
  email?: unknown;
  realm_access?: { roles?: unknown };
  resource_access?: Record<string, { roles?: unknown }>;
};

@Injectable()
export class AuthService {
  readonly enabled = process.env.AUTH_ENABLED !== "false";
  private readonly issuer = process.env.KEYCLOAK_ISSUER ?? "http://127.0.0.1:18081/realms/healthagent";
  private readonly jwksUrl = process.env.KEYCLOAK_JWKS_URL ?? `${this.issuer}/protocol/openid-connect/certs`;
  private readonly audience = process.env.KEYCLOAK_AUDIENCE ?? "healthagent-api";
  private readonly webClientId = process.env.KEYCLOAK_WEB_CLIENT_ID ?? "healthagent-web";
  private readonly jwks = createRemoteJWKSet(new URL(this.jwksUrl));

  async verifyAuthorizationHeader(header: string | undefined): Promise<AuthenticatedUser> {
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("bearer_token_required");
    const token = header.slice("Bearer ".length).trim();
    if (!token) throw new UnauthorizedException("bearer_token_required");

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["RS256"],
      });
      return this.toUser(payload as KeycloakPayload);
    } catch {
      throw new UnauthorizedException("invalid_or_expired_token");
    }
  }

  private toUser(payload: KeycloakPayload): AuthenticatedUser {
    if (typeof payload.sub !== "string" || !payload.sub) throw new UnauthorizedException("token_subject_missing");
    const rawRealmRoles: unknown = payload.realm_access?.roles;
    const rawClientRoles: unknown = payload.resource_access?.[this.webClientId]?.roles;
    const realmRoles: unknown[] = Array.isArray(rawRealmRoles) ? rawRealmRoles : [];
    const clientRoles: unknown[] = Array.isArray(rawClientRoles) ? rawClientRoles : [];
    const roles = [...new Set([...realmRoles, ...clientRoles])]
      .filter((role): role is AppRole => typeof role === "string" && APP_ROLES.includes(role as AppRole));
    return {
      id: payload.sub,
      username: typeof payload.preferred_username === "string" ? payload.preferred_username : payload.sub,
      displayName: typeof payload.name === "string" && payload.name.trim()
        ? payload.name
        : typeof payload.preferred_username === "string"
          ? payload.preferred_username
          : payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      roles,
    };
  }
}
