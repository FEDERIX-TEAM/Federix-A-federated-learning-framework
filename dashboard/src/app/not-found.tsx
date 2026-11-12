import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export default function NotFound() {
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div style={{ display: "grid", gap: 12, justifyItems: "center" }}>
        <LogoMark size={44} />
        <h1 style={{ fontSize: 28, fontWeight: 680 }}>Page not found</h1>
        <p style={{ color: "var(--muted)" }}>That address doesn&rsquo;t match anything in Federix.</p>
        <Link href="/" style={{ color: "var(--accent)", fontWeight: 560 }}>
          Go to the overview
        </Link>
      </div>
    </main>
  );
}
