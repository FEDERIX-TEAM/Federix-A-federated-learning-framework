import { AppGate } from "@/components/shell/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppGate>{children}</AppGate>;
}
