import type { ReactNode } from 'react';

// The app's icon language, defined once so every mark is drawn on the same
// grid with the same pen. Anything rendered through this wrapper is guaranteed
// to sit at the same optical weight beside anything else, which is the whole
// reason the set exists: a grab-bag of stock glyphs reads as assembled, not
// designed.
//
// Rules of the language:
//  - 24x24 grid, geometry kept inside a 20x20 optical box so icons align with
//    text without extra padding.
//  - 1.75 stroke, round caps and joins, matching the interface's pill radii and
//    hairline borders.
//  - currentColor only. Color is the caller's decision, never the icon's.
//  - Decorative by default: icons sit beside a label or inside a control that
//    already carries an accessible name, so they are hidden from assistive tech
//    unless a `title` is explicitly supplied.

export const ICON_STROKE = 1.75;

export interface IconProps {
  size?: number;
  className?: string;
  /** Override the stroke for a specific optical context. Rarely correct. */
  strokeWidth?: number;
  /** Supply only when the icon is the sole carrier of meaning. */
  title?: string;
  /**
   * Paint this mark a specific color. Prefer inheriting from the control, which
   * is what `currentColor` gives for free; this exists for the few places a
   * glyph is deliberately off the surrounding text color.
   */
  color?: string;
}

interface BaseProps extends IconProps {
  children: ReactNode;
}

export function IconBase({
  size = 20,
  className,
  strokeWidth = ICON_STROKE,
  title,
  color,
  children,
}: BaseProps) {
  return (
    <svg
      className={className ? `icon-glyph ${className}` : 'icon-glyph'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={color ? { color } : undefined}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}
