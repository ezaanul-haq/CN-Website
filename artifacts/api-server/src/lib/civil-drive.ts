import { createSign } from "node:crypto";
import {
  GetAdminVideoConfigResponse,
  SaveAdminVideoConfigBody,
  type AdminCatalogue,
  type CataloguePage,
  type NoteFile,
  type SemesterSummary,
  type TopicDetail,
  type TopicSummary,
  type TopicVideo,
  type VideoConfiguration,
} from "@workspace/api-zod";
import { ApiError, getMissingDriveConfiguration } from "./civil-auth";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const VIDEO_CONFIG_NAME = "MANUU_VIDEO_RESOURCES.json";
const CATALOGUE_CACHE_MS = 45_000;
const VIDEO_CONFIG_CACHE_MS = 30_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

type DrivePermission = {
  type?: string;
  role?: string;
  domain?: string;
};

type DriveRawFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  thumbnailLink?: string;
  parents?: string[];
  permissions?: DrivePermission[];
  trashed?: boolean;
};

type DriveFolder = {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  isPublic: boolean;
};

type DriveIndex = {
  rootFolderId: string;
  rootFolderName: string;
  folders: DriveFolder[];
  files: NoteFile[];
  semesters: SemesterSummary[];
  topics: TopicSummary[];
  topicLocation: Map<
    string,
    { semesterId: string; subjectId: string; unitId: string | null }
  >;
  semesterIds: Set<string>;
  subjectParents: Map<string, string>;
  unitParents: Map<string, string>;
};

type ServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type Cached<T> = {
  value: T;
  expiresAt: number;
};

let serviceToken: Cached<string> | null = null;
let driveIndexCache: Cached<DriveIndex> | null = null;
let videoConfigCache: Cached<VideoConfiguration> | null = null;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ApiError(503, `Google Drive setup is missing ${name}.`);
  return value;
}

function getServiceAccount(): ServiceAccountCredentials {
  const raw = requiredEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  try {
    const account = JSON.parse(raw) as Partial<ServiceAccountCredentials>;
    if (!account.client_email || !account.private_key) throw new Error();
    return {
      client_email: account.client_email,
      private_key: account.private_key.replace(/\\n/g, "\n"),
      token_uri: account.token_uri,
    };
  } catch {
    throw new ApiError(
      503,
      "GOOGLE_SERVICE_ACCOUNT_JSON is not a valid service-account credential file.",
    );
  }
}

export function getDriveSetupMessage(): string | null {
  const missing = getMissingDriveConfiguration();
  return missing.length > 0
    ? `Google Drive is not connected yet. Add ${missing.join(", ")} to the server environment.`
    : null;
}

async function getServiceAccessToken(): Promise<string> {
  if (serviceToken && serviceToken.expiresAt > Date.now() + 60_000) {
    return serviceToken.value;
  }

  const account = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" }),
  ).toString("base64url");
  const jwtPayload = Buffer.from(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: account.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  ).toString("base64url");
  const unsignedJwt = `${jwtHeader}.${jwtPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const assertion = `${unsignedJwt}.${signer.sign(account.private_key, "base64url")}`;
  const response = await fetch(
    account.token_uri || "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !body.access_token) {
    throw new ApiError(
      502,
      "Google Drive authorization failed. Check the service-account key and Drive API setup.",
    );
  }

  serviceToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return serviceToken.value;
}

function driveErrorMessage(status: number, googleMessage: string): string {
  if (status === 401 || status === 403) {
    return "The Google service account cannot access this Drive folder. Share the MANUU notes folder with its service-account email as an Editor.";
  }
  if (status === 404) {
    return "The configured Google Drive root folder was not found. Check GOOGLE_DRIVE_ROOT_FOLDER_ID and share that folder with the service account.";
  }
  if (status === 429) {
    return "Google Drive is receiving too many requests. Please wait a moment and try again.";
  }
  if (status >= 500) {
    return "Google Drive is temporarily unavailable. Please try again shortly.";
  }
  return googleMessage || "Google Drive request failed.";
}

async function driveFetch(
  url: string,
  init: RequestInit = {},
  retryTransient = false,
): Promise<Response> {
  const attempts = retryTransient ? 4 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const token = await getServiceAccessToken();
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      });
    } catch {
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      throw new ApiError(502, "Could not reach Google Drive. Please try again.");
    }

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt + 1 < attempts
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      throw new ApiError(
        response.status === 404 ? 404 : response.status === 429 ? 429 : 502,
        driveErrorMessage(response.status, body.error?.message ?? ""),
      );
    }
    return response;
  }
  throw new ApiError(502, "Google Drive did not respond after several attempts.");
}

async function driveJson<T>(
  url: string,
  init: RequestInit = {},
  retryTransient = false,
): Promise<T> {
  const response = await driveFetch(url, init, retryTransient);
  return (await response.json()) as T;
}

function isStudentReadable(
  permissions: DrivePermission[] | undefined,
  inherited: boolean,
): boolean {
  if (inherited) return true;
  const domain = process.env.GOOGLE_DRIVE_STUDENT_DOMAIN?.trim().toLowerCase();
  return (permissions ?? []).some((permission) => {
    if (permission.role !== "reader") return false;
    if (permission.type === "anyone") return true;
    return (
      permission.type === "domain" &&
      Boolean(domain) &&
      permission.domain?.toLowerCase() === domain
    );
  });
}

function qString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function listChildren(parentId: string): Promise<DriveRawFile[]> {
  const all: DriveRawFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `${qString(parentId)} in parents and trashed = false`,
      pageSize: "1000",
      orderBy: "name",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      fields:
        "nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,webContentLink,thumbnailLink,parents,permissions(type,role,domain),trashed)",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await driveJson<{
      files?: DriveRawFile[];
      nextPageToken?: string;
    }>(`${DRIVE_API}/files?${params.toString()}`, {}, true);
    all.push(...(result.files ?? []));
    pageToken = result.nextPageToken;
  } while (pageToken);
  return all;
}

function naturalSort<T extends { name: string }>(items: T[]): T[] {
  return items.sort((a, b) =>
    a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" }),
  );
}

function classifyFile(name: string): NoteFile["category"] {
  return /\b(pyq|question|practice|assignment|exercise|question\s*paper)\b/i.test(
    name,
  )
    ? "practice"
    : "notes";
}

function publicDriveLink(id: string, original?: string): string | null {
  return original || `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}

