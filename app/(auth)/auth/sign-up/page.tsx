import type { Metadata } from "next";
import { SignUpForm } from "@/components/sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  return <SignUpForm />;
}
