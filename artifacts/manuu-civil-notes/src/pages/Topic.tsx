import { Link, useParams } from 'wouter';
import { ArrowLeft, BookOpen, RotateCw, Youtube } from 'lucide-react';
import { useGetCivilTopic } from '@workspace/api-client-react';
import { SiteShell } from '@/components/SiteShell';
import { ResourceFile, VideoCard } from '@/components/Resource';

export default function Topic() {
  const { topicId = '' } = useParams<{topicId:string}>();
  const query = useGetCivilTopic(topicId);
  const detail = query.data;
  return <SiteShell><main className="page-shell" style={{paddingTop:35}}>
    <Link href="/notes" className="button button-light" style={{padding:'9px 13px'}} data-testid="link-back-library"><ArrowLeft size={15}/>Back to library</Link>
    {query.isLoading && <div style={{paddingTop:30}} data-testid="status-topic-loading"><div className="skeleton" style={{height:150,marginBottom:22}}/><div className="skeleton" style={{height:220}}/></div>}
    {query.isError && <div className="soft-card empty-state" style={{marginTop:30}} data-testid="status-topic-error"><div className="empty-icon"><RotateCw size={20}/></div><h1 className="section-title">Topic unavailable</h1><p style={{color:'hsl(var(--muted-foreground))'}}>{query.error instanceof Error ? query.error.message : "We couldn't retrieve this topic. Check your connection and try again."}</p><button className="button" onClick={()=>query.refetch()} data-testid="button-retry-topic"><RotateCw size={15}/>Retry</button></div>}
    {detail && <div className="fade-up" style={{paddingTop:30}}>
      <span className="eyebrow">{detail.topic.semesterName} / {detail.topic.subjectName}{detail.topic.unitName ? ` / ${detail.topic.unitName}` : ''}</span>
      <h1 className="serif" style={{fontSize:'clamp(38px,6vw,58px)',letterSpacing:'-.04em',lineHeight:1.1,margin:'12px 0'}} data-testid="text-topic-title">{detail.topic.name}</h1>
      <p style={{color:'hsl(var(--muted-foreground))',fontSize:14,margin:'0 0 32px'}}>Study materials and selected explanations for this topic.</p>
      <div className="topic-resource-grid" style={{display:'grid',gridTemplateColumns:'minmax(0,1.3fr) minmax(280px,.7fr)',gap:22,alignItems:'start'}}>
        <section>
          <div style={{marginBottom:12}}><span className="eyebrow">Reference desk</span><h2 className="section-title" style={{fontSize:27,marginTop:6}}>Study resources</h2></div>
          <div className="soft-card">
            <div style={{padding:'16px 17px 5px',fontSize:11,fontWeight:700,letterSpacing:'.1em',color:'hsl(var(--muted-foreground))'}}>STUDY NOTES</div>
            {detail.notes.length>0 ? detail.notes.map(file=><ResourceFile key={file.id} file={file}/>) : <p style={{padding:'4px 17px 14px',fontSize:12,color:'hsl(var(--muted-foreground))'}} data-testid="status-topic-notes-empty">No study notes are filed for this topic yet.</p>}
            <div style={{padding:'16px 17px 5px',fontSize:11,fontWeight:700,letterSpacing:'.1em',color:'hsl(var(--muted-foreground))'}}>PRACTICE MATERIALS</div>
            {detail.practice.length>0 ? detail.practice.map(file=><ResourceFile key={file.id} file={file}/>) : <p style={{padding:'4px 17px 14px',fontSize:12,color:'hsl(var(--muted-foreground))'}} data-testid="status-topic-practice-empty">No practice sheets or question papers are filed here yet.</p>}
          </div>
        </section>
        <aside>
          <div style={{marginBottom:12}}><span className="eyebrow">Watch & understand</span><h2 className="section-title" style={{fontSize:27,marginTop:6}}>Video lectures</h2></div>
          {detail.videos.length ? <div style={{display:'grid',gap:10}}>{detail.videos.map(video=><VideoCard key={video.id} video={video}/>)}</div> : <div className="soft-card empty-state" data-testid="status-topic-videos-empty"><div className="empty-icon"><Youtube size={20}/></div><strong>No lectures linked yet</strong><p style={{fontSize:13,color:'hsl(var(--muted-foreground))'}}>Curated YouTube lessons will be added as they are reviewed.</p></div>}
        </aside>
      </div>
    </div>}
  </main></SiteShell>;
}
