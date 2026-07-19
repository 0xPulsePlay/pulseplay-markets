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
  it: (<svg viewBox="0 0 60 44"><rect width="20" height="44" fill="#009246" /><rect x="20" width="20" height="44" fill="#fff" /><rect x="40" width="20" height="44" fill="#CE2B37" /></svg>),
  be: (<svg viewBox="0 0 60 44"><rect width="20" height="44" fill="#000" /><rect x="20" width="20" height="44" fill="#FAE042" /><rect x="40" width="20" height="44" fill="#ED2939" /></svg>),
  mx: (<svg viewBox="0 0 60 44"><rect width="20" height="44" fill="#006847" /><rect x="20" width="20" height="44" fill="#fff" /><rect x="40" width="20" height="44" fill="#CE1126" /><circle cx="30" cy="22" r="4" fill="#8B5A2B" /></svg>),
  sn: (<svg viewBox="0 0 60 44"><rect width="20" height="44" fill="#00853F" /><rect x="20" width="20" height="44" fill="#FDEF42" /><rect x="40" width="20" height="44" fill="#E31B23" /><polygon points="30,17 31.8,22.6 37.6,22.6 32.9,26 34.7,31.6 30,28.2 25.3,31.6 27.1,26 22.4,22.6 28.2,22.6" fill="#00853F" /></svg>),
  co: (<svg viewBox="0 0 60 44"><rect width="60" height="22" fill="#FCD116" /><rect y="22" width="60" height="11" fill="#003893" /><rect y="33" width="60" height="11" fill="#CE1126" /></svg>),
  jp: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#fff" /><circle cx="30" cy="22" r="12.5" fill="#BC002D" /></svg>),
  us: (<svg viewBox="0 0 60 44">
    <rect width="60" height="44" fill="#fff" />
    {[0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} y={i * (44 / 13)} width="60" height={44 / 13} fill="#B22234" />)}
    <rect width="26" height="24" fill="#3C3B6E" />
  </svg>),
  uy: (<svg viewBox="0 0 60 44">
    <rect width="60" height="44" fill="#fff" />
    {[1, 3, 5, 7].map((i) => <rect key={i} y={i * (44 / 9)} width="60" height={44 / 9} fill="#0038A8" />)}
    <rect width="22" height="22" fill="#fff" /><circle cx="11" cy="11" r="6" fill="#FCD116" />
  </svg>),
  nz: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#00247D" /><rect width="26" height="18" fill="#00247D" />
    <g fill="#fff"><circle cx="45" cy="10" r="2.2" /><circle cx="50" cy="20" r="2.6" /><circle cx="41" cy="26" r="2" /><circle cx="49" cy="32" r="1.8" /></g>
    <g fill="#CC142B"><circle cx="45" cy="10" r="1.3" /><circle cx="50" cy="20" r="1.5" /><circle cx="41" cy="26" r="1.1" /><circle cx="49" cy="32" r="1" /></g>
  </svg>),
  in: (<svg viewBox="0 0 60 44"><rect width="60" height="14.6" fill="#FF9933" /><rect y="14.6" width="60" height="14.8" fill="#fff" /><rect y="29.4" width="60" height="14.6" fill="#138808" /><circle cx="30" cy="22" r="4" fill="none" stroke="#000080" strokeWidth="0.8" /></svg>),
  at: (<svg viewBox="0 0 60 44"><rect width="60" height="14.6" fill="#ED2939" /><rect y="14.6" width="60" height="14.8" fill="#fff" /><rect y="29.4" width="60" height="14.6" fill="#ED2939" /></svg>),
  ch: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#D52B1E" /><rect x="25" y="12" width="10" height="20" fill="#fff" /><rect x="18" y="19" width="24" height="6" fill="#fff" /></svg>),
  pl: (<svg viewBox="0 0 60 44"><rect width="60" height="22" fill="#fff" /><rect y="22" width="60" height="22" fill="#DC143C" /></svg>),
  ca: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#fff" /><rect width="15" height="44" fill="#FF0000" /><rect x="45" width="15" height="44" fill="#FF0000" /><polygon points="30,13 32,20 38,18 35,24 40,26 34,28 35,34 30,30 25,34 26,28 20,26 25,24 22,18 28,20" fill="#FF0000" /></svg>),
  qa: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#8D1B3D" /><polygon points="0,0 18,0 12,4.4 18,8.8 12,13.2 18,17.6 12,22 18,26.4 12,30.8 18,35.2 12,39.6 18,44 0,44" fill="#fff" /></svg>),
  "gb-sct": (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#005EB8" /><polygon points="0,0 6,0 60,40 60,44 54,44 0,4" fill="#fff" /><polygon points="60,0 54,0 0,40 0,44 6,44 60,4" fill="#fff" /></svg>),
  au: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#00247D" />
    <g fill="#fff"><circle cx="46" cy="9" r="2.4" /><circle cx="51" cy="18" r="2.8" /><circle cx="42" cy="24" r="2.2" /><circle cx="50" cy="31" r="2" /><circle cx="43" cy="34" r="1.6" /></g>
  </svg>),
  sa: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#006C35" /><rect x="10" y="19" width="40" height="3" fill="#fff" /></svg>),
  se: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#006AA7" /><rect x="20" width="8" height="44" fill="#FECC00" /><rect y="18" width="60" height="8" fill="#FECC00" /></svg>),
  dk: (<svg viewBox="0 0 60 44"><rect width="60" height="44" fill="#C60C30" /><rect x="18" width="8" height="44" fill="#fff" /><rect y="18" width="60" height="8" fill="#fff" /></svg>),
};

export function Flag({ code, team }: { code: string; team: string }) {
  const f = FLAGS[code];
  if (!f) {
    const initials = team.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
    return <span className="crest" title={team}>{initials}</span>;
  }
  return <span className="flag" role="img" aria-label={team}>{f}</span>;
}
