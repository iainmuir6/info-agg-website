"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

/** Mobile-only dashboard filter driven by the category nav.
 *
 *  On a phone the Command Center is one very long column, so tapping SPORTS in
 *  the nav filters the dashboard down to the sports cards instead of leaving
 *  for /sports — the page you were already on becomes the section view, and a
 *  ↗ in the filter bar takes you through to the real page if you want it.
 *
 *  State lives in a provider in the layout because the two halves sit on
 *  opposite sides of the layout/page boundary: the nav sets it, the card list
 *  inside `children` reads it.
 */
type SectionFilterState = {
  active: string | null;
  setActive: (domain: string | null) => void;
  isMobile: boolean;
};

const SectionFilterContext = createContext<SectionFilterState>({
  active: null,
  setActive: () => {},
  isMobile: false,
});

// Tailwind's `md` breakpoint — the same line the layout already splits on.
const MOBILE_QUERY = "(max-width: 767px)";

function subscribeToViewport(onChange: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Viewport is external state, so it is read through useSyncExternalStore —
 *  the server snapshot is `false`, so SSR renders the unfiltered dashboard and
 *  the client narrows only when it actually is a phone. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false
  );
}

export function SectionFilterProvider({ children }: { children: React.ReactNode }) {
  const [active, setActiveRaw] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const setActive = useCallback((domain: string | null) => {
    setActiveRaw((current) => (current === domain ? null : domain));
  }, []);

  // Derived rather than cleared on resize: the filter only ever applies on a
  // phone, so widening shows the full dashboard without touching state, and
  // rotating back restores what the reader had open.
  const value = useMemo(
    () => ({ active: isMobile ? active : null, setActive, isMobile }),
    [active, isMobile, setActive]
  );

  return (
    <SectionFilterContext.Provider value={value}>
      {children}
    </SectionFilterContext.Provider>
  );
}

export function useSectionFilter(): SectionFilterState {
  return useContext(SectionFilterContext);
}
