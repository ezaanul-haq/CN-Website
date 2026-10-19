# Civil Nexus

A responsive course library for B.Tech Civil Engineering students at Maulana
Azad National Urdu University, Hyderabad. Google Drive is the source of truth
for notes, folder hierarchy, and the topic-to-YouTube configuration. The app
does not use a database.

## How it is organized

- The React/Vite site calls the shared Node API at `/api/civil`.
- The API discovers semesters, subjects, units, topics, and PDFs from the
  configured Google Drive root folder. Folder IDs are used as stable topic
  identifiers.
- Students only receive PDFs that are readable by the configured student
  audience. Private Drive items are omitted from public catalogue responses.
- Administrators sign in with Google OpenID Connect. The server checks the
  signed-in email against `ADMIN_EMAILS`.
- A dedicated Google service account performs Drive operations. Share only
  `MANUU CIVIL NOTES` with that account as an Editor. The admin browser never
  receives its private key or a Drive access token.
- The service-account key, OAuth client secret, and session-signing secret are
  stored as server-side environment secrets. Short-lived service-account
  access tokens are held in server memory; no user refresh tokens are issued or
  persisted.
- If Google Drive credentials are not configured, catalogue and video pages
  show empty states. The app does not display fabricated notes or video links.

## Google Drive folders

Use a structure like:

```text
MANUU CIVIL NOTES/
  Semester 1/
    Engineering Mathematics/
      Unit 1/
        Matrices and Linear Algebra/
          lecture-notes.pdf
          previous-year-questions.pdf
    Engineering Chemistry/
    Engineering Graphics/
    Engineering Mechanics/
  Semester 2/
    Surveying and Geomatics/
    Building Materials/
```

Folder levels are discovered at runtime. Create a new semester, subject, unit,
or topic in Drive or from the admin desk; no frontend code change is required.
Subject-level resources appear under a generated “General resources” topic.
Files are grouped as practice material when their filename contains terms
such as `PYQ`, `question`, `practice`, `assignment`, or `exercise`; other PDFs
are grouped as study notes.

## Google Cloud setup

1. Create or choose a Google Cloud project and enable the **Google Drive API**.
2. Create a dedicated service account. Create a JSON key for it and add the
   entire JSON document to the server secret `GOOGLE_SERVICE_ACCOUNT_JSON`.
   Treat this key like a password.
3. Share the `MANUU CIVIL NOTES` root folder with the service account's
   `client_email` as **Editor**. Do not share unrelated Drive files with this
   service account. Copy the root folder ID from its Drive URL.
4. Configure the OAuth consent screen and add the intended administrators as
   test users while the app is in testing mode.
5. Create an OAuth client with application type **Web application**. Add the
   deployed site's origin as an authorized JavaScript origin and this exact
   callback as an authorized redirect URI:

   ```text
   https://YOUR-PUBLISHED-DOMAIN/api/civil/admin/auth/callback
   ```

   Use the exact public domain and path for the deployment. Add a separate
   callback URI when testing against a different domain. Never put the client
   secret in the frontend.
6. The sign-in flow requests only `openid email`. Admin eligibility is
   controlled by the server-side `ADMIN_EMAILS` allowlist. Drive access is
   performed separately by the service account.
7. If student access is restricted to a university Google Workspace domain,
   share the Drive root with that domain as **Viewer** and set
   `GOOGLE_DRIVE_STUDENT_DOMAIN` to that exact domain. Otherwise, make the
   student-facing folders/files available to **Anyone with the link — Viewer**.
   Files not readable by that audience stay out of the student catalogue.

The Drive API access token uses the Drive scope because the service account
must list and manage files in a pre-existing folder tree. Operational access
is limited by sharing only the MANUU root folder with a dedicated service
account and by server checks that reject file changes outside that root.

## Environment settings

Set these on the API server, not as `VITE_` frontend variables:

| Name | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth web-client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth client secret; keep in server secrets |
| `GOOGLE_REDIRECT_URI` | Yes | Exact callback URL registered in Google Cloud |
| `ADMIN_EMAILS` | Yes | Comma-separated lower-case administrator email allowlist |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Yes | Full service-account JSON; keep in server secrets |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Yes | ID of the `MANUU CIVIL NOTES` Drive folder |
| `SESSION_SECRET` | Yes | HMAC signing key for the admin session cookie |
| `GOOGLE_DRIVE_STUDENT_DOMAIN` | No | Workspace domain allowed to read student resources |

