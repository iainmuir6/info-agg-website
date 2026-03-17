import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/rbac";
import { UpdatePasswordForm } from "@/components/update-password-form";
import { SignOutButton } from "@/components/sign-out-button";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) redirect("/auth/login");

  const claims = claimsData.claims;
  const email = (claims.email as string | undefined) ?? "";
  const admin = await isSuperAdmin();

  const memberSince = claims.iat
    ? new Date((claims.iat as number) * 1000).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tighter" style={{ fontFamily: "Georgia, serif" }}>
          PROFILE
        </h1>
        <div className="mt-1 border-t-4 border-double border-border" />
      </div>

      {/* Account card */}
      <div className="border border-border mb-6">
        <div className="px-4 py-2 border-b border-border">
          <span className="text-[10px] font-mono tracking-widest uppercase font-bold">Account</span>
        </div>
        <div className="px-4 py-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">Email</span>
            <span className="text-xs font-mono">{email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">Role</span>
            <span
              className="text-[10px] font-mono tracking-widest uppercase border px-2 py-0.5"
              style={admin
                ? { borderColor: "hsl(45 90% 52%)", color: "hsl(45 90% 52%)" }
                : { borderColor: "hsl(220 90% 52%)", color: "hsl(220 90% 52%)" }
              }
            >
              {admin ? "Super Admin" : "User"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono tracking-wider text-muted-foreground uppercase">Member since</span>
            <span className="text-xs font-mono">{memberSince}</span>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="border border-border mb-6">
        <div className="px-4 py-2 border-b border-border">
          <span className="text-[10px] font-mono tracking-widest uppercase font-bold">Change Password</span>
        </div>
        <div className="px-4 py-4">
          <UpdatePasswordForm />
        </div>
      </div>

      {/* Sign out */}
      <div className="flex justify-end">
        <SignOutButton />
      </div>
    </div>
  );
}
