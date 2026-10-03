const configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const API_BASE_URL = (configuredBaseUrl === undefined ? "http://127.0.0.1:3001" : configuredBaseUrl).replace(/\/$/, "");
let accessToken: string | null = null;

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

export function apiUrl(path: string) {
  if (!path.startsWith("/")) throw new Error("API path must start with /");
  return `${API_BASE_URL}${path}`;
}

export function apiFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(apiUrl(path), { ...init, headers });
}

export function recordAuditClick(action: "claim_search" | "claim_view" | "claim_transition_history_view", input?: { caseId?: string; description?: string }) {
  return apiFetch("/api/audit-logs/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...input }),
  }).catch(() => undefined);
}
