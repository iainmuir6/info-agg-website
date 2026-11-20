// Records the Info Hub's public demo tour to private/demo-videos/infohub-public.mp4 (git-ignored).
//   pnpm tsx scripts/demo/record.ts public [baseUrl]
// Default base is the local dev server on 127.0.0.1:3007 (demo mode is recorded from the working tree until it is
// deployed; afterwards pass https://info-agg-website.vercel.app). Login: scripts/demo-accounts.ts. Docs: docs/demo-video.md.
import path from "node:path";
import { record } from "./engine";
import { hubSignIn } from "./infohub";
import { publicTour } from "./tours";

const which = process.argv[2];
const baseUrl = process.argv[3] ?? "http://127.0.0.1:3007";
const outDir = path.join(process.cwd(), "private", "demo-videos");

// The tour is read-only: it opens pages and flips view controls, and writes nothing, so there is nothing to reset.
const tours = {
  public: { signIn: hubSignIn("user"), tour: publicTour },
};

async function main() {
  const t = tours[which as keyof typeof tours];
  if (!t) throw new Error("usage: record.ts public [baseUrl]");
  const mp4 = await record({ name: `infohub-${which}`, baseUrl, outDir, ...t });
  console.log(mp4);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
