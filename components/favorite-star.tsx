/** Inline gold star marking a favorited team/stock in a list. Purely a marker
 *  — toggling happens on the team/stock detail page. Renders nothing when the
 *  item isn't favorited so callers can drop it in unconditionally. */
export function FavoriteStar({ show, className = "" }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span
      aria-label="Favorited"
      title="Favorited"
      // Sized a step above the body text it sits next to rather than below it —
      // at the surrounding 9–11px it read as punctuation, not a marker.
      className={`text-favorite shrink-0 leading-none text-[13px] ${className}`}
    >
      ★
    </span>
  );
}
