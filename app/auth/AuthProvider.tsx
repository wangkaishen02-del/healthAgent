"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import { setApiAccessToken } from "../../src/api/client";

export const APP_ROLES = ["claim_viewer", "claim_acceptor", "claim_calculator", "claim_reviewer", "claim_admin"] as const;
export type AppRole = typeof APP_ROLES[number];

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  claim_viewer: "查询人员",
  claim_acceptor: "受理人员",
  claim_calculator: "理算人员",
  claim_reviewer: "审核人员",
  claim_admin: "系统管理员",
};

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

  if (loading) return (
    <main className="auth-screen">
      <section className="auth-card auth-card-loading" aria-live="polite">
        <div className="auth-brand-mark" aria-hidden="true"><span>hA</span></div>
        <div className="auth-loading-ring" aria-hidden="true" />
        <h1>正在进入 healthAgent</h1>
        <p>正在安全校验登录状态，请稍候…</p>
      </section>
    </main>
  );
  if (!value) return (
    <main className="auth-screen">
      <div className="auth-shell">
        <section className="auth-intro" aria-label="平台介绍">
          <div className="auth-brand">
            <div className="auth-brand-mark" aria-hidden="true"><span>hA</span></div>
            <div><strong>healthAgent</strong><small>团体健康险理赔平台</small></div>
          </div>
          <div className="auth-intro-copy">
            <span className="auth-eyebrow">智能 · 准确 · 可追溯</span>
            <h1>让每一次理赔处理<br />更清晰、更高效</h1>
            <p>统一管理案件受理、资料录入、自动理算与审核结案，Agent 全程协助业务人员完成工作。</p>
          </div>
          <div className="auth-feature-list" aria-label="平台能力">
            <span><i aria-hidden="true">01</i>案件全流程管理</span>
            <span><i aria-hidden="true">02</i>智能 OCR 与理算</span>
            <span><i aria-hidden="true">03</i>操作全程留痕</span>
          </div>
          <div className="auth-orbit auth-orbit-one" aria-hidden="true" />
          <div className="auth-orbit auth-orbit-two" aria-hidden="true" />
        </section>
        <section className="auth-card">
          <div className="auth-mobile-brand">
            <div className="auth-brand-mark" aria-hidden="true"><span>hA</span></div>
            <strong>healthAgent</strong>
          </div>
          <span className="auth-card-kicker">欢迎回来</span>
          <h2>登录理赔工作台</h2>
          <p>使用企业统一身份认证账号安全登录。</p>
          {error && <div className="auth-error" role="alert"><strong>登录遇到问题</strong><span>{error}</span></div>}
          <button className="auth-login-button" type="button" onClick={() => void login()}>
            <span className="auth-login-icon" aria-hidden="true">→</span>
            使用统一身份认证登录
          </button>
          <div className="auth-security-note"><span aria-hidden="true">✓</span>由 Keycloak 提供安全身份认证</div>
          <small className="auth-help">如无法登录，请联系系统管理员确认账号与角色权限。</small>
        </section>
      </div>
      <footer className="auth-footer">© 2026 healthAgent · 企业级团体健康险理赔平台</footer>
    </main>
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
