"use client";

import { useEffect } from "react";
import { OWNER_FLAG } from "@/components/site-analytics";

/** Flags this browser as the owner's. Mount only for the signed-in super_admin. */
export function OwnerMark() {
  useEffect(() => {
    try {
      localStorage.setItem(OWNER_FLAG, "1");
    } catch {
      // Storage blocked: visits stay untagged.
    }
  }, []);
  return null;
}
