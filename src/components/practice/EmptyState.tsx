import type { ReactNode } from 'react';
import './emptyState.css';

interface Props {
  /**
   * A drawing of this panel with something in it, at the weight of a thing that
   * has not happened yet. See EmptyPreviews.
   */
  preview: ReactNode;
  title: string;
  action?: { label: string; onClick: () => void };
}

/**
 * The shape every "nothing here yet" moment takes.
 *
 * It used to be a mark in a ring, a title, and a sentence describing the screen
 * the player would get if they practised: "Every day you practise lands here,
 * with what you played and how it went." Three panels, three descriptions, all
 * of them asking someone to picture something the app could simply draw.
 *
 * So it draws it. The panel is outlined the way a missing surface is outlined in
 * surfaceBoundary.css, unfilled and dashed, with the shape of the filled screen
 * ghosted inside it. What is left in words is the state itself, which no drawing
 * can assert, and the one tap that ends it.
 */
export function EmptyState({ preview, title, action }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-state-preview">{preview}</div>
      <h3 className="empty-state-title">{title}</h3>
      {action && (
        <button type="button" className="empty-state-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
