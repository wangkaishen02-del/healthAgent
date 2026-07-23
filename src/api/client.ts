const configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const API_BASE_URL = (configuredBaseUrl === undefined ? "http://127.0.0.1:3001" : configuredBaseUrl).replace(/\/$/, "");

export function apiUrl(path: string) {
  if (!path.startsWith("/")) throw new Error("API path must start with /");
  return `${API_BASE_URL}${path}`;
}

export function apiFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), init);
}
