import { UpdatePasswordForm } from "@/components/update-password-form";
import { AuthPanel, AuthLink } from "@/components/auth/auth-ui";
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  // The reset link has already exchanged its code by the time this renders, so
  // the address is available — it feeds the hidden `username` field the
  // password managers need in order to save against the right account.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims?.email as string | undefined) ?? undefined;

  return (
    <AuthPanel
      eyebrow="Reset Password"
      title="Set a new one."
      description={
        email ? (
          <>
            Choose a new password for{" "}
            <span className="text-foreground">{email}</span>. You&apos;ll stay
            signed in on this device.
          </>
        ) : (
          "Choose a new password for your account. You'll stay signed in on this device."
        )
      }
      footer={<AuthLink href="/">Back to the front page</AuthLink>}
    >
      <UpdatePasswordForm email={email} />
    </AuthPanel>
  );
}
