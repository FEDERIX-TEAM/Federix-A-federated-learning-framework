import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Users" };

export default function Page() {
  return <Planned icon={ShieldCheck} title="Users" text="Dashboard account management is being built." items={["Invite admins and viewers", "Change roles", "Remove accounts", "Last sign-in at a glance"]} />;
}
