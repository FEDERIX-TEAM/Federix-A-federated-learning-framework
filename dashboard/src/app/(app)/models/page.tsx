import type { Metadata } from "next";
import { Boxes } from "lucide-react";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Models" };

export default function Page() {
  return <Planned icon={Boxes} title="Models" text="The model registry is being built." items={["Every global model version", "Accuracy and loss per version", "Size and sha256 integrity", "Signed downloads"]} />;
}
