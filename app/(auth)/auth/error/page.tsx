import { AuthPanel, AuthLink } from "@/components/auth/auth-ui";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthPanel
      eyebrow="Auth Error"
      title="That didn't work."
      description="The link may have expired, already been used, or been opened in a different browser than the one that requested it."
      footer={
        <>
          <AuthLink href="/auth/login">Sign in</AuthLink> ·{" "}
          <AuthLink href="/auth/forgot-password">Send a new link</AuthLink>
        </>
      }
    >
      <div className="border border-border">
        <div className="px-2.5 py-1.5 border-b border-border">
          <span className="text-[9px] font-mono tracking-widest uppercase text-muted-foreground">
            Detail
          </span>
        </div>
        <p className="px-2.5 py-2 text-[11px] font-mono break-words text-muted-foreground">
          {params?.error ?? "An unspecified error occurred."}
        </p>
      </div>
    </AuthPanel>
  );
}
