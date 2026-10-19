import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";

const SESSION_COOKIE = "manuu_admin_session";
const OAUTH_STATE_COOKIE = "manuu_oauth_state";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 12;
const OAUTH_STATE_LIFETIME_SECONDS = 10 * 60;

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getSecret(): string | undefined {
  return process.env.SESSION_SECRET;
}

function getAllowedAdminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getMissingConfiguration(): string[] {
  const required = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_DRIVE_ROOT_FOLDER_ID",
    "ADMIN_EMAILS",
    "SESSION_SECRET",
  ];
  return required.filter((key) => !process.env[key]?.trim());
}

export function isApplicationConfigured(): boolean {
  return getMissingConfiguration().length === 0;
}

export function getMissingLoginConfiguration(): string[] {
  return [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "ADMIN_EMAILS",
    "SESSION_SECRET",
  ].filter((key) => !process.env[key]?.trim());
}

export function getMissingDriveConfiguration(): string[] {
  return ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_DRIVE_ROOT_FOLDER_ID"].filter(
    (key) => !process.env[key]?.trim(),
  );
}

export function isAllowedAdminEmail(email: string): boolean {
  return getAllowedAdminEmails().has(email.trim().toLowerCase());
}

function sign(value: string): string {
  const secret = getSecret();
  if (!secret) {
    throw new ApiError(503, "Administrator sign-in is not configured.");
  }
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.cookie?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    if (cookie.slice(0, separator).trim() === name) {
      return decodeURIComponent(cookie.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export function getAdminEmail(request: Request): string | null {
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return null;

  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;

  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { email?: unknown; expiresAt?: unknown };
    if (
      typeof session.email !== "string" ||
      typeof session.expiresAt !== "number" ||
      session.expiresAt <= Date.now()
    ) {
      return null;
    }
    const email = session.email.toLowerCase();
    return getAllowedAdminEmails().has(email) ? email : null;
  } catch {
    return null;
  }
}

export function requireAdmin(request: Request): string {
  const email = getAdminEmail(request);
  if (!email) {
    throw new ApiError(401, "Administrator sign-in is required.");
  }
  return email;
}

export function setAdminSession(response: Response, email: string): void {
  const payload = Buffer.from(
    JSON.stringify({
      email: email.toLowerCase(),
      expiresAt: Date.now() + SESSION_LIFETIME_SECONDS * 1000,
      nonce: randomBytes(12).toString("base64url"),
    }),
  ).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}${secure}`,
  );
}

export function clearAdminSession(response: Response): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export function createOAuthState(response: Response): string {
  const state = randomBytes(32).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    state,
    expiresAt: Date.now() + OAUTH_STATE_LIFETIME_SECONDS * 1000,
  })).toString("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.append(
    "Set-Cookie",
    `${OAUTH_STATE_COOKIE}=${payload}.${sign(payload)}; Path=/api/civil/admin/auth/callback; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_STATE_LIFETIME_SECONDS}${secure}`,
  );
  return state;
}

export function consumeOAuthState(
  request: Request,
  response: Response,
  returnedState: string | undefined,
): boolean {
  const value = readCookie(request, OAUTH_STATE_COOKIE);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.append(
    "Set-Cookie",
    `${OAUTH_STATE_COOKIE}=; Path=/api/civil/admin/auth/callback; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
  if (!value || !returnedState) return false;

  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return false;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return false;
  }
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return false;
  }
  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      state?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof state.state !== "string" ||
      typeof state.expiresAt !== "number" ||
      state.expiresAt <= Date.now()
    ) return false;
    const expectedState = Buffer.from(state.state);
    const suppliedState = Buffer.from(returnedState);
    return expectedState.length === suppliedState.length &&
      timingSafeEqual(expectedState, suppliedState);
  } catch {
    return false;
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.get("origin");
  if (!origin) {
    throw new ApiError(403, "This request must come from the MANUU Notes website.");
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "The request origin is invalid.");
  }
  const forwardedHost = request.get("x-forwarded-host")?.split(",")[0]?.trim();
  const expectedHost = forwardedHost || request.get("host");
  if (!expectedHost || originHost !== expectedHost) {
    throw new ApiError(403, "Cross-site administrator requests are blocked.");
  }
}

export function getAdminStatus(request: Request) {
  const missing = getMissingConfiguration();
  const email = getAdminEmail(request);
  return {
    authenticated: email !== null,
    configured: missing.length === 0,
    email,
    reason:
      missing.length > 0
        ? `Finish server setup by adding: ${missing.join(", ")}.`
        : null,
  };
}
