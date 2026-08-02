export const APP_ROLES = [
  "claim_viewer",
  "claim_acceptor",
  "claim_calculator",
  "claim_reviewer",
  "claim_admin",
] as const;

export type AppRole = typeof APP_ROLES[number];

export type AuthenticatedUser = {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  roles: AppRole[];
};

export type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

export const DEVELOPMENT_USER: AuthenticatedUser = {
  id: "default-user",
  username: "default-user",
  displayName: "默认用户",
  roles: [...APP_ROLES],
};
