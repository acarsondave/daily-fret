/**
 * What each empty panel will look like once it has something in it.
 *
 * These are drawings, not data. Every one of them replaced a sentence that
 * described the filled screen in words ("Every day you practise lands here,
 * with what you played and how it went"), and a picture of the screen does that
 * job without asking anyone to imagine anything. They carry no numbers, no
 * dates and no labels, because a ghosted panel that looked like a record would
 * be the app showing practice that never happened.
 *
 * They are drawn in the icon set's own terms: one stroke weight, currentColor,
 * round caps, nothing filled that is not a solid in the real screen either.
 */

const STROKE = 1.75;

/** The week bars and the day rows the history tab fills with. */
export function HistoryPreview() {
  return (
    <svg viewBox="0 0 260 104" className="empty-preview-art" aria-hidden="true">
      <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round">
        {[14, 30, 8, 34, 22, 38, 18, 30].map((h, i) => (
          <line key={i} x1={12 + i * 13} y1={44} x2={12 + i * 13} y2={44 - h} />
        ))}
        <line x1={6} y1={48} x2={116} y2={48} opacity="0.5" />
        {[0, 1].map((row) => (
          <g key={row} transform={`translate(0 ${64 + row * 22})`}>
            <rect x={6} y={0} width={248} height={16} rx={8} fill="none" />
            <line x1={18} y1={8} x2={54} y2={8} />
            <line x1={70} y1={8} x2={110} y2={8} opacity="0.6" />
            <line x1={200} y1={8} x2={242} y2={8} opacity="0.6" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** A drill's own line, climbing, with its rows underneath. */
export function ProgressPreview() {
  return (
    <svg viewBox="0 0 260 104" className="empty-preview-art" aria-hidden="true">
      <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        <line x1={10} y1={54} x2={250} y2={54} opacity="0.4" />
        <polyline fill="none" points="16,48 58,40 100,44 142,28 184,22 240,10" />
        {[[16, 48], [58, 40], [100, 44], [142, 28], [184, 22], [240, 10]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r={2.6} fill="currentColor" stroke="none" />
        ))}
        {[0, 1].map((row) => (
          <g key={row} transform={`translate(0 ${68 + row * 20})`}>
            <line x1={10} y1={8} x2={62} y2={8} />
            <polyline
              fill="none"
              opacity="0.6"
              points={row === 0 ? '190,12 206,6 222,10 250,3' : '190,10 206,12 222,6 250,8'}
            />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** The film spine: takes hanging off the month they were played in. */
export function FilmPreview() {
  return (
    <svg viewBox="0 0 260 104" className="empty-preview-art" aria-hidden="true">
      <g stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        <line x1={20} y1={10} x2={20} y2={94} opacity="0.5" />
        {[0, 1].map((row) => (
          <g key={row} transform={`translate(0 ${14 + row * 44})`}>
            <circle cx={20} cy={18} r={3.4} fill="currentColor" stroke="none" />
            <rect x={40} y={0} width={62} height={36} rx={6} fill="none" />
            <path d="M62 12 L74 18 L62 24 Z" fill="none" />
            <rect x={114} y={0} width={62} height={36} rx={6} fill="none" opacity="0.6" />
            <rect x={188} y={0} width={62} height={36} rx={6} fill="none" opacity="0.35" />
          </g>
        ))}
      </g>
    </svg>
  );
}