function getPath(folderId: string, parents: Map<string, DriveFolder>): DriveFolder[] {
  const path: DriveFolder[] = [];
  let current = parents.get(folderId);
  while (current && current.depth > 0) {
    path.unshift(current);
    current = current.parentId ? parents.get(current.parentId) : undefined;
  }
  return path;
}

function makeDriveIndex(
  root: DriveRawFile,
  rawItems: DriveRawFile[],
): DriveIndex {
  const foldersById = new Map<string, DriveFolder>();
  const childrenByParent = new Map<string, DriveRawFile[]>();
  const rootPublic = isStudentReadable(root.permissions, false);
  foldersById.set(root.id, {
    id: root.id,
    name: root.name,
    parentId: null,
    depth: 0,
    isPublic: rootPublic,
  });

  for (const item of rawItems) {
    const parentId = item.parents?.[0] ?? root.id;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(parentId, siblings);
  }

  const ordered: DriveRawFile[] = [];
  const queue: Array<{ id: string; depth: number; inheritedPublic: boolean }> = [
    { id: root.id, depth: 0, inheritedPublic: rootPublic },
  ];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const item of naturalSort(childrenByParent.get(parent.id) ?? [])) {
      if (item.mimeType === DRIVE_FOLDER_MIME) {
        const isPublic = isStudentReadable(item.permissions, parent.inheritedPublic);
        foldersById.set(item.id, {
          id: item.id,
          name: item.name,
          parentId: parent.id,
          depth: parent.depth + 1,
          isPublic,
        });
        ordered.push(item);
        queue.push({
          id: item.id,
          depth: parent.depth + 1,
          inheritedPublic: isPublic,
        });
      } else {
        ordered.push(item);
      }
    }
  }

  const folders = [...foldersById.values()];
  const folderMap = foldersById;
  const semesterFolders = naturalSort(
    folders.filter((folder) => folder.depth === 1),
  );
  const semesters: SemesterSummary[] = [];
  const topics: TopicSummary[] = [];
  const topicLocation = new Map<
    string,
    { semesterId: string; subjectId: string; unitId: string | null }
  >();
  const semesterIds = new Set<string>();
  const subjectParents = new Map<string, string>();
  const unitParents = new Map<string, string>();

  for (const semesterFolder of semesterFolders) {
    semesterIds.add(semesterFolder.id);
    const subjectFolders = naturalSort(
      folders.filter(
        (folder) =>
          folder.depth === 2 && folder.parentId === semesterFolder.id,
      ),
    );
    const subjects = subjectFolders.map((subjectFolder) => {
      subjectParents.set(subjectFolder.id, semesterFolder.id);
      const childFolders = naturalSort(
        folders.filter(
          (folder) =>
            folder.depth === 3 && folder.parentId === subjectFolder.id,
        ),
      );
      const subjectTopics: TopicSummary[] = [];

      for (const child of childFolders) {
        const nested = naturalSort(
          folders.filter((folder) => folder.parentId === child.id),
        );
        const isUnit =
          /^(unit|module)\b/i.test(child.name) || nested.length > 0;
        if (isUnit) {
          unitParents.set(child.id, subjectFolder.id);
          const topicFolders = nested;
          if (topicFolders.length === 0) {
            const topicId = `general-${child.id}`;
            const topic: TopicSummary = {
              id: topicId,
              name: "General resources",
              semesterId: semesterFolder.id,
              semesterName: semesterFolder.name,
              subjectId: subjectFolder.id,
              subjectName: subjectFolder.name,
              unitId: child.id,
              unitName: child.name,
              fileCount: 0,
            };
            subjectTopics.push(topic);
            topicLocation.set(topicId, {
              semesterId: semesterFolder.id,
              subjectId: subjectFolder.id,
              unitId: child.id,
            });
          } else {
            for (const topicFolder of topicFolders) {
              const topic: TopicSummary = {
                id: topicFolder.id,
                name: topicFolder.name,
                semesterId: semesterFolder.id,
                semesterName: semesterFolder.name,
                subjectId: subjectFolder.id,
                subjectName: subjectFolder.name,
                unitId: child.id,
                unitName: child.name,
                fileCount: 0,
              };
              subjectTopics.push(topic);
              topics.push(topic);
              topicLocation.set(topic.id, {
                semesterId: semesterFolder.id,
                subjectId: subjectFolder.id,
                unitId: child.id,
              });
            }
          }
        } else {
          const topic: TopicSummary = {
            id: child.id,
            name: child.name,
            semesterId: semesterFolder.id,
            semesterName: semesterFolder.name,
            subjectId: subjectFolder.id,
            subjectName: subjectFolder.name,
            unitId: null,
            unitName: null,
            fileCount: 0,
          };
          subjectTopics.push(topic);
          topics.push(topic);
          topicLocation.set(topic.id, {
            semesterId: semesterFolder.id,
            subjectId: subjectFolder.id,
            unitId: null,
          });
        }
      }

      if (subjectTopics.length === 0) {
        const topicId = `general-${subjectFolder.id}`;
        const topic: TopicSummary = {
          id: topicId,
          name: "General resources",
          semesterId: semesterFolder.id,
          semesterName: semesterFolder.name,
          subjectId: subjectFolder.id,
          subjectName: subjectFolder.name,
          unitId: null,
          unitName: null,
          fileCount: 0,
        };
        subjectTopics.push(topic);
        topicLocation.set(topicId, {
          semesterId: semesterFolder.id,
          subjectId: subjectFolder.id,
          unitId: null,
        });
      }

      const subjectFileCount = rawItems.filter(
        (item) =>
          item.mimeType === "application/pdf" &&
          getPath(item.parents?.[0] ?? root.id, folderMap).some(
            (folder) => folder.id === subjectFolder.id,
          ),
      ).length;
      return {
        id: subjectFolder.id,
        name: subjectFolder.name,
        subjectCount: subjectTopics.length,
        topics: subjectTopics,
        fileCount: subjectFileCount,
      };
    });

    semesters.push({
      id: semesterFolder.id,
      name: semesterFolder.name,
      subjectCount: subjects.length,
      fileCount: 0,
      subjects,
    });
  }

  const rawFiles = rawItems.filter(
    (item) => item.mimeType === "application/pdf" && !item.trashed,
  );
  const fileTopicMap = new Map<string, string>();
  for (const rawFile of rawFiles) {
    const path = getPath(rawFile.parents?.[0] ?? root.id, folderMap);
    if (path.length < 2) continue;
    const semesterFolder = path[0];
    const subjectFolder = path[1];
    let unitFolder: DriveFolder | null = null;
    let topicFolder: DriveFolder | null = null;
    let syntheticTopicId: string | null = null;

    const levelThree = path[2];
    if (levelThree) {
      const nested = folders.filter((folder) => folder.parentId === levelThree.id);
      const isUnit =
        /^(unit|module)\b/i.test(levelThree.name) || nested.length > 0;
      if (isUnit) {
        unitFolder = levelThree;
        topicFolder = path[3] ?? null;
        if (!topicFolder) syntheticTopicId = `general-${levelThree.id}`;
      } else {
        topicFolder = levelThree;
      }
    } else {
      syntheticTopicId = `general-${subjectFolder.id}`;
    }

    const topicId = topicFolder?.id ?? syntheticTopicId;
    if (!topicId) continue;
    fileTopicMap.set(rawFile.id, topicId);
    if (!topicLocation.has(topicId)) {
      topicLocation.set(topicId, {
        semesterId: semesterFolder.id,
        subjectId: subjectFolder.id,
        unitId: unitFolder?.id ?? null,
      });
      const topic: TopicSummary = {
        id: topicId,
        name: topicFolder?.name ?? "General resources",
        semesterId: semesterFolder.id,
        semesterName: semesterFolder.name,
        subjectId: subjectFolder.id,
        subjectName: subjectFolder.name,
        unitId: unitFolder?.id ?? null,
        unitName: unitFolder?.name ?? null,
        fileCount: 0,
      };
      const semester = semesters.find((item) => item.id === semesterFolder.id);
      const subject = semester?.subjects.find(
        (item) => item.id === subjectFolder.id,
      );
      subject?.topics.push(topic);
      topics.push(topic);
    }
  }

  const mappedFiles: NoteFile[] = [];
  for (const rawFile of rawFiles) {
    const topicId = fileTopicMap.get(rawFile.id);
    const topic = topicId
      ? semesters
          .flatMap((semester) => semester.subjects)
          .flatMap((subject) => subject.topics)
          .find((item) => item.id === topicId)
      : undefined;
    if (!topic) continue;
    const parentFolder = folderMap.get(rawFile.parents?.[0] ?? "");
    let inheritedPublic = parentFolder?.isPublic ?? false;
    if (!inheritedPublic && parentFolder) {
      const ancestry = getPath(parentFolder.id, folderMap);
      inheritedPublic = ancestry.some((folder) => folder.isPublic);
    }
    const isPublic = isStudentReadable(rawFile.permissions, inheritedPublic);
    mappedFiles.push({
      id: rawFile.id,
      name: rawFile.name,
      mimeType: rawFile.mimeType,
      modifiedTime: rawFile.modifiedTime ? new Date(rawFile.modifiedTime) : null,
      size: rawFile.size ? Number(rawFile.size) : null,
      semesterId: topic.semesterId,
      semesterName: topic.semesterName,
      subjectId: topic.subjectId,
      subjectName: topic.subjectName,
      unitId: topic.unitId,
      unitName: topic.unitName,
      topicId: topic.id,
      topicName: topic.name,
      category: classifyFile(rawFile.name),
      webViewLink: isPublic
        ? publicDriveLink(rawFile.id, rawFile.webViewLink)
        : null,
      webContentLink:
        isPublic && rawFile.webContentLink
          ? rawFile.webContentLink
          : isPublic
            ? `https://drive.google.com/uc?id=${encodeURIComponent(rawFile.id)}&export=download`
            : null,
      thumbnailLink: isPublic ? rawFile.thumbnailLink ?? null : null,
      isPublic,
      parentId: rawFile.parents?.[0] ?? null,
    });
  }

  const allTopics = semesters.flatMap((semester) =>
    semester.subjects.flatMap((subject) => subject.topics),
  );
  for (const topic of allTopics) {
    topic.fileCount = mappedFiles.filter((file) => file.topicId === topic.id).length;
  }
  for (const semester of semesters) {
    semester.fileCount = mappedFiles.filter(
      (file) => file.semesterId === semester.id,
    ).length;
  }
  const mappedTopicIds = new Set(allTopics.map((topic) => topic.id));
  for (const topic of allTopics) {
    if (!mappedTopicIds.has(topic.id)) topics.push(topic);
  }

  return {
    rootFolderId: root.id,
    rootFolderName: root.name,
    folders,
    files: mappedFiles,
    semesters,
    topics: allTopics,
    topicLocation,
    semesterIds,
    subjectParents,
    unitParents,
  };
}

