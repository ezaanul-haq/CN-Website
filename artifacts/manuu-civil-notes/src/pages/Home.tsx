import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Download, ExternalLink, FileText, Search, SlidersHorizontal, GraduationCap, Users, RefreshCw } from 'lucide-react';
import { SiteShell } from '@/components/SiteShell';
import { loadResources, type StaticNote, type ResourceType } from '@/data/notes';

const tabs: { label: string; value: ResourceType }[] = [
  { label: 'Notes', value: 'Notes' },
  { label: 'PYQs', value: 'PYQ' },
  { label: 'Important Questions', value: 'Important Questions' },
];

export default function Home() {
  const [resources, setResources] = useState<StaticNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [category, setCategory] = useState<ResourceType>('Notes');
  const [search, setSearch] = useState('');
  const [semesterFilter, setSemesterFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  const refresh = () => {
    setLoading(true); setLoadError('');
    loadResources().then(setResources).catch(error => setLoadError(error instanceof Error ? error.message : 'Could not load the catalogue.')).finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  const categoryResources = useMemo(() => resources.filter(item => item.type === category), [resources, category]);
  const semesters = useMemo(() => [...new Set(categoryResources.map(note => note.semester))].sort((a,b) => a-b), [categoryResources]);
  const subjects = useMemo(() => [...new Set(categoryResources.filter(note => !semesterFilter || String(note.semester) === semesterFilter).map(note => note.subject))].sort(), [categoryResources, semesterFilter]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return categoryResources.filter(note => {
      const matchesSearch = !term || `${note.title} ${note.subject} ${note.description ?? ''} ${note.unit ?? ''} ${note.authorType}`.toLowerCase().includes(term);
      return matchesSearch && (!semesterFilter || String(note.semester) === semesterFilter) && (!subjectFilter || note.subject === subjectFilter);
    }).sort((a,b) => a.semester-b.semester || a.subject.localeCompare(b.subject) || a.title.localeCompare(b.title));
  }, [categoryResources, search, semesterFilter, subjectFilter]);

  const changeCategory = (value: ResourceType) => { setCategory(value); setSearch(''); setSemesterFilter(''); setSubjectFilter(''); };

  return <SiteShell>
    <main className="page-shell content-page">
      <section className="hero fade-up" style={{marginTop:24}}>
        <span className="eyebrow" style={{color:'#e6c886'}}>B.TECH CIVIL ENGINEERING · MANUU</span>
        <h1>Find your course resources.</h1>
        <p>Browse notes, previous-year questions and important questions shared for Civil Engineering students at MANUU. Open PDFs online or download them from Google Drive.</p>
        <form className="search-wrap" role="search" onSubmit={event => event.preventDefault()}>
          <Search size={19} color="hsl(var(--muted-foreground))" style={{marginLeft:10,flex:'none'}} />
          <input aria-label="Search resources" type="search" placeholder="Search title, subject or topic…" value={search} onChange={event => setSearch(event.target.value)} />
          <button className="button" type="submit">Search</button>
        </form>
        <div style={{display:'flex',gap:20,flexWrap:'wrap',marginTop:20,fontSize:12,color:'rgba(246,242,228,.78)'}}>
          <span><BookOpen size={14} style={{verticalAlign:'-3px',marginRight:6}} />{categoryResources.length} resources in this section</span>
          <span><SlidersHorizontal size={14} style={{verticalAlign:'-3px',marginRight:6}} />{semesters.length} semesters represented</span>
        </div>
      </section>

      <section style={{paddingTop:30}}>
        <div role="tablist" aria-label="Resource category" className="resource-tabs">
          {tabs.map(tab => <button key={tab.value} role="tab" aria-selected={category === tab.value} className={`resource-tab ${category === tab.value ? 'active' : ''}`} onClick={() => changeCategory(tab.value)}>{tab.label}</button>)}
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'end',gap:15,margin:'20px 0 18px',flexWrap:'wrap'}}>
          <div><span className="eyebrow">Course library</span><h2 className="section-title" style={{marginTop:7}}>{tabs.find(tab => tab.value === category)?.label}</h2></div>
          <div className="filter-controls" style={{display:'flex',gap:9,flexWrap:'wrap'}}>
            <select aria-label="Filter by semester" className="select" value={semesterFilter} onChange={event => {setSemesterFilter(event.target.value);setSubjectFilter('');}} style={{width:'auto',minWidth:155,padding:'10px 13px'}}><option value="">All semesters</option>{semesters.map(semester => <option key={semester} value={semester}>Semester {semester}</option>)}</select>
            <select aria-label="Filter by subject" className="select" value={subjectFilter} onChange={event => setSubjectFilter(event.target.value)} style={{width:'auto',minWidth:190,padding:'10px 13px'}}><option value="">All subjects</option>{subjects.map(subject => <option key={subject} value={subject}>{subject}</option>)}</select>
          </div>
        </div>

        {loading && <div className="soft-card empty-state"><RefreshCw size={22} className="spin"/><p>Loading the resource catalogue…</p></div>}
        {!loading && loadError && <div className="soft-card empty-state"><h2 className="section-title">Could not load resources</h2><p>{loadError}</p><button className="button" onClick={refresh}>Try again</button><p style={{fontSize:12}}>Check that the Google Sheet is published as CSV and its URL is configured in Netlify.</p></div>}
        {!loading && !loadError && filtered.length > 0 && <div className="soft-card">
          {filtered.map(note => {
            const fileId = note.url.match(/\/file\/d\/([^/]+)/)?.[1];
            const downloadUrl = fileId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}` : note.url;
            return <article key={note.id} className="file-row">
              <div className="file-icon"><FileText size={19}/></div>
              <div style={{minWidth:0,flex:1}}>
                <strong style={{fontSize:13,display:'block'}}>{note.title}</strong>
                <span style={{display:'block',fontSize:11,color:'hsl(var(--muted-foreground))',marginTop:4}}>Semester {note.semester} · {note.subject}{note.unit ? ` · ${note.unit}` : ''}{note.description ? ` · ${note.description}` : ''}</span>
                {category === 'Notes' && <span className={`author-badge ${note.authorType === 'Teacher' ? 'teacher' : note.authorType === 'Student' ? 'student' : 'other'}`}>{note.authorType === 'Teacher' ? <GraduationCap size={13}/> : <Users size={13}/>} {note.authorType === 'Teacher' ? 'Teacher-written' : note.authorType === 'Student' ? 'Student-written' : 'Source not specified'}</span>}
              </div>
              <span className="status-pill">{category === 'PYQ' ? 'PYQ' : category === 'Important Questions' ? 'IMPORTANT' : 'PDF'}</span>
              <div className="file-actions"><a className="button button-light" style={{padding:'8px 10px',fontSize:11}} href={note.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14}/> Read</a><a className="icon-button" href={downloadUrl} target="_blank" rel="noopener noreferrer" aria-label={`Download ${note.title}`}><Download size={17}/></a></div>
            </article>;
          })}
        </div>}
        {!loading && !loadError && filtered.length === 0 && <div className="soft-card empty-state"><div className="empty-icon"><BookOpen size={20}/></div><h2 className="section-title">{resources.length === 0 ? 'Resource catalogue not connected yet' : `No ${tabs.find(tab => tab.value === category)?.label.toLowerCase()} found`}</h2><p style={{color:'hsl(var(--muted-foreground))',fontSize:13,maxWidth:560,margin:'10px auto 0'}}>{resources.length === 0 ? 'Connect the public, read-only Google Sheets catalogue to show real resources here. No example resources are displayed.' : 'Try another search term or clear the semester and subject filters.'}</p>{(search || semesterFilter || subjectFilter) && <button className="button button-light" style={{marginTop:15}} onClick={() => {setSearch('');setSemesterFilter('');setSubjectFilter('');}}>Clear filters</button>}</div>}
      </section>
      <section className="soft-card" style={{marginTop:28,padding:20}}><strong style={{display:'block',marginBottom:6}}>How resources are organised</strong><p style={{fontSize:13,color:'hsl(var(--muted-foreground))',margin:0,lineHeight:1.7}}>The catalogue is managed in Google Sheets. Each resource is labelled by type, semester, subject and source. Teacher-written and student-written notes have distinct badges so students can identify them easily.</p></section>
    </main>
  </SiteShell>;
}
