const base = { viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };

const sz = (size) => (size ? { width: size, height: size } : {});

export const HeartIcon = ({ filled }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5c0 6.1-8 11-8 11Z" />
  </svg>
);
export const CommentIcon = () => (
  <svg {...base}>
    <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20.5l1.4-5.3A8.5 8.5 0 1 1 21 11.5Z" />
  </svg>
);
export const ShareIcon = () => (
  <svg {...base}>
    <path d="M12 15V3M8 7l4-4 4 4" />
    <path d="M5 12v6a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-6" />
  </svg>
);
export const ImageIcon = () => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="m21 16-5-5-9 9" />
  </svg>
);
export const BookmarkIcon = ({ filled }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}>
    <path d="M6 3h12v18l-6-4.5L6 21V3Z" />
  </svg>
);
export const HomeIcon = ({ filled }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}>
    <path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z" />
  </svg>
);
export const SearchIcon = () => (
  <svg {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const ReelIcon = ({ filled }) => (
  <svg {...base}>
    <rect x="3" y="3" width="18" height="18" rx="5" fill={filled ? 'currentColor' : 'none'} />
    <path d="M3 9h18M9 3l3 6M15 3l3 6" stroke={filled ? 'var(--bg)' : 'currentColor'} />
    <path d="m10.5 13 4 2.5-4 2.5v-5Z" fill={filled ? 'var(--bg)' : 'currentColor'} stroke="none" />
  </svg>
);
export const BellIcon = ({ filled }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}>
    <path d="M6 17V11a6 6 0 1 1 12 0v6l2 2H4l2-2Z" />
    <path d="M10 21a2 2 0 0 0 4 0" />
  </svg>
);
export const SendIcon = ({ filled }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}>
    <path d="M22 3 2 10.5l7.5 3L12.5 21 22 3Z" />
    <path d="m9.5 13.5 5-5" />
  </svg>
);
export const UserIcon = ({ filled }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);
export const CameraIcon = ({ size }) => (
  <svg {...base} {...sz(size)}>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.7" />
  </svg>
);
export const VideoIcon = () => (
  <svg {...base}>
    <rect x="3" y="6" width="13" height="12" rx="3" />
    <path d="m16 10.5 5-3v9l-5-3" />
  </svg>
);
export const BackIcon = () => (
  <svg {...base}>
    <path d="M15 5 8 12l7 7" />
  </svg>
);
export const CloseIcon = () => (
  <svg {...base}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const FlipIcon = () => (
  <svg {...base}>
    <path d="M4 8h12l-3-3M20 16H8l3 3" />
  </svg>
);
export const PlusIcon = () => (
  <svg {...base}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const MuteIcon = ({ filled }) => (
  <svg {...base}>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" fill={filled ? 'currentColor' : 'none'} />
    {filled ? <path d="m17 9 4 6M21 9l-4 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7" />}
  </svg>
);
export const MoreIcon = () => (
  <svg {...base}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" />
  </svg>
);
export const MailIcon = ({ filled }) => (
  <svg {...base} fill={filled ? 'currentColor' : 'none'}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="m4 7.5 8 5.5 8-5.5" stroke={filled ? 'var(--surface)' : 'currentColor'} />
  </svg>
);
export const LinkIcon = () => (
  <svg {...base}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);
export const SettingsIcon = () => (
  <svg {...base}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </svg>
);
export const LogoutIcon = () => (
  <svg {...base}>
    <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" />
  </svg>
);
export const CheckIcon = () => (
  <svg {...base}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);
export const FlameIcon = () => (
  <svg {...base}>
    <path d="M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4 0 2 1 2.5 1.5 2.5C10 9 10.5 6 12 3Z" />
  </svg>
);
const PHONE = 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z';
export const PhoneIcon = () => (
  <svg {...base}>
    <path d={PHONE} />
  </svg>
);
export const PhoneOffIcon = () => (
  <svg {...base}>
    <path d={PHONE} />
    <path d="M3 3l18 18" />
  </svg>
);
export const MicIcon = ({ off }) => (
  <svg {...base}>
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M19 11a7 7 0 0 1-14 0M12 18v4" />
    {off && <path d="M3 3l18 18" />}
  </svg>
);
export const VideoOffIcon = () => (
  <svg {...base}>
    <rect x="3" y="6" width="13" height="12" rx="3" />
    <path d="m16 10.5 5-3v9l-5-3M3 3l18 18" />
  </svg>
);