The admin cookie is HTTP-only, `SameSite=Lax`, signed server-side, and expires
after 12 hours. It contains the allowlisted email and expiry, not OAuth or Drive
credentials. OAuth state is signed, single-use, stored in a short-lived
HTTP-only `SameSite=Lax` cookie, and expires after 10 minutes. Drive metadata
is cached for 45 seconds and video configuration for 30 seconds.
Transient Google Drive read/list requests are retried with backoff. PDF uploads
are limited to 25 MB and only accepted inside the configured root.

## Topic video JSON

The API creates `MANUU_VIDEO_RESOURCES.json` in the Drive root on the first
save. The admin desk begins with the Drive folder hierarchy and saves the full
configuration there. Video IDs remain associated with stable Drive folder IDs.

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-17T12:00:00.000Z",
  "semesters": [
    {
      "id": "DRIVE_SEMESTER_FOLDER_ID",
      "name": "Semester 1",
      "subjects": [
        {
          "id": "DRIVE_SUBJECT_FOLDER_ID",
          "name": "Engineering Mechanics",
          "units": [
            {
              "id": "DRIVE_UNIT_FOLDER_ID",
              "name": "Unit 1",
              "topics": [
                {
                  "id": "DRIVE_TOPIC_FOLDER_ID",
                  "name": "Force Systems",
                  "videos": [
                    {
                      "id": "stable-video-entry-id",
                      "videoId": "AbCdEfGhIjK",
                      "title": "Introduction to force systems",
                      "youtubeUrl": "https://www.youtube.com/watch?v=AbCdEfGhIjK",
                      "channelName": null,
                      "order": 1,
                      "published": true
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

The ID above is a format-only placeholder, not a playable lecture. Use the
admin desk to add/edit videos rather than editing the JSON by hand.
Supported URL forms include `youtube.com/watch?v=…`, `youtu.be/…`,
`youtube.com/embed/…`, `/shorts/…`, and `/live/…`. The server validates the
video ID against the URL, stable entry IDs, folder placement, title, order,
and publish flag. Only published videos are returned to students.

## Development

Run the existing workflows for **API Server** and **Civil Nexus**. The
homepage is at `/`, notes are at `/notes`, video lectures are at `/videos`,
and API endpoints are under `/api/civil`. Without Google credentials, notes
and video pages show empty states rather than sample resources.

The root preinstall check runs as a Node.js script, so it works in Windows
PowerShell as well as Unix shells. It still requires pnpm and removes only
`package-lock.json` and `yarn.lock`. The pnpm workspace leaves Rollup, esbuild,
Lightning CSS, and Tailwind's native optional dependencies to pnpm's platform
selection; do not add operating-system-specific packages manually.

Useful checks:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/manuu-civil-notes run typecheck
pnpm --filter @workspace/manuu-civil-notes run build
```

## Deployment

This project has a static web artifact and a process-backed API artifact.
Publishing the Replit project deploys its artifacts together, and the API
artifact already owns the `/api` route. Use the project's Publishing settings
and keep both artifacts enabled. Before publishing, add Google settings with
the project's secret/environment-variable manager; keep them server-side and
never use `VITE_` variable names for credentials. Use the final published
domain in `GOOGLE_REDIRECT_URI` and register that exact URI in the Google OAuth
client. If the published domain changes, update and re-register the callback.

For a first live check, confirm `/api/healthz` returns `{"status":"ok"}`, the
notes and videos pages show Drive data rather than fabricated sample records, a public PDF opens for a
student who is not signed into the admin account, an unlisted/private PDF is
not shown, an allowlisted Google account can sign in, and a non-allowlisted
account cannot make administrator changes.

## Testing checklist

- [ ] Before configuring Drive, verify the notes and video pages show useful empty states and no fabricated resources.
- [ ] Configure the service account and root folder; verify new semester and subject folders appear without a redeploy.
- [ ] Confirm student views include only PDFs shared as Viewer with the chosen student audience.
- [ ] Search by filename and subject; filter by semester; move between result pages.
- [ ] As an allowlisted administrator, create folders, upload a PDF, rename/move it, and move it to Drive trash.
- [ ] Confirm a non-allowlisted Google account receives no administrator session.
- [ ] Add multiple YouTube URLs to different topics; test publish/unpublish and display order.
- [ ] Edit or remove a video; verify the Drive JSON changes and student pages refresh after cache expiry.
- [ ] Test available and embedding-disabled YouTube videos, direct YouTube links, mobile layout, missing config, and malformed JSON.
- [ ] Confirm no Google client secret, service-account key, or Drive token appears in browser network responses.
