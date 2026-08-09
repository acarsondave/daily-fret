import { GithubLogo } from '@phosphor-icons/react';
import './Footer.css';

// The footer carried a motivational quote ("Consistency is the heartbeat of
// progress"). It was the one piece of copy in the app that told the user
// something it had not earned the right to say, and the product's voice does
// not congratulate anyone for showing up. A quiet wordmark is honest and costs
// the corner of the screen nothing.
export function Footer() {
  return (
    <footer className="app-footer">
      <div className="footer-content">
        <span className="footer-mark">
          Daily<span className="footer-mark-accent">Fret</span>
        </span>
        <a
          href="https://github.com/acarsondave"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
          aria-label="Source on GitHub"
        >
          <GithubLogo size={16} weight="light" />
        </a>
      </div>
    </footer>
  );
}