async function fetchDriveIndex(): Promise<DriveIndex> {
  const rootFolderId = requiredEnv("GOOGLE_DRIVE_ROOT_FOLDER_ID");
  const root = await driveJson<DriveRawFile>(
    `${DRIVE_API}/files/${encodeURIComponent(rootFolderId)}?supportsAllDrives=true&fields=id,name,mimeType,permissions(type,role,domain)`,
    {},
    true,
  );
  if (root.mimeType !== DRIVE_FOLDER_MIME) {
    throw new ApiError(400, "GOOGLE_DRIVE_ROOT_FOLDER_ID must refer to a folder.");
  }

  const all: DriveRawFile[] = [];
  const foldersToVisit = [rootFolderId];
  const visited = new Set<string>();
  while (foldersToVisit.length > 0) {
    const parentId = foldersToVisit.shift()!;
    if (visited.has(parentId)) continue;
    visited.add(parentId);
    const children = await listChildren(parentId);
    all.push(...children);
    for (const child of children) {
      if (child.mimeType === DRIVE_FOLDER_MIME) foldersToVisit.push(child.id);
    }
  }
  return makeDriveIndex(root, all);
}

export async function getDriveIndex(forceRefresh = false): Promise<DriveIndex> {
  if (
    !forceRefresh &&
    driveIndexCache &&
    driveIndexCache.expiresAt > Date.now()
  ) {
    return driveIndexCache.value;
  }
  const index = await fetchDriveIndex();
  driveIndexCache = { value: index, expiresAt: Date.now() + CATALOGUE_CACHE_MS };
  return index;
}

