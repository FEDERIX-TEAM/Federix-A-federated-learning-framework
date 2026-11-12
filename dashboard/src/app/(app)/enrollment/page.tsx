import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Enrollment" };

export default function Page() {
  return <Planned icon={KeyRound} title="Enrollment" text="Enrollment token management is being built." items={["Create limited-use tokens", "Copy a token once, safely", "See uses and expiry", "Revoke a token instantly"]} />;
}
