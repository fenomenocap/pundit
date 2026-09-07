"use client";

import { OPEN_FIXTURES, SETTLED_FIXTURES } from "@/desk/lib/data/fixtures";
import { useDesk } from "@/desk/lib/store";

export function useLiveSlate() {
  const epoch = useDesk((s) => s.slateEpoch);
  const source = useDesk((s) => s.liveSource);
  return { open: OPEN_FIXTURES, settled: SETTLED_FIXTURES, epoch, source };
}
