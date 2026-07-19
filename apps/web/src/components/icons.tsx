// SVG icons only (never emoji). Stroke icons on currentColor, 1.6px, 20px default.
import React from "react";

type P = { size?: number; className?: string; style?: React.CSSProperties };
const svg = (path: React.ReactNode, vb = "0 0 24 24") => ({ size = 20, className, style }: P) => (
  <svg width={size} height={size} viewBox={vb} fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">{path}</svg>
);

export const IconPlay = svg(<polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />);
export const IconPause = svg(<><rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none" /></>);
export const IconReplay = svg(<><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v4h4" /></>);
export const IconCheck = svg(<polyline points="4 12 10 18 20 5" />);
export const IconShield = svg(<><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><polyline points="9 12 11 14 15 9.5" /></>);
export const IconBolt = svg(<polygon points="13 2 4 14 11 14 10 22 20 9 13 9 13 2" fill="currentColor" stroke="none" />);
export const IconChevron = svg(<polyline points="9 6 15 12 9 18" />);
export const IconArrowDown = svg(<><line x1="12" y1="5" x2="12" y2="19" /><polyline points="6 13 12 19 18 13" /></>);
export const IconLayers = svg(<><polygon points="12 3 21 8 12 13 3 8 12 3" /><polyline points="3 14 12 19 21 14" /></>);
export const IconLock = svg(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const IconPlus = svg(<><line x1="12" y1="6" x2="12" y2="18" /><line x1="6" y1="12" x2="18" y2="12" /></>);
export const IconX = svg(<><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>);
export const IconTarget = svg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>);
export const IconLink = svg(<><path d="M9 15l6-6" /><path d="M11 6l1-1a4 4 0 0 1 6 6l-1 1" /><path d="M13 18l-1 1a4 4 0 0 1-6-6l1-1" /></>);
export const IconWallet = svg(<><path d="M3 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1h-3a3 3 0 0 0 0 6h3v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M17 11h1a1 1 0 0 1 1 1v0a1 1 0 0 1-1 1h-1" /></>);
export const IconDroplet = svg(<path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3Z" />);
export const IconSpinner = svg(<><circle cx="12" cy="12" r="9" opacity="0.25" /><path d="M21 12a9 9 0 0 0-9-9" /></>);
