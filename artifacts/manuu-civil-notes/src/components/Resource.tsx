import { useState } from 'react';
import { FileText, Download, ExternalLink, Play, AlertCircle, Youtube } from 'lucide-react';
import type { NoteFile, TopicVideo } from '@workspace/api-client-react';

export function ResourceFile({ file }: { file: NoteFile }) {
  const viewLink = file.webViewLink || file.webContentLink;
  const downloadLink = file.webContentLink || file.webViewLink;
  return <div className="file-row" data-testid={`resource-${file.id}`}>
    <div className="file-icon"><FileText size={19}/></div>
    <div style={{minWidth:0,flex:1}}>
      <strong style={{fontSize:13,display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} data-testid={`text-resource-name-${file.id}`}>{file.name}</strong>
      <span style={{display:'block',fontSize:11,color:'hsl(var(--muted-foreground))',marginTop:4}}>
        {file.category === 'practice' ? 'Practice material' : 'Lecture notes'}{file.modifiedTime ? ` · ${new Date(file.modifiedTime).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}` : ''}
      </span>
    </div>
    <div style={{display:'flex',gap:4,flex:'none'}}>
      <span className="status-pill">{file.mimeType === 'application/pdf' ? 'PDF' : file.mimeType.split('/').pop()?.toUpperCase() || 'FILE'}</span>
      <span className="status-pill">{file.category === 'practice' ? 'PRACTICE' : 'NOTES'}</span>
    </div>
    <div className="file-actions">
      {viewLink ? <a className="button button-light" style={{padding:'8px 10px',fontSize:11}} href={viewLink} target="_blank" rel="noreferrer" data-testid={`link-view-resource-${file.id}`}>View</a> : <span className="icon-button" title="No public view link is available"><AlertCircle size={16}/></span>}
      {downloadLink ? <a className="icon-button" href={downloadLink} target="_blank" rel="noreferrer" aria-label={`Download ${file.name}`} data-testid={`link-download-resource-${file.id}`}><Download size={17}/></a> : <span className="icon-button" title="Download is unavailable" aria-label="Download unavailable"><Download size={16}/></span>}
    </div>
  </div>;
}

export function VideoCard({ video }: { video: TopicVideo }) {
  const [playing, setPlaying] = useState(false);
  const [embedError, setEmbedError] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(false);
  const href = video.youtubeUrl || `https://www.youtube.com/watch?v=${video.videoId}`;
  return <article className="soft-card" style={{overflow:'hidden'}} data-testid={`video-${video.id}`}>
    {playing && !embedError ? <div style={{position:'relative',aspectRatio:'16 / 9',background:'#102c2a'}}>
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.videoId)}?rel=0&playsinline=1`}
        title={video.title}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        onError={() => setEmbedError(true)}
        style={{position:'absolute',inset:0,width:'100%',height:'100%',border:0}}
        data-testid={`iframe-video-${video.id}`}
      />
    </div> : <div style={{position:'relative',aspectRatio:'16 / 9',background:'hsl(var(--secondary))'}}>
      {!thumbnailError ? <img src={`https://i.ytimg.com/vi/${encodeURIComponent(video.videoId)}/hqdefault.jpg`} alt="" loading="lazy" onError={() => setThumbnailError(true)} style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}} data-testid={`img-video-thumbnail-${video.id}`}/> : <div style={{height:'100%',display:'grid',placeItems:'center',color:'hsl(var(--muted-foreground))'}}><Youtube size={35}/></div>}
    </div>}
    <div style={{padding:'14px 15px 15px'}}>
      <strong style={{fontSize:14,display:'block',lineHeight:1.45}}>{video.title}</strong>
      <span style={{fontSize:12,color:'hsl(var(--muted-foreground))',marginTop:5,display:'block'}}>{video.channelName || 'YouTube lecture'}</span>
      {(embedError || playing) && <p role="status" style={{fontSize:11,color:'hsl(var(--muted-foreground))',lineHeight:1.5,margin:'9px 0'}} data-testid={`text-video-fallback-${video.id}`}>
        {embedError ? 'This video could not be embedded. Open it on YouTube to check availability.' : 'If playback is unavailable or embedding is disabled, open the lecture directly on YouTube.'}
      </p>}
      <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
        {!playing && <button className="button button-light" type="button" onClick={() => {setEmbedError(false);setPlaying(true);}} data-testid={`button-embed-video-${video.id}`}><Play size={14} fill="currentColor"/>Play here</button>}
        {playing && !embedError && <button className="button button-light" type="button" onClick={() => setPlaying(false)} data-testid={`button-close-video-${video.id}`}>Close player</button>}
        <a className="button button-outline" href={href} target="_blank" rel="noreferrer" data-testid={`link-watch-youtube-${video.id}`}>Watch on YouTube <ExternalLink size={14}/></a>
      </div>
    </div>
  </article>;
}
