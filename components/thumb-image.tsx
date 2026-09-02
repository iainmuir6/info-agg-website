"use client";

import { useState } from "react";

/** YouTube serves this grey "no thumbnail" tile at 120x90 whatever size you
 *  asked for, so an `hqdefault.jpg` (480x360) that comes back 120 wide is the
 *  placeholder, not the real frame. `default.jpg` is legitimately 120x90, so it
 *  is excluded or every video that only had a `default` thumbnail would be
 *  hidden — see the fallback order in src/api/media/youtube.py. */
function isYouTubePlaceholder(img: HTMLImageElement, src: string) {
  return img.naturalWidth > 0 && img.naturalWidth <= 120 && !/\/default\.jpg/.test(src);
}

/**
 * A thumbnail that degrades when the remote image is not really there.
 *
 * Every thumbnail on the site is a third-party URL frozen into the database at
 * ETL time — YouTube's `hqdefault.jpg`, Wikipedia's upload URLs. When the
 * upstream item is later deleted or made private, the URL keeps existing and
 * either 404s or (YouTube) returns a grey placeholder with a 200. The usual
 * `{url && <img/>}` guard covers neither: it only handles a NULL column, so a
 * dead URL rendered a broken box or a grey tile plus a console 404.
 *
 * `fallback` stands in when the column is null, the fetch fails, or the
 * response is a known placeholder. Pass nothing to collapse entirely.
 */
export function ThumbImage({
  src,
  className,
  fallback = null,
  alt = "",
  detectYouTubePlaceholder = false,
}: {
  src: string | null | undefined;
  className?: string;
  fallback?: React.ReactNode;
  alt?: string;
  /** Opt in for YouTube thumbnails only; harmless but pointless elsewhere. */
  detectYouTubePlaceholder?: boolean;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={className}
      onError={() => setBroken(true)}
      onLoad={
        detectYouTubePlaceholder
          ? (e) => {
              if (isYouTubePlaceholder(e.currentTarget, src)) setBroken(true);
            }
          : undefined
      }
    />
  );
}
