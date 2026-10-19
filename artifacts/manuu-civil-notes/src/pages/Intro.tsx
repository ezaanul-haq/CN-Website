import { Link } from 'wouter';
import { ArrowDownRight, ArrowRight, BookOpen, FileCheck2, GraduationCap, Layers3, Youtube } from 'lucide-react';
import { SiteShell } from '@/components/SiteShell';

export default function Intro() {
  return <SiteShell>
    <main className="page-shell intro-page">
      <section className="hero intro-hero">
        <div className="intro-hero-copy">
          <span className="eyebrow" style={{color:'#e6c886'}}>B.TECH CIVIL ENGINEERING <span className="hero-separator">/</span> MANUU, HYDERABAD</span>
          <h1>Your course material, <em>in one place.</em></h1>
          <p>Civil Nexus brings together the notes and lecture links shared for Civil Engineering at Maulana Azad National Urdu University.</p>
          <div className="intro-actions">
            <Link className="button" href="/notes" data-testid="button-home-notes"><BookOpen size={17}/>Explore course notes<ArrowRight size={15}/></Link>
            <Link className="button button-light" href="/videos" data-testid="button-home-videos"><Youtube size={17}/>Browse lectures</Link>
          </div>
        </div>
        <aside className="intro-index" aria-label="How Civil Nexus is organized">
          <div className="index-topline"><span>COURSE INDEX</span><span>MANUU · CE</span></div>
          <div className="index-rule"/>
          <div className="index-row"><span className="index-number">01</span><span><strong>Semester</strong><small>Start with your course term</small></span><Layers3 size={18}/></div>
          <div className="index-row"><span className="index-number">02</span><span><strong>Subject & unit</strong><small>Follow the course structure</small></span><BookOpen size={18}/></div>
          <div className="index-row"><span className="index-number">03</span><span><strong>Topic resources</strong><small>Open notes and published lectures</small></span><ArrowDownRight size={18}/></div>
          <div className="index-foot"><span className="index-dot"/><span>Organized around shared course material</span></div>
        </aside>
      </section>

      <section className="intro-content">
        <header className="intro-section-heading">
          <div><span className="eyebrow">A practical study companion</span><h2 className="section-title">Find what was shared<br/>for your course.</h2></div>
          <p>One familiar place to return to for the material already organized around your Civil Engineering curriculum.</p>
        </header>
        <div className="intro-grid" aria-label="Civil Nexus resources">
          <Link href="/notes" className="intro-card soft-card intro-notes-card" data-testid="card-home-notes">
            <span className="intro-card-icon"><BookOpen size={20}/></span>
            <div><span className="eyebrow">01 / Drive catalogue</span><h2 className="section-title">Course notes</h2><p>Search and filter the Drive-backed catalogue, then browse study notes and practice materials by semester, subject, unit, and topic.</p><span className="intro-card-link">Open the notes catalogue <ArrowRight size={14}/></span></div>
            <ArrowRight className="intro-card-arrow" size={18}/>
          </Link>
          <Link href="/videos" className="intro-card soft-card intro-video-card" data-testid="card-home-videos">
            <span className="intro-card-icon"><Youtube size={20}/></span>
            <div><span className="eyebrow">02 / Published links</span><h2 className="section-title">Lecture videos</h2><p>See published YouTube lectures grouped with their semester, subject, unit, and topic. Play here or continue to YouTube.</p><span className="intro-card-link">Browse published lectures <ArrowRight size={14}/></span></div>
            <ArrowRight className="intro-card-arrow" size={18}/>
          </Link>
        </div>
      </section>

      <section className="intro-promise">
        <div className="promise-mark"><FileCheck2 size={22}/></div>
        <div className="promise-copy">
          <span className="eyebrow">Clear by design</span>
          <h2>Only the resources in the collection.</h2>
          <p>The catalogue reflects the connected Google Drive library, and the lecture page shows published links only. When material is not available, Civil Nexus says so.</p>
        </div>
        <Link className="promise-link" href="/notes" data-testid="link-intro-promise-notes">Go to the library <ArrowRight size={15}/></Link>
      </section>

      <section className="intro-audience">
        <GraduationCap size={21} aria-hidden="true"/>
        <p><strong>For B.Tech Civil Engineering students at MANUU, Hyderabad.</strong> Use the course structure to move from a semester to a topic, then open its existing notes, practice materials, and lecture links.</p>
      </section>
    </main>
  </SiteShell>;
}
