// Inline SVG flags for the demo teams (no external PNGs/CDNs). Crest monogram fallback otherwise.
import React from "react";

const FLAGS: Record<string, React.ReactNode> = {
  "gb-eng": (
    <svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#fff" /><rect x="25" width="10" height="44" fill="#CE1124" /><rect y="17" width="60" height="10" fill="#CE1124" /></svg>
  ),
  ar: (
    <svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#75AADB" /><rect y="14.6" width="60" height="14.8" fill="#fff" /><circle cx="30" cy="22" r="4.4" fill="#F6B40E" stroke="#85340A" strokeWidth="0.6" /></svg>
  ),
  fr: (<svg viewBox="0 0 60 44"><rect width="20" height="44" fill="#0055A4" /><rect x="20" width="20" height="44" fill="#fff" /><rect x="40" width="20" height="44" fill="#EF4135" /></svg>),
  br: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#009B3A" /><polygon points="30,6 54,22 30,38 6,22" fill="#FEDF00" /><circle cx="30" cy="22" r="8" fill="#002776" /></svg>),
  es: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#AA151B" /><rect y="11" width="60" height="22" fill="#F1BF00" /></svg>),
  de: (<svg viewBox="0 0 60 44"><rect width="60" height="14.6" fill="#000" /><rect y="14.6" width="60" height="14.8" fill="#DD0000" /><rect y="29.4" width="60" height="14.6" fill="#FFCE00" /></svg>),
  pt: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#FF0000" /><rect width="24" height="44" fill="#006600" /><circle cx="24" cy="22" r="5" fill="#FFD700" /></svg>),
  nl: (<svg viewBox="0 0 60 44"><rect width="60" height="14.6" fill="#AE1C28" /><rect y="14.6" width="60" height="14.8" fill="#fff" /><rect y="29.4" width="60" height="14.6" fill="#21468B" /></svg>),
  hr: (<svg viewBox="0 0 60 44"><rect width="60" height="14.6" fill="#FF0000" /><rect y="14.6" width="60" height="14.8" fill="#fff" /><rect y="29.4" width="60" height="14.6" fill="#171796" /></svg>),
  ma: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#C1272D" /><polygon points="30,13 33,22 42,22 34.5,27 37.5,36 30,30 22.5,36 25.5,27 18,22 27,22" fill="none" stroke="#006233" strokeWidth="1.4" /></svg>),
};

export function Flag({ code, team }: { code: string; team: string }) {
  const f = FLAGS[code];
  if (!f) {
    const initials = team.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
    return <span className="crest" title={team}>{initials}</span>;
  }
  return <span className="flag" role="img" aria-label={team}>{f}</span>;
}
