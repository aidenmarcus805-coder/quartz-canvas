import { invoke } from "@tauri-apps/api/core";

export type AuthUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  plan: string;
};

export type AuthSessionSnapshot = {
  authenticated: boolean;
  user?: AuthUser | null;
  updatedAt?: string | null;
};

export type AuthValidationResponse = {
  activated: boolean;
  error?: string | null;
  user?: AuthUser | null;
  session?: AuthSessionSnapshot | null;
};

export function getAuthSession(): Promise<AuthSessionSnapshot> {
  return invoke<AuthSessionSnapshot>("get_auth_session");
}

export function openAuthUrl(request: { url: string }): Promise<void> {
  return invoke<void>("open_auth_url", request);
}

export function signOutSession(): Promise<void> {
  return invoke<void>("sign_out");
}

export function verifyLicenseKey(request: { key: string }): Promise<AuthValidationResponse> {
  return invoke<AuthValidationResponse>("verify_license_key", request);
}
