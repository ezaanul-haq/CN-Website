# Civil Nexus resource catalogue setup

The website now reads notes, PYQs, important questions, and YouTube links from one Google Sheets catalogue. There is no admin panel in this simplified version.

## Sheet columns
Create a Google Sheet with these headers in row 1 (order can vary):

`type | title | url | semester | subject | authorType | description | unit`

- `type`: `Notes`, `PYQ`, `Important Questions`, or `Video`
- `title`: resource title
- `url`: public Google Drive sharing link for a PDF, or YouTube URL for a video
- `semester`: semester number
- `subject`: subject name
- `authorType`: `Teacher`, `Student`, or `Other` (teacher/student badges are shown for Notes)
- `description`: optional description
- `unit`: optional unit name

Publish the sheet as CSV/read-only to the web, then copy its CSV URL. Do not put private information in the published sheet. PDFs themselves must have sharing permissions appropriate for students (typically “Anyone with the link — Viewer”).

## Configure local development
Create `.env` in `artifacts/manuu-civil-notes/` and add:

`VITE_RESOURCE_SHEET_CSV_URL=YOUR_PUBLISHED_CSV_URL`

Restart the dev server after changing environment variables.

## Configure Netlify
In Netlify site configuration, add environment variable `VITE_RESOURCE_SHEET_CSV_URL` with the published CSV URL, then trigger a new deploy. The URL is public by design because it only reads a public catalogue. Never put credentials or private keys in `VITE_*` variables.

The catalogue is read-only from the website; add or edit rows in Google Sheets. This avoids a backend and admin login for the current low-frequency update workflow. The `/admin` route and navigation entry have been removed.
