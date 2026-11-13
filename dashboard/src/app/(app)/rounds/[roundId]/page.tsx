import type { Metadata } from "next";
import { RoundDetailView } from "../_components/RoundDetailView";

export const metadata: Metadata = { title: "Round" };

export default async function RoundPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  return <RoundDetailView roundId={decodeURIComponent(roundId)} />;
}
