import { useEffect, useRef, useState } from 'react';
import { parseTab, tokenizeTabLine, type TabBlock } from '../../lib/tab';
import './tab.css';

interface Props {
  source: string;
}

// One staff. The string names live in a pinned gutter rather than in the
// scrolling text, because a riff is wider than a phone and the moment you reach
// bar three the old renderer had scrolled "e B G D A E" off the left edge,
// leaving six identical rows of dashes and no way to tell which string is which.
function Staff({ block, index }: { block: TabBlock; index: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  // Fade the right edge only when the staff genuinely continues past it, so a
  // riff that fits is never dimmed for no reason.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const overflowing = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setMore((prev) => (prev === overflowing ? prev : overflowing));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [block]);

  if (!block.lines.length) {
    return block.caption ? <p className="tab-caption is-alone">{block.caption}</p> : null;
  }

  return (
    <div className="tab-block">
      {block.caption && <p className="tab-caption">{block.caption}</p>}
      <div className={more ? 'tab-staff-frame has-more' : 'tab-staff-frame'}>
        {/* A scrollable region needs to be reachable without a pointer, or a
            keyboard can never see the second half of the riff. */}
        <div
          ref={scrollRef}
          className="tab-scroll"
          tabIndex={0}
          role="region"
          aria-label={`Guitar tab, staff ${index + 1}`}
        >
          <div className="tab-gutter" aria-hidden="true">
            {/* An empty cell opposite the count row, so the string names stay
                on the same baselines as the strings they label. */}
            {block.timing !== undefined && (
              <span className="tab-string is-timing"> </span>
            )}
            {block.lines.map((line, i) => (
              <span key={i} className="tab-string">
                {line.label}
              </span>
            ))}
          </div>
          <div className="tab-lines">
            {/* The count belongs in the grid, not above it as prose: it only
                means anything while each beat sits over its own fret. */}
            {block.timing !== undefined && (
              <span className="tab-line is-timing">{block.timing}</span>
            )}
            {block.lines.map((line, i) => (
              <span key={i} className="tab-line">
                {tokenizeTabLine(line.content).map((token, j) => (
                  <span key={j} className={`tab-t is-${token.kind}`}>
                    {token.text}
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Renders an authored tab as an actual staff: pinned string names, tight
// leading so the six lines read as one system, and fret numbers carrying the
// weight instead of sitting at the same value as the dashes around them.
export function TabStaff({ source }: Props) {
  const blocks = parseTab(source);
  if (!blocks.length) return null;

  return (
    <div className="tab-staff">
      {blocks.map((block, i) => (
        <Staff key={i} block={block} index={i} />
      ))}
    </div>
  );
}
