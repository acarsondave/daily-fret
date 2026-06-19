import { GithubLogo } from '@phosphor-icons/react';
import './Footer.css';

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-content">
        <span className="footer-quote">
          "Consistency is the heartbeat of progress."
        </span>
        <a href="https://github.com/acarsondave" target="_blank" rel="noopener noreferrer" className="footer-link">
          <GithubLogo size={16} weight="light" />
        </a>
      </div>
    </footer>
  );
}
