import { Suspense } from "react";
import type { Metadata } from "next";
import { RoundsView } from "./_components/RoundsView";

export const metadata: Metadata = { title: "Rounds" };

export default function RoundsPage() {
  return (
    <Suspense>
      <RoundsView />
    </Suspense>
  );
}
