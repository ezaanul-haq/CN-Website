import { Link, useLocation } from 'wouter';
import { BookOpen, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function SiteShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const active = (path: string) => location === path || (path === '/notes' && location.startsWith('/topic/'));
  return <div className="min-h-[100dvh]">
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand" data-testid="link-home">
          <span className="brand-mark"><BookOpen size={19} strokeWidth={1.8}/></span>
          <span className="brand-word">Civil Nexus<small>MANUU · Hyderabad</small></span>
        </Link>
        <nav className="nav-links" aria-label="Main navigation">
          <Link href="/" className={`nav-link ${active('/')?'active':''}`} aria-current={active('/')?'page':undefined} data-testid="link-home-tab">Home</Link>
          <Link href="/notes" className={`nav-link ${active('/notes')?'active':''}`} aria-current={active('/notes')?'page':undefined} data-testid="link-library">Notes</Link>
          <Link href="/videos" className={`nav-link ${active('/videos')?'active':''}`} aria-current={active('/videos')?'page':undefined} data-testid="link-videos">YouTube</Link>
          <a className="university-link" href="https://manuu.edu.in/" target="_blank" rel="noreferrer">University <ArrowUpRight size={13}/></a>
        </nav>
      </div>
    </header>
    {children}
    <footer className="site-footer">
      <div className="page-shell footer-grid">
        <div className="footer-about">
          <strong>Civil Nexus</strong>
          <p>Civil Nexus is an educational resource platform designed to help Civil Engineering students access notes, learning materials, and video lectures.</p>
        </div>
        <div className="footer-credit">
          <h2>Developers</h2>
          <p>Afzal Raza<br/>Izaanul Haque</p>
        </div>
        <div className="footer-credit">
          <h2>Contributors</h2>
          <p>Irfan Jamil<br/>Arman Ansari</p>
        </div>
      </div>
    </footer>
  </div>;
}
