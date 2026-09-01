"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSectionFilter } from "@/components/section-filter";

export type NavLink = { href: string; label: string; accent: string; domain: string };

/**
 * Category nav. On a phone, while on the dashboard, a tap filters the
 * dashboard to that category instead of navigating away — the active label
 * lights up in its accent colour, and tapping it again clears the filter.
 *
 * Everywhere else (desktop, or any page that is not the dashboard) these stay
 * ordinary links, so the nav never loses its primary job.
 */
export function CategoryNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  const { active, setActive, isMobile } = useSectionFilter();
  const onDashboard = pathname === "/";
  const filtering = isMobile && onDashboard;

  return (
    <nav className="px-2 sm:px-6 flex items-center">
      <div className="flex items-center w-full sm:w-auto sm:gap-1">
        {links.map((item) => {
          const isActive = filtering && active === item.domain;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={
                filtering
                  ? (e) => {
                      e.preventDefault();
                      setActive(item.domain);
                    }
                  : undefined
              }
              aria-pressed={filtering ? isActive : undefined}
              className={`relative flex-1 sm:flex-none text-center px-2 sm:px-4 py-2.5 text-[11px] sm:text-xs font-mono tracking-widest uppercase transition-colors group ${
                isActive ? "font-bold" : "text-muted-foreground hover:text-foreground"
              }`}
              style={isActive ? { color: item.accent } : undefined}
            >
              {item.label}
              <span
                className={`absolute bottom-0 left-0 right-0 h-0.5 transition-transform origin-left ${
                  isActive ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                }`}
                style={{ backgroundColor: item.accent }}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
