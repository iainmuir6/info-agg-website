import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { isSafeAuthNextPath } from "@/lib/site-url";

export const metadata: Metadata = { title: "Sign in" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next =
    params.next && isSafeAuthNextPath(params.next) ? params.next : undefined;

  return <LoginForm error={params.error} next={next} />;
}
