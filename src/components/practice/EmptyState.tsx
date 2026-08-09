import type { ReactNode } from 'react';
import './emptyState.css';

interface Props {
  /* A hand-drawn mark from the app's own icon set, never a stock glyph. */
  icon: ReactNode;
  title: string;
  /* One sentence. What will be here, and what puts it here. */
  body: string;
  action?: { label: string; onClick: () => void };
}

/**
 * The shape every "nothing here yet" moment takes.
 *
 * Each of these used to be a centred grey paragraph and nothing else: no
 * structure, no mark, and no way to act on what it was telling you to do. A
 * screen whose only content is a sentence explaining its own emptiness is the
 * most replaceable thing an app can show, and it is the first thing a new
 * player meets on three of the four Progress tabs.
 *
 * So: a mark, a short statement of what belongs here, and, where the fix is a
 * single tap away, the tap. The copy still promises nothing the app cannot do.
 */
export function EmptyState({ icon, title, body, action }: Props) {
  return (
    <div className="empty-state">
      <span className="empty-state-mark" aria-hidden="true">{icon}</span>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-body">{body}</p>
      {action && (
        <button type="button" className="empty-state-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
