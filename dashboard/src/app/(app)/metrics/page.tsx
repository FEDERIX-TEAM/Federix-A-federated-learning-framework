import type { Metadata } from "next";
import { LineChart } from "lucide-react";
import { Planned } from "@/components/Planned";

export const metadata: Metadata = { title: "Metrics" };

export default function Page() {
  return <Planned icon={LineChart} title="Metrics" text="Convergence, communication and fairness charts are being built." items={["Accuracy and loss per round", "Megabytes sent vs. saved by compression", "Utility and contribution by client", "Fairness across label distributions"]} />;
}
