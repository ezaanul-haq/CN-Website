import { randomBytes } from "node:crypto";
import express, { Router, type IRouter } from "express";
import {
  CreateDriveFolderBody,
  GetAdminAuthStatusResponse,
  GetAdminCatalogueResponse,
  GetAdminVideoConfigResponse,
  GetCivilCatalogueQueryParams,
  GetCivilCatalogueResponse,
  GetCivilTopicParams,
  GetCivilTopicResponse,
  GetPublicVideoConfigResponse,
  LogoutAdminResponse,
  SaveAdminVideoConfigBody,
  SaveAdminVideoConfigResponse,
  UpdateDriveFileBody,
  UpdateDriveFileParams,
  UploadDrivePdfHeader,
  UploadDrivePdfQueryParams,
} from "@workspace/api-zod";
import {
  assertSameOrigin,
  clearAdminSession,
  consumeOAuthState,
  createOAuthState,
  getAdminStatus,
  getMissingLoginConfiguration,
  isAllowedAdminEmail,
  requireAdmin,
  setAdminSession,
  ApiError,
} from "../lib/civil-auth";
import {
  createFolder,
  getAdminCatalogue,
  getAdminVideoConfiguration,
  getPublicCatalogue,
  getPublicVideoConfiguration,
  getTopicDetail,
  invalidateDriveCaches,
  isPdfMimeType,
  saveAdminVideoConfiguration,
  trashPdf,
  updatePdf,
  uploadPdf,
} from "../lib/civil-drive";

const router: IRouter = Router();

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function oauthSetupError(response: express.Response, value: string): void {
  response.redirect(`/admin?auth=${encodeURIComponent(value)}`);
}

router.get("/civil/catalogue", async (request, response) => {
  const query = GetCivilCatalogueQueryParams.safeParse(request.query);
  if (!query.success) {
    throw new ApiError(400, "The catalogue search or page settings are invalid.");
  }
  const result = await getPublicCatalogue(query.data);
  response.json(GetCivilCatalogueResponse.parse(result));
});

router.get("/civil/topics/:topicId", async (request, response) => {
  const params = GetCivilTopicParams.safeParse(request.params);
  if (!params.success) throw new ApiError(400, "A valid topic ID is required.");
  const result = await getTopicDetail(params.data.topicId);
  response.json(GetCivilTopicResponse.parse(result));
});

router.get("/civil/videos/config", async (_request, response) => {
  const result = await getPublicVideoConfiguration();
  response.setHeader("Cache-Control", "public, max-age=30");
  response.json(GetPublicVideoConfigResponse.parse(result));
});

router.get("/civil/admin/auth/status", (request, response) => {
  response.setHeader("Cache-Control", "private, no-store");
  response.json(GetAdminAuthStatusResponse.parse(getAdminStatus(request)));
});

router.get("/civil/admin/auth/google", (request, response) => {
  const missing = getMissingLoginConfiguration();
  if (missing.length > 0) {
    response.status(503).json({
      error: `Administrator Google sign-in is not configured. Add ${missing.join(", ")} on the server.`,
    });
    return;
  }
  const state = createOAuthState(response);
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    response_type: "code",
    scope: "openid email",
    state,
    access_type: "online",
    prompt: "select_account",
  }).toString();
  response.redirect(authorizationUrl.toString());
  request.log?.info({ route: "civil-admin-google-auth" }, "Started admin sign-in");
});

router.get("/civil/admin/auth/callback", async (request, response) => {
  const state = getString(request.query.state);
  if (!consumeOAuthState(request, response, state)) {
    oauthSetupError(response, "invalid-state");
    return;
  }
  const code = getString(request.query.code);
  if (!code || getString(request.query.error)) {
    oauthSetupError(response, "cancelled");
    return;
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
      grant_type: "authorization_code",
      code,
    }),
  });
  const tokenBody = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
  };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    oauthSetupError(response, "google-sign-in-failed");
    return;
  }

  const profileResponse = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { authorization: `Bearer ${tokenBody.access_token}` } },
  );
  const profile = (await profileResponse.json().catch(() => ({}))) as {
    email?: string;
    email_verified?: boolean;
  };
  if (
    !profileResponse.ok ||
    !profile.email ||
    profile.email_verified !== true
  ) {
    oauthSetupError(response, "google-email-unverified");
    return;
  }
  if (!isAllowedAdminEmail(profile.email)) {
    oauthSetupError(response, "not-authorized");
    return;
  }

  setAdminSession(response, profile.email);
  response.redirect("/admin?auth=success");
});