export function invalidateDriveCaches(): void {
  driveIndexCache = null;
  videoConfigCache = null;
}

function recentFirst(files: NoteFile[]): NoteFile[] {
  return [...files].sort(
    (a, b) =>
      (b.modifiedTime?.getTime() ?? 0) - (a.modifiedTime?.getTime() ?? 0),
  );
}

export async function getPublicCatalogue(params: {
  q?: string;
  semesterId?: string;
  subjectId?: string;
  page: number;
  pageSize: number;
}): Promise<CataloguePage> {
  if (getDriveSetupMessage()) {
    return {
      source: "unconfigured",
      configured: false,
      semesters: [],
      items: [],
      recentFiles: [],
      total: 0,
      page: params.page,
      pageSize: params.pageSize,
    };
  }
  const index = await getDriveIndex();
  const publicFiles = index.files.filter((file) => file.isPublic);
  const filtered = filterFiles(publicFiles, params);
  const start = (params.page - 1) * params.pageSize;
  return {
    source: "drive",
    configured: true,
    semesters: index.semesters,
    items: filtered.slice(start, start + params.pageSize),
    recentFiles: recentFirst(publicFiles).slice(0, 5),
    total: filtered.length,
    page: params.page,
    pageSize: params.pageSize,
  };
}

function filterFiles(
  files: NoteFile[],
  params: {
    q?: string;
    semesterId?: string;
    subjectId?: string;
  },
): NoteFile[] {
  const query = params.q?.trim().toLowerCase();
  return recentFirst(files).filter((file) => {
    if (params.semesterId && file.semesterId !== params.semesterId) return false;
    if (params.subjectId && file.subjectId !== params.subjectId) return false;
    if (
      query &&
      !`${file.name} ${file.subjectName} ${file.topicName} ${file.semesterName}`
        .toLowerCase()
        .includes(query)
    ) {
      return false;
    }
    return true;
  });
}

