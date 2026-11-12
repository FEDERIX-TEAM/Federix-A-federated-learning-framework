import type { Metadata } from "next";
import { Settings2 } from "lucide-react";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Configuration" };

export default function Page() {
  return <Planned icon={Settings2} title="Configuration" text="The configuration editor is being built." items={["Training and utility settings", "Validation before saving", "Change history with diffs", "Changes apply from the next round"]} />;
}
