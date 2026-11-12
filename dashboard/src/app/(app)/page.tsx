import type { Metadata } from "next";
import { Welcome } from "./Welcome";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return <Welcome />;
}