function defaultVideoConfiguration(): VideoConfiguration {
  return { schemaVersion: 1, updatedAt: null, semesters: [] };
}

async function findVideoConfigFile(
  rootFolderId: string,
): Promise<DriveRawFile | null> {
  const children = await listChildren(rootFolderId);
  const matches = children.filter(
    (item) =>
      item.name === VIDEO_CONFIG_NAME &&
      item.mimeType !== DRIVE_FOLDER_MIME &&
      item.mimeType !== "application/pdf",
  );
  if (matches.length > 1) {
    throw new ApiError(
      409,
      `More than one ${VIDEO_CONFIG_NAME} file exists in the Drive root. Keep a single configuration file.`,
    );
  }
  return matches[0] ?? null;
}

function validateYoutubeVideo(video: TopicVideo): void {
  const videoId = extractYoutubeVideoId(video.youtubeUrl);
  if (!videoId || videoId !== video.videoId) {
    throw new ApiError(
      400,
      `Video "${video.title || video.videoId}" has an unsupported YouTube URL or an incorrect video ID.`,
    );
  }
  if (!video.title.trim()) {
    throw new ApiError(400, "Every video needs a title.");
  }
  if (!Number.isInteger(video.order) || video.order < 0) {
    throw new ApiError(400, "Video display order must be a non-negative integer.");
  }
}

