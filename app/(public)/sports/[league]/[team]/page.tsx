import { redirect } from "next/navigation";

// Legacy route — team pages now live at /{league}/{abbrev}. Team names in old
// links still resolve there (the page matches on name or abbreviation).
export default async function LegacyTeamRedirect({
  params,
}: {
  params: Promise<{ league: string; team: string }>;
}) {
  const { league, team } = await params;
  redirect(`/${league}/${team}`);
}
