/**
 * Civil Nexus shared resource catalogue.
 *
 * Add resources by adding rows to the Google Sheet, not by editing this file.
 * Publish the sheet as CSV and set VITE_RESOURCE_SHEET_CSV_URL in Netlify's
 * environment variables (and in a local .env file for local development).
 * Required headers: type, title, url, semester, subject, authorType, description, unit
 * type: Notes | PYQ | Important Questions | Video
 * authorType: Teacher | Student | Other (use Teacher or Student for notes)
 */
export type ResourceType = 'Notes' | 'PYQ' | 'Important Questions' | 'Video';
export type NoteAuthor = 'Teacher' | 'Student' | 'Other';
export type StaticNote = {
  id: string;
  title: string;
  type: ResourceType;
  semester: number;
  subject: string;
  url: string;
  authorType: NoteAuthor;
  unit?: string;
  description?: string;
};

// Set this once in Netlify and local .env. Resource additions are made in Sheets.
const SHEET_CSV_URL = import.meta.env.VITE_RESOURCE_SHEET_CSV_URL as string | undefined;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = []; cell = '';
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

function mapRows(text: string): StaticNote[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(value => value.toLowerCase().replace(/\s+/g, '').replace(/_/g, ''));
  const get = (row: string[], key: string) => row[headers.indexOf(key)] ?? '';
  return rows.slice(1).map((row, index) => {
    const rawType = get(row, 'type').toLowerCase();
    const type: ResourceType = rawType.includes('video') || rawType.includes('youtube') ? 'Video'
      : rawType.includes('pyq') || rawType.includes('previous') ? 'PYQ'
      : rawType.includes('important') ? 'Important Questions' : 'Notes';
    const rawAuthor = get(row, 'authortype').toLowerCase();
    const authorType: NoteAuthor = rawAuthor.startsWith('teach') ? 'Teacher' : rawAuthor.startsWith('stud') ? 'Student' : 'Other';
    const title = get(row, 'title');
    const url = get(row, 'url') || get(row, 'link');
    return {
      id: get(row, 'id') || `${type.toLowerCase().replace(/\W+/g, '-')}-${index}-${title.toLowerCase().replace(/\W+/g, '-')}`,
      title,
      url,
      type,
      semester: Number(get(row, 'semester')) || 1,
      subject: get(row, 'subject') || 'General',
      authorType,
      unit: get(row, 'unit'),
      description: get(row, 'description'),
    };
  }).filter(item => item.title && item.url && /^https?:\/\//i.test(item.url));
}

export async function loadResources(): Promise<StaticNote[]> {
  if (!SHEET_CSV_URL) return [];
  const response = await fetch(SHEET_CSV_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Resource catalogue returned ${response.status}`);
  return mapRows(await response.text());
}
