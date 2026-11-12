import type { Metadata } from "next";
import { Gauge } from "lucide-react";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "System" };

export default function Page() {
  return <Planned icon={Gauge} title="System" text="System controls are being built." items={["Service health and uptime", "Maintenance mode", "Cache flush", "Version and environment"]} />;
}
