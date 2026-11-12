import type { Metadata } from "next";
import { Users } from "lucide-react";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Clients" };

export default function Page() {
  return <Planned icon={Users} title="Clients" text="Client management is being built." items={["Search and filter participants", "Ban, unban and delete clients", "Rotate API keys", "Participation and contribution history"]} />;
}
