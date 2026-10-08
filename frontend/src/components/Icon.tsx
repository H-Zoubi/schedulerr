// A small stroke icon set (24px grid, drawn to match each other). No dependency needed.

const PATHS = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8.5 3v4M15.5 3v4" /></>,
  inbox: <><path d="M3.5 13.5 6 5.5h12l2.5 8V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z" /><path d="M3.5 13.5H9l1 2h4l1-2h5.5" /></>,
  tasks: <><path d="m4 7 1.6 1.6L8.5 5.7M4 16l1.6 1.6 2.9-2.9" /><path d="M11.5 7h8.5M11.5 16.5H20" /></>,
  board: <><rect x="3.5" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="10" rx="1.5" /><rect x="16.5" y="4" width="4" height="13" rx="1.5" /></>,
  habits: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.3 2.4 2.4 4.6-5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.3-4.3" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  more: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  trash: <><path d="M4.5 7h15M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8l1-12M9 7V4.5h6V7" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  flag: <><path d="M5.5 21V4.5" /><path d="M5.5 4.5h11l-2 4 2 4h-11" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  notes: <><path d="M6.5 3.5h8l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z" /><path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h5" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  bell: <><path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  repeat: <><path d="M17 3.5 20 6.5l-3 3" /><path d="M4 11.5v-1a4 4 0 0 1 4-4h12M7 20.5 4 17.5l3-3" /><path d="M20 12.5v1a4 4 0 0 1-4 4H4" /></>,
  hash: <path d="M9 4 7.5 20M16.5 4 15 20M4.5 9h15.5M4 15h15.5" />,
  grip: <><circle cx="9" cy="6" r="1.1" /><circle cx="15" cy="6" r="1.1" /><circle cx="9" cy="12" r="1.1" /><circle cx="15" cy="12" r="1.1" /><circle cx="9" cy="18" r="1.1" /><circle cx="15" cy="18" r="1.1" /></>,
  sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M9.5 4.5v15" /></>,
  logout: <><path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3" /><path d="m10 16.5 4.5-4.5L10 7.5M14.5 12H4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  sparkle: <><path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.5 10.2 12.6 4.5 10.8 10.2 9z" /><path d="M19 3v3M17.5 4.5h3" /></>,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  undo: <><path d="M9 14.5 4 9.5l5-5" /><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  copy: <><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" /><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" /></>,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" /></>,
  flame: <path d="M12 21a6.5 6.5 0 0 0 6.5-6.5c0-4-3-6.5-4-9.5-1 2-2 3-3.5 3.5C11 6 10 4.5 9.5 3 8 6 5.5 9 5.5 14.5A6.5 6.5 0 0 0 12 21z" />,
  wand: <><path d="m4 20 11-11M14 5l1-2 1 2 2 1-2 1-1 2-1-2-2-1zM18.5 12l.6-1.3 1.4-.7-1.4-.7-.6-1.3-.7 1.3-1.3.7 1.3.7z" /></>,
  filter: <path d="M4 5.5h16l-6.2 7.3V19l-3.6 1.5v-7.7z" />,
  list: <path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  layers: <><path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" /><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" /></>,
  circle: <circle cx="12" cy="12" r="8.5" />,
  upcoming: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8.5 3v4M15.5 3v4M8 14.5h3M8 17h6" /></>,
  done: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.3 2.4 2.4 4.6-5" /></>,
  anytime: <><path d="M4.5 6h15M4.5 12h15M4.5 18h9" /></>,
  wallet: <><rect x="3.5" y="6" width="17" height="13" rx="2.5" /><path d="M3.5 10.5h17" /><path d="M16 15h.5" /></>,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className, strokeWidth = 1.75 }: {
  name: IconName; size?: number; className?: string; strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={"icon-svg" + (className ? " " + className : "")} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
