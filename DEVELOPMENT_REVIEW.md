# Civil Nexus — simplified notes workflow

## Change made
- The Notes page now reads from `artifacts/manuu-civil-notes/src/data/notes.ts`.
- Added searchable, semester-filtered and subject-filtered PDF cards with Read and Download actions.
- Added an Admin guide page that explains the manual link workflow; it no longer suggests that Google OAuth/Drive API configuration is required for this approach.
- Existing PDFs remain in Google Drive. The website catalogue contains only metadata and share URLs.
- No sample resources were inserted; the catalogue starts empty to avoid fake data.

## Add a real note
1. Upload a PDF to Google Drive.
2. For public notes only, set General access to Anyone with the link / Viewer.
3. Copy the Drive share URL.
4. Add a record to `artifacts/manuu-civil-notes/src/data/notes.ts`.
5. Save and refresh the site.

## Important
- Public link sharing means anyone with the link can access the file. Only publish resources you are allowed to share.
- Read links open the Google Drive viewer. Download links use the Drive download endpoint when a normal `/file/d/FILE_ID/view` link is supplied; Google may still show a confirmation page.
- The existing API server and the Videos page were not converted in this change. Videos still use the project's existing API-backed configuration. The static Notes workflow does not require Google credentials or a backend.
- Build/typecheck were not run in this environment. Run `pnpm install`, then `pnpm --filter @workspace/manuu-civil-notes typecheck` and `pnpm --filter @workspace/manuu-civil-notes build` locally.
