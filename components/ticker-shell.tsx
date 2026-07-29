"use client";

/** Shared chrome for the footer tickers. Keeping the height and the label box
 *  width in one place is what stops the market and sports rows from drifting
 *  apart; both scale down together on narrow screens. */
export function TickerShell({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden h-7 sm:h-8 flex items-stretch pause-on-hover${
        className ? ` ${className}` : ""
      }`}
    >
      <div className="shrink-0 w-16 sm:w-20 md:w-24 px-2 border-r border-border flex items-center justify-center">
        <span className="text-[8px] sm:text-[9px] font-mono tracking-widest uppercase text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex-1 overflow-hidden relative flex items-center h-full">{children}</div>
    </div>
  );
}
