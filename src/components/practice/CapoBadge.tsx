import { CapoIcon } from '../icons';
import { useCapoOffset } from '../../hooks/useCapo';

/**
 * Shown in a drill's top bar whenever a capo is configured.
 *
 * A stale capo setting is the failure this whole feature exists to prevent: the
 * detector would be transposing for a capo that is not on the neck, nothing
 * would count, and there would be nothing on screen to explain it. So the
 * setting is never invisible while a drill is running.
 */
export function CapoBadge() {
  const capo = useCapoOffset();
  if (capo === 0) return null;
  return (
    <span className="capo-badge" title="Drills are listening as if a capo is on this fret">
      <CapoIcon size={14} />
      <span>Capo {capo}</span>
    </span>
  );
}
