import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Rounds" };

export default function Page() {
  return <Planned icon={Activity} title="Rounds" text="Live round tracking is being built." items={["Start and stop rounds", "Live progress from join to aggregation", "Every update with tier, utility and bytes", "Why the FL server left an update out"]} />;
}
