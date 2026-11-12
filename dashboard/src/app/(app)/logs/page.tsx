import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return <Planned icon={ScrollText} title="Audit log" text="The audit log viewer is being built." items={["Filter by actor, level and event", "Pick a time range", "Details for every event", "Export what you see"]} />;
}
