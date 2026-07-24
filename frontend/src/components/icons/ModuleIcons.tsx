import React from 'react';

// ─── Module icons ───────────────────────────────────────────────────────────
// Shared between the sidebar nav and the home page cards, so every module
// has one consistent icon wherever it's shown.

type IconProps = { className?: string };
const base = 'w-5 h-5 shrink-0';

export function IconBox({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}
export function IconTruck({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10l1 1h1m8-1h2l4-4v-4h-6v8z" />
    </svg>
  );
}
export function IconMonitor({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <rect x="2" y="3" width="20" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4" />
    </svg>
  );
}
export function IconMap({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  );
}
export function IconClipboard({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}
export function IconFactory({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2M5 21H3M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  );
}
export function IconSettings({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
export function IconArchive({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  );
}
export function IconTicket({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
    </svg>
  );
}
export function IconChart({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}
export function IconHeatmap({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <rect x="3" y="3" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="10" y="3" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="17" y="3" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="3" y="10" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="10" y="10" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="17" y="10" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="3" y="17" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="10" y="17" width="4" height="4" rx="0.5" strokeLinecap="round" />
      <rect x="17" y="17" width="4" height="4" rx="0.5" strokeLinecap="round" />
    </svg>
  );
}
export function IconScan({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 2H5a2 2 0 00-2 2v2M17 2h2a2 2 0 012 2v2M7 22H5a2 2 0 01-2-2v-2M17 22h2a2 2 0 002-2v-2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h18" />
    </svg>
  );
}
export function IconList({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  );
}
export function IconEdi({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M9 16h4M7 4H4a1 1 0 00-1 1v14a1 1 0 001 1h16a1 1 0 001-1V9l-5-5H7z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 4v5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 17l2 2 2-2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 19v-5" />
    </svg>
  );
}
export function IconWebDdt({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M9 16h4M7 4H4a1 1 0 00-1 1v14a1 1 0 001 1h16a1 1 0 001-1V9l-5-5H7z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 4v5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 13v6M9 16l3 3 3-3" />
    </svg>
  );
}
export function IconSparkles({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v4m0 10v4m9-9h-4M7 12H3m13.5-6.5l-2.8 2.8M9.3 14.7l-2.8 2.8m0-11l2.8 2.8m6.4 6.4l2.8 2.8" />
    </svg>
  );
}

export type ModuleIcon = (props: IconProps) => React.ReactElement;

export const ICON_MAP: Record<string, ModuleIcon> = {
  IconBox, IconTruck, IconMonitor, IconArchive, IconMap,
  IconClipboard, IconFactory, IconSettings, IconTicket, IconChart,
  IconHeatmap, IconList, IconScan, IconEdi, IconWebDdt, IconSparkles,
};

// ─── Group representative icons ─────────────────────────────────────────────

export const GROUP_ICON_MAP: Record<string, ModuleIcon> = {
  Logistica:  IconTruck,
  Produzione: IconMonitor,
  Qualità:    IconClipboard,
  Dashboard:  IconChart,
  IT:         IconSettings,
};