export function extractYoutubeVideoId(input: string): string | null {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let candidate = "";
    if (host === "youtu.be") {
      candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      if (url.pathname === "/watch") candidate = url.searchParams.get("v") ?? "";
      else {
        const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/);
        candidate = match?.[1] ?? "";
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

async function readVideoConfiguration(forceRefresh = false): Promise<VideoConfiguration> {
  if (
    !forceRefresh &&
    videoConfigCache &&
    videoConfigCache.expiresAt > Date.now()
  ) {
    return videoConfigCache.value;
  }
  if (getDriveSetupMessage()) return defaultVideoConfiguration();

  const rootFolderId = requiredEnv("GOOGLE_DRIVE_ROOT_FOLDER_ID");
  const configFile = await findVideoConfigFile(rootFolderId);
  if (!configFile) {
    const empty = defaultVideoConfiguration();
    videoConfigCache = {
      value: empty,
      expiresAt: Date.now() + VIDEO_CONFIG_CACHE_MS,
    };
    return empty;
  }
  const response = await driveFetch(
    `${DRIVE_API}/files/${encodeURIComponent(configFile.id)}?alt=media&supportsAllDrives=true`,
    {},
    true,
  );
  const raw = (await response.json().catch(() => null)) as unknown;
  const parsed = GetAdminVideoConfigResponse.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(
      502,
      `${VIDEO_CONFIG_NAME} is malformed or does not match the documented format. Correct the JSON in Drive before showing topic videos.`,
    );
  }
  for (const semester of parsed.data.semesters) {
    for (const subject of semester.subjects) {
      for (const unit of subject.units) {
        for (const topic of unit.topics) {
          for (const video of topic.videos) validateYoutubeVideo(video);
        }
      }
    }
  }
  const config = parsed.data as VideoConfiguration;
  videoConfigCache = {
    value: config,
    expiresAt: Date.now() + VIDEO_CONFIG_CACHE_MS,
  };
  return config;
}

export async function getPublicVideoConfiguration(): Promise<VideoConfiguration> {
  const config = await readVideoConfiguration();
  return {
    schemaVersion: 1,
    updatedAt: config.updatedAt ?? null,
    semesters: config.semesters
      .map((semester) => ({
        ...semester,
        subjects: semester.subjects
          .map((subject) => ({
            ...subject,
            units: subject.units
              .map((unit) => ({
                ...unit,
                topics: unit.topics
                  .map((topic) => ({
                    ...topic,
                    videos: topic.videos
                      .filter((video) => video.published)
                      .sort((a, b) => a.order - b.order),
                  }))
                  .filter((topic) => topic.videos.length > 0),
              }))
              .filter((unit) => unit.topics.length > 0),
          }))
          .filter((subject) => subject.units.length > 0),
      }))
      .filter((semester) => semester.subjects.length > 0),
  };
}

function createDriveVideoConfiguration(index: DriveIndex): VideoConfiguration {
  const semesterConfig: VideoConfiguration["semesters"] = index.semesters.map(
    (semester) => ({
      id: semester.id,
      name: semester.name,
      subjects: semester.subjects.map((subject) => {
        const units = new Map<
          string,
          { id: string; name: string; topics: Array<{ id: string; name: string; videos: TopicVideo[] }> }
        >();
        const directTopics: Array<{ id: string; name: string; videos: TopicVideo[] }> = [];
        for (const topic of subject.topics) {
          const topicConfig = { id: topic.id, name: topic.name, videos: [] as TopicVideo[] };
          if (!topic.unitId) {
            directTopics.push(topicConfig);
            continue;
          }
          const unit = units.get(topic.unitId) ?? {
            id: topic.unitId,
            name: topic.unitName ?? "Unit",
            topics: [],
          };
          unit.topics.push(topicConfig);
          units.set(unit.id, unit);
        }
        if (directTopics.length > 0) {
          const id = `general-${subject.id}`;
          units.set(id, {
            id,
            name: "General resources",
            topics: directTopics,
          });
        }
        return {
          id: subject.id,
          name: subject.name,
          units: [...units.values()],
        };
      }),
    }),
  );
  return { schemaVersion: 1, updatedAt: null, semesters: semesterConfig };
}

function mergeStoredVideos(
  driveConfig: VideoConfiguration,
  stored: VideoConfiguration,
): VideoConfiguration {
  const storedTopics = new Map(
    stored.semesters
      .flatMap((semester) => semester.subjects)
      .flatMap((subject) => subject.units)
      .flatMap((unit) => unit.topics)
      .map((topic) => [topic.id, topic]),
  );
  return {
    schemaVersion: 1,
    updatedAt: stored.updatedAt ?? null,
    semesters: driveConfig.semesters.map((semester) => ({
      ...semester,
      subjects: semester.subjects.map((subject) => ({
        ...subject,
        units: subject.units.map((unit) => ({
          ...unit,
          topics: unit.topics.map((topic) => ({
            ...topic,
            videos: storedTopics.get(topic.id)?.videos ?? [],
          })),
        })),
      })),
    })),
  };
}

export async function getAdminVideoConfiguration(): Promise<VideoConfiguration> {
  const stored = await readVideoConfiguration();
  if (getDriveSetupMessage()) return stored;
  const index = await getDriveIndex();
  return mergeStoredVideos(createDriveVideoConfiguration(index), stored);
}

export function getTopicVideos(
  config: VideoConfiguration,
  topicId: string,
): TopicVideo[] {
  return config.semesters
    .flatMap((semester) => semester.subjects)
    .flatMap((subject) => subject.units)
    .flatMap((unit) => unit.topics)
    .find((topic) => topic.id === topicId)
    ?.videos.filter((video) => video.published)
    .sort((a, b) => a.order - b.order) ?? [];
}

export async function getTopicDetail(topicId: string): Promise<TopicDetail> {
  const setupMessage = getDriveSetupMessage();
  if (setupMessage) throw new ApiError(503, setupMessage);
  const index = await getDriveIndex();
  const topic = index.topics.find((item) => item.id === topicId);
  if (!topic) throw new ApiError(404, "Topic not found.");
  const config = await readVideoConfiguration();
  const publicFiles = index.files.filter(
    (file) => file.isPublic && file.topicId === topicId,
  );
  return {
    topic,
    notes: publicFiles.filter((file) => file.category === "notes"),
    practice: publicFiles.filter((file) => file.category === "practice"),
    videos: getTopicVideos(config, topicId),
    source: "drive",
  };
}

export async function getAdminCatalogue(): Promise<AdminCatalogue> {
  if (getDriveSetupMessage()) {
    return {
      configured: false,
      rootFolderId: null,
      folders: [],
      files: [],
    };
  }
  const index = await getDriveIndex();
  return {
    configured: true,
    rootFolderId: index.rootFolderId,
    folders: index.folders.map(({ id, name, parentId, depth }) => ({
      id,
      name,
      parentId,
      depth,
    })),
    files: index.files,
  };
}

export async function createFolder(input: {
  name: string;
  parentId: string;
}): Promise<{ id: string; name: string; parentId: string }> {
  const name = input.name.trim();
  if (
    !name ||
    name.length > 120 ||
    /[/\\\u0000-\u001f]/.test(name) ||
    name === "." ||
    name === ".."
  ) {
    throw new ApiError(400, "Enter a folder name without slashes or control characters.");
  }
  const index = await getDriveIndex();
  const folders = new Set(index.folders.map((folder) => folder.id));
  if (!folders.has(input.parentId)) {
    throw new ApiError(400, "Choose a destination folder inside MANUU CIVIL NOTES.");
  }
  const result = await driveJson<DriveRawFile>(
    `${DRIVE_API}/files?fields=id,name,parents`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: DRIVE_FOLDER_MIME,
        parents: [input.parentId],
      }),
    },
  );
  invalidateDriveCaches();
  return {
    id: result.id,
    name: result.name,
    parentId: result.parents?.[0] ?? input.parentId,
  };
}

