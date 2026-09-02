import { AuthPanel, AuthLink } from "@/components/auth/auth-ui";

export default function Page() {
  return (
    <AuthPanel
      eyebrow="Account Created"
      title="One more step."
      description="We've sent a confirmation link to the address you signed up with. Follow it and your edition opens straight away."
      footer={
        <>
          Link never arrived? <AuthLink href="/auth/sign-up">Try again</AuthLink>
        </>
      }
    >
      <ol className="flex flex-col gap-2 text-[11px] font-mono text-muted-foreground">
        {[
          "Open the email from Info Hub",
          "Tap the confirmation link",
          "You're signed in — pick your teams and tickers",
        ].map((step, i) => (
          <li key={step} className="flex gap-2.5">
            <span className="text-foreground tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </AuthPanel>
  );
}
