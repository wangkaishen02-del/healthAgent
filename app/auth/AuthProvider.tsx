"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import { setApiAccessToken } from "../../src/api/client";

export const APP_ROLES = ["claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer", "claim_admin"] as const;
export type AppRole = typeof APP_ROLES[number];

type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  roles: AppRole[];
};

type AuthContextValue = {
  user: AuthUser;
  hasAnyRole: (...roles: AppRole[]) => boolean;
  logout: () => Promise<void>;
};

const DEVELOPMENT_USER: AuthUser = {
  id: "default-user",
  username: "default-user",
  displayName: "默认用户",
  roles: [...APP_ROLES],
};

const AuthContext = createContext<AuthContextValue | null>(null);
const authEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED !== "false";

function accessTokenPayload(accessToken: string) {
  try {
    const encoded = accessToken.split(".")[1];
    if (!encoded) return {} as Record<string, unknown>;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(decodeURIComponent(Array.from(atob(padded), (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""))) as Record<string, unknown>;
  } catch {
    return {} as Record<string, unknown>;
  }
}

function rolesFromUser(user: User): AppRole[] {
  const token = accessTokenPayload(user.access_token);
  const realmAccess = token.realm_access as { roles?: unknown } | undefined;
  const resourceAccess = token.resource_access as Record<string, { roles?: unknown }> | undefined;
  const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "healthagent-web";
  const rawRoles = [
    ...(Array.isArray(realmAccess?.roles) ? realmAccess.roles : []),
    ...(Array.isArray(resourceAccess?.[clientId]?.roles) ? resourceAccess[clientId].roles as unknown[] : []),
  ];
  return [...new Set(rawRoles)]
    .filter((role): role is AppRole => typeof role === "string" && APP_ROLES.includes(role as AppRole));
}

function mapUser(user: User): AuthUser {
  return {
    id: user.profile.sub,
    username: typeof user.profile.preferred_username === "string" ? user.profile.preferred_username : user.profile.sub,
    displayName: typeof user.profile.name === "string" && user.profile.name.trim()
      ? user.profile.name
      : typeof user.profile.preferred_username === "string"
        ? user.profile.preferred_username
        : user.profile.sub,
    roles: rolesFromUser(user),
  };
}

function createManager() {
  return new UserManager({
    authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "http://127.0.0.1:18081/realms/healthagent",
    client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "healthagent-web",
    redirect_uri: window.location.origin,
    post_logout_redirect_uri: window.location.origin,
    response_type: "code",
    scope: "openid profile email",
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [manager, setManager] = useState<UserManager | null>(null);
  const [user, setUser] = useState<AuthUser | null>(authEnabled ? null : DEVELOPMENT_USER);
  const [loading, setLoading] = useState(authEnabled);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authEnabled) {
      setApiAccessToken(null);
      return;
    }
    const nextManager = createManager();
    setManager(nextManager);
    let active = true;

    async function applySession(session: User | null) {
      if (!active) return;
      if (!session || session.expired) {
        setApiAccessToken(null);
        setUser(null);
        return;
      }
      setApiAccessToken(session.access_token);
      setUser(mapUser(session));
    }

    async function initialize() {
      try {
        const hasCallback = new URLSearchParams(window.location.search).has("code")
          && new URLSearchParams(window.location.search).has("state");
        const session = hasCallback ? await nextManager.signinRedirectCallback() : await nextManager.getUser();
        if (hasCallback) window.history.replaceState({}, document.title, window.location.pathname);
        await applySession(session);
      } catch {
        setError("登录状态校验失败，请重新登录。");
      } finally {
        if (active) setLoading(false);
      }
    }

    nextManager.events.addUserLoaded(applySession);
    nextManager.events.addUserUnloaded(() => applySession(null));
    nextManager.events.addAccessTokenExpired(() => applySession(null));
    void initialize();
    return () => {
      active = false;
      nextManager.events.removeUserLoaded(applySession);
    };
  }, []);

  const login = useCallback(async () => {
    setError("");
    try {
      await manager?.signinRedirect();
    } catch {
      setError("无法连接登录服务，请确认 Keycloak 已启动。");
    }
  }, [manager]);

  const logout = useCallback(async () => {
    setApiAccessToken(null);
    setUser(null);
    await manager?.signoutRedirect();
  }, [manager]);

  const value = useMemo<AuthContextValue | null>(() => user ? {
    user,
    hasAnyRole: (...roles) => user.roles.includes("claim_admin") || roles.some((role) => user.roles.includes(role)),
    logout,
  } : null, [logout, user]);

  if (loading) return <main className="auth-screen"><section className="auth-card"><h1>healthAgent</h1><p>正在检查登录状态…</p></section></main>;
  if (!value) return (
    <main className="auth-screen">
      <section className="auth-card">
        <h1>healthAgent</h1>
        <p>请使用分配给你的账号登录理赔系统。</p>
        {error && <div className="auth-error">{error}</div>}
        <button type="button" onClick={() => void login()}>登录</button>
      </section>
    </main>
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