function validatePdfFileName(input: string): string {
  const name = input.trim();
  if (
    !name ||
    name.length > 180 ||
    /[/\\\u0000-\u001f]/.test(name) ||
    !name.toLowerCase().endsWith(".pdf")
  ) {
    throw new ApiError(400, "Choose a PDF filename ending in .pdf.");
  }
  return name;
}

function multipartRelated(
  metadata: object,
  contentType: string,
  content: Buffer,
): { boundary: string; body: Buffer } {
  const boundary = `manuu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const start = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const end = Buffer.from(`\r\n--${boundary}--`);
  return { boundary, body: Buffer.concat([start, content, end]) };
}

export async function uploadPdf(
  parentId: string,
  rawName: string,
  content: Buffer,
): Promise<DriveRawFile> {
  if (!Buffer.isBuffer(content) || content.length === 0) {
    throw new ApiError(400, "Choose a PDF to upload.");
  }
  if (content.length > MAX_PDF_BYTES) {
    throw new ApiError(413, "PDF uploads are limited to 25 MB.");
  }
  if (content.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new ApiError(415, "The selected file does not have a valid PDF header.");
  }
  const name = validatePdfFileName(rawName);
  const index = await getDriveIndex();
  const parent = index.folders.find((folder) => folder.id === parentId);
  if (!parent || (parent.depth ?? 0) < 2) {
    throw new ApiError(400, "Choose a subject or topic folder inside MANUU CIVIL NOTES.");
  }
  const multipart = multipartRelated(
    { name, mimeType: "application/pdf", parents: [parentId] },
    "application/pdf",
    content,
  );
  const params = new URLSearchParams({
    uploadType: "multipart",
    supportsAllDrives: "true",
    fields:
      "id,name,mimeType,modifiedTime,size,webViewLink,webContentLink,thumbnailLink,parents,permissions(type,role,domain)",
  });
  const result = await driveJson<DriveRawFile>(
    `${DRIVE_UPLOAD_API}/files?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "content-type": `multipart/related; boundary=${multipart.boundary}`,
      },
      body: multipart.body,
    },
  );
  invalidateDriveCaches();
  return result;
}

async function fetchFileMetadata(fileId: string): Promise<DriveRawFile> {
  return driveJson<DriveRawFile>(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,size,webViewLink,webContentLink,thumbnailLink,parents,permissions(type,role,domain),trashed`,
    {},
    true,
  );
}

function assertFileInsideRoot(fileId: string, index: DriveIndex): NoteFile {
  const file = index.files.find((item) => item.id === fileId);
  if (!file) throw new ApiError(404, "File not found inside the MANUU notes folder.");
  return file;
}

export async function updatePdf(
  fileId: string,
  input: { name?: string; parentId?: string },
): Promise<NoteFile> {
  if (Object.keys(input).length === 0) {
    throw new ApiError(400, "Provide a new filename or destination folder.");
  }
  const index = await getDriveIndex();
  const current = assertFileInsideRoot(fileId, index);
  const metadata = await fetchFileMetadata(fileId);
  const body: Record<string, string> = {};
  const query = new URLSearchParams({
    supportsAllDrives: "true",
    fields:
      "id,name,mimeType,modifiedTime,size,webViewLink,webContentLink,thumbnailLink,parents,permissions(type,role,domain)",
  });
  if (input.name !== undefined) body.name = validatePdfFileName(input.name);
  if (input.parentId !== undefined) {
    const parent = index.folders.find((folder) => folder.id === input.parentId);
    if (!parent || (parent.depth ?? 0) < 2) {
      throw new ApiError(400, "Choose a subject or topic folder inside MANUU CIVIL NOTES.");
    }
    const oldParent = metadata.parents?.[0];
    if (oldParent && oldParent !== input.parentId) {
      query.set("addParents", input.parentId);
      query.set("removeParents", oldParent);
    }
  }
  if (Object.keys(body).length === 0 && !query.has("addParents")) {
    throw new ApiError(400, "The filename and destination are unchanged.");
  }
  await driveJson<DriveRawFile>(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${query.toString()}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  invalidateDriveCaches();
  const refreshed = await getDriveIndex(true);
  return refreshed.files.find((file) => file.id === fileId) ?? current;
}

export async function trashPdf(fileId: string): Promise<{ success: true }> {
  const index = await getDriveIndex();
  assertFileInsideRoot(fileId, index);
  await driveJson<DriveRawFile>(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,trashed`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    },
  );
  invalidateDriveCaches();
  return { success: true };
}

