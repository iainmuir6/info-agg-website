import { UpdatePasswordForm } from "@/components/update-password-form";

export default function Page() {
  return (
    <div className="w-full max-w-md border border-border">
      <div
        className="px-3 py-1.5 border-b border-border"
        style={{ borderLeftColor: "hsl(220 90% 52%)", borderLeftWidth: 3 }}
      >
        <span className="text-[10px] font-mono tracking-widest uppercase font-bold">
          Reset Password
        </span>
      </div>
      <div className="px-3 py-3 space-y-2.5">
        <p className="text-[11px] font-mono text-muted-foreground">
          Enter a new password for your account.
        </p>
        <UpdatePasswordForm />
      </div>
    </div>
  );
}
