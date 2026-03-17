// AppShell already handles tablet-mode layout detection (no sidebar, full-screen bg)
export default function TabletLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
