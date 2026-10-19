import { useEffect, useState } from 'react';
import { BookOpen, ExternalLink, PlayCircle, RefreshCw, Youtube } from 'lucide-react';
import { Link } from 'wouter';
import { SiteShell } from '@/components/SiteShell';
import { loadResources, type StaticNote } from '@/data/notes';

export default function Videos() {
  const [videos, setVideos] = useState<StaticNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = () => { setLoading(true); setError(''); loadResources().then(items => setVideos(items.filter(item => item.type === 'Video'))).catch(err => setError(err instanceof Error ? err.message : 'Could not load videos.')).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);
  return <SiteShell><main className="page-shell content-page">
    <header className="page-heading"><span className="eyebrow">Curated learning · MANUU Civil Engineering</span><h1 className="section-title">YouTube video lectures</h1><p>Videos are organised by semester and subject from the same shared catalogue as your notes.</p></header>
    {loading && <div className="soft-card empty-state"><RefreshCw size={22}/><p>Loading video lectures…</p></div>}
    {!loading && error && <div className="soft-card empty-state"><h2 className="section-title">Video resources are unavailable</h2><p>{error}</p><button className="button" onClick={load}>Try again</button></div>}
    {!loading && !error && videos.length === 0 && <div className="soft-card empty-state"><div className="empty-icon"><Youtube size={20}/></div><h2 className="section-title">No video lectures published yet</h2><p style={{fontSize:13,color:'hsl(var(--muted-foreground))'}}>Add a row with type “Video” and a YouTube URL to your Google Sheets catalogue.</p><Link href="/notes" className="button button-light"><BookOpen size={15}/>Browse notes</Link></div>}
    {!loading && !error && videos.length > 0 && <div className="video-card-grid">{videos.sort((a,b)=>a.semester-b.semester || a.subject.localeCompare(b.subject)).map(video=><article key={video.id} className="soft-card video-resource-card"><div className="file-icon"><PlayCircle size={20}/></div><span className="status-pill">Semester {video.semester}</span><h2>{video.title}</h2><p>{video.subject}{video.unit ? ` · ${video.unit}` : ''}{video.description ? ` · ${video.description}` : ''}</p><a className="button" href={video.url} target="_blank" rel="noopener noreferrer"><Youtube size={15}/> Watch on YouTube <ExternalLink size={13}/></a></article>)}</div>}
  </main></SiteShell>;
}
