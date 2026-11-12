import type { Metadata } from "next";
import { Overview } from "./_overview/Overview";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return <Overview />;
}