function validateConfigTopicPlacement(
  config: VideoConfiguration,
  index: DriveIndex,
): void {
  const seenVideoIds = new Set<string>();
  for (const semester of config.semesters) {
    if (!index.semesterIds.has(semester.id)) {
      throw new ApiError(400, `Semester "${semester.name}" is not in the Drive folder tree.`);
    }
    for (const subject of semester.subjects) {
      if (index.subjectParents.get(subject.id) !== semester.id) {
        throw new ApiError(400, `Subject "${subject.name}" is not inside that semester.`);
      }
      for (const unit of subject.units) {
        const isGeneralUnit = unit.id === `general-${subject.id}`;
        if (!isGeneralUnit && index.unitParents.get(unit.id) !== subject.id) {
          throw new ApiError(400, `Unit "${unit.name}" is not inside that subject.`);
        }
        for (const topic of unit.topics) {
          const location = index.topicLocation.get(topic.id);
          if (
            !location ||
            location.semesterId !== semester.id ||
            location.subjectId !== subject.id ||
            location.unitId !== (isGeneralUnit ? null : unit.id)
          ) {
            throw new ApiError(400, `Topic "${topic.name}" does not match the Drive folder tree.`);
          }
          for (const video of topic.videos) {
            validateYoutubeVideo(video);
            if (!video.id.trim() || seenVideoIds.has(video.id)) {
              throw new ApiError(400, "Every video entry needs a unique stable ID.");
            }
            seenVideoIds.add(video.id);
          }
        }
      }
    }
  }
}

async function uploadVideoConfig(
  config: VideoConfiguration,
): Promise<void> {
  const rootFolderId = requiredEnv("GOOGLE_DRIVE_ROOT_FOLDER_ID");
  const existing = await findVideoConfigFile(rootFolderId);
  const { updatedAt: _updatedAt, ...storedConfig } = config;
  const content = Buffer.from(
    JSON.stringify(
      { ...storedConfig, schemaVersion: 1, updatedAt: new Date().toISOString() },
      null,
      2,
    ),
    "utf8",
  );
  if (existing) {
    const response = await driveFetch(
      `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(existing.id)}?uploadType=media&supportsAllDrives=true`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json; charset=UTF-8" },
        body: content,
      },
    );
    await response.arrayBuffer();
  } else {
    const multipart = multipartRelated(
      {
        name: VIDEO_CONFIG_NAME,
        mimeType: "application/json",
        parents: [rootFolderId],
      },
      "application/json; charset=UTF-8",
      content,
    );
    const params = new URLSearchParams({
      uploadType: "multipart",
      supportsAllDrives: "true",
      fields: "id,name",
    });
    await driveFetch(`${DRIVE_UPLOAD_API}/files?${params.toString()}`, {
      method: "POST",
      headers: {
        "content-type": `multipart/related; boundary=${multipart.boundary}`,
      },
      body: multipart.body,
    });
  }
  videoConfigCache = null;
}

export async function saveAdminVideoConfiguration(
  input: unknown,
): Promise<VideoConfiguration> {
  const parsed = SaveAdminVideoConfigBody.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(400, "Video configuration is invalid. Check the JSON structure and required fields.");
  }
  const index = await getDriveIndex();
  const config = parsed.data as VideoConfiguration;
  validateConfigTopicPlacement(config, index);
  const saved: VideoConfiguration = {
    schemaVersion: 1,
    updatedAt: new Date(),
    semesters: config.semesters,
  };
  await uploadVideoConfig(saved);
  return saved;
}

export function isPdfMimeType(value: string | undefined): boolean {
  return value === "application/pdf";
}

export const CIVIL_RESOURCE_CONSTANTS = {
  VIDEO_CONFIG_NAME,
  MAX_PDF_BYTES,
};