router.post("/civil/admin/auth/logout", (request, response) => {
  assertSameOrigin(request);
  clearAdminSession(response);
  response.json(
    LogoutAdminResponse.parse({
      authenticated: false,
      configured: getAdminStatus(request).configured,
      email: null,
      reason: null,
    }),
  );
});

router.get("/civil/admin/catalogue", async (request, response) => {
  requireAdmin(request);
  const result = await getAdminCatalogue();
  response.setHeader("Cache-Control", "private, no-store");
  response.json(GetAdminCatalogueResponse.parse(result));
});

router.post("/civil/admin/folders", async (request, response) => {
  requireAdmin(request);
  assertSameOrigin(request);
  const parsed = CreateDriveFolderBody.safeParse(request.body);
  if (!parsed.success) {
    throw new ApiError(400, "Enter a folder name and choose a parent folder.");
  }
  const folder = await createFolder(parsed.data);
  response.status(201).json(folder);
});

router.post(
  "/civil/admin/files",
  express.raw({ type: "application/pdf", limit: "25mb" }),
  async (request, response) => {
    requireAdmin(request);
    assertSameOrigin(request);
    const query = UploadDrivePdfQueryParams.safeParse(request.query);
    const header = UploadDrivePdfHeader.safeParse({
      "X-File-Name": request.get("X-File-Name"),
    });
    if (!query.success || !header.success) {
      throw new ApiError(400, "Choose a destination folder and a PDF filename.");
    }
    if (!isPdfMimeType(request.get("content-type")?.split(";")[0].trim())) {
      throw new ApiError(415, "Only PDF uploads are accepted.");
    }
    let fileName: string;
    try {
      fileName = decodeURIComponent(header.data["X-File-Name"]);
    } catch {
      throw new ApiError(400, "The PDF filename is not valid URL encoding.");
    }
    const uploaded = await uploadPdf(
      query.data.parentId,
      fileName,
      request.body as Buffer,
    );
    invalidateDriveCaches();
    const adminCatalogue = await getAdminCatalogue();
    const noteFile = adminCatalogue.files.find((file) => file.id === uploaded.id);
    if (!noteFile) {
      throw new ApiError(
        502,
        "The PDF reached Drive but could not be indexed under a semester and subject. Move it into a subject folder in the MANUU notes tree.",
      );
    }
    response.status(201).json(noteFile);
  },
);

router.patch("/civil/admin/files/:fileId", async (request, response) => {
  requireAdmin(request);
  assertSameOrigin(request);
  const params = UpdateDriveFileParams.safeParse(request.params);
  const body = UpdateDriveFileBody.safeParse(request.body);
  if (!params.success || !body.success) {
    throw new ApiError(400, "The file ID, new name, or destination folder is invalid.");
  }
  const result = await updatePdf(params.data.fileId, body.data);
  response.json(result);
});

router.delete("/civil/admin/files/:fileId", async (request, response) => {
  requireAdmin(request);
  assertSameOrigin(request);
  const params = UpdateDriveFileParams.safeParse(request.params);
  if (!params.success) throw new ApiError(400, "A valid file ID is required.");
  const result = await trashPdf(params.data.fileId);
  response.json(result);
});

router.get("/civil/admin/videos/config", async (request, response) => {
  requireAdmin(request);
  const result = await getAdminVideoConfiguration();
  response.setHeader("Cache-Control", "private, no-store");
  response.json(GetAdminVideoConfigResponse.parse(result));
});

router.put("/civil/admin/videos/config", async (request, response) => {
  requireAdmin(request);
  assertSameOrigin(request);
  const parsed = SaveAdminVideoConfigBody.safeParse(request.body);
  if (!parsed.success) {
    throw new ApiError(400, "The video configuration JSON is invalid.");
  }
  const result = await saveAdminVideoConfiguration(parsed.data);
  response.json(SaveAdminVideoConfigResponse.parse(result));
});

export default router;
