"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { HOME_SECTIONS, sectionLabel } from "@/lib/home-sections";

type Props = {
  initialOrder: string[] | null;
  initialHidden: string[];
};

/** Profile-page editor for the Command Center layout: reorder sections with
 *  up/down arrows and toggle visibility. Persists to user_home_prefs. */
export function HomeSectionPrefs({ initialOrder, initialHidden }: Props) {
  const defaultKeys = HOME_SECTIONS.map((s) => s.key as string);
  const normalize = (order: string[] | null) => {
    const known = (order ?? []).filter((k) => defaultKeys.includes(k));
    return [...known, ...defaultKeys.filter((k) => !known.includes(k))];
  };

  const [order, setOrder] = useState<string[]>(normalize(initialOrder));
  const [hidden, setHidden] = useState<Set<string>>(new Set(initialHidden));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function persist(nextOrder: string[], nextHidden: Set<string>) {
    setSaveState("saving");
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("not signed in");
      const { error } = await supabase.from("user_home_prefs").upsert({
        user_id: user.id,
        section_order: nextOrder,
        hidden_sections: [...nextHidden],
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      setTimeout(() => setSaveState("idle"), 2000);
    }
  }

  function move(key: string, dir: -1 | 1) {
    const i = order.indexOf(key);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    persist(next, hidden);
  }

  function toggleHidden(key: string) {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
    persist(order, next);
  }

  function reset() {
    setOrder(defaultKeys);
    const none = new Set<string>();
    setHidden(none);
    persist(defaultKeys, none);
  }

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[9px] font-mono text-muted-foreground">
          Order and visibility of Command Center sections
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-mono text-muted-foreground">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "error" ? "Save failed" : ""}
          </span>
          <button
            onClick={reset}
            className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Reset
          </button>
        </div>
      </div>
      <div className="divide-y divide-border">
        {order.map((key, i) => {
          const isHidden = hidden.has(key);
          return (
            <div key={key} className="flex items-center gap-2 px-3 py-1.5">
              <span className="text-[9px] font-mono text-muted-foreground w-5 shrink-0">{i + 1}.</span>
              <span className={`text-xs font-mono flex-1 ${isHidden ? "line-through text-muted-foreground" : ""}`}>
                {sectionLabel(key)}
              </span>
              <button
                onClick={() => move(key, -1)}
                disabled={i === 0}
                aria-label={`Move ${sectionLabel(key)} up`}
                className="text-xs font-mono px-1.5 py-0.5 border border-border disabled:opacity-30 hover:border-foreground"
              >
                ↑
              </button>
              <button
                onClick={() => move(key, 1)}
                disabled={i === order.length - 1}
                aria-label={`Move ${sectionLabel(key)} down`}
                className="text-xs font-mono px-1.5 py-0.5 border border-border disabled:opacity-30 hover:border-foreground"
              >
                ↓
              </button>
              <button
                onClick={() => toggleHidden(key)}
                aria-label={`${isHidden ? "Show" : "Hide"} ${sectionLabel(key)}`}
                className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 border border-border w-14 hover:border-foreground"
              >
                {isHidden ? "Show" : "Hide"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
