import { GithubLogo } from '@phosphor-icons/react';
import './Footer.css';

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-content">
        <p className="footer-quote">
          "Consistency is the heartbeat of progress."
        </p>
        <div className="footer-links">
          <a href="https://github.com/acarsondave" target="_blank" rel="noopener noreferrer" className="footer-link">
            <GithubLogo size={20} weight="light" />
          </a>
        </div>
      </div>
    </footer>
  );
}
