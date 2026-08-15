/** 디자인 시안의 인라인 SVG 아이콘 모음 (14px 내외 stroke 아이콘) */

export const IconStats = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <rect x="1" y="8" width="3" height="5" rx="1" fill="var(--nav-icon)" />
    <rect x="5.5" y="4" width="3" height="9" rx="1" fill="var(--nav-icon)" />
    <rect x="10" y="1" width="3" height="12" rx="1" fill="var(--nav-icon)" />
  </svg>
);

export const IconMap = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <path
      d="M7 12.6C7 12.6 3.2 8.6 3.2 5.8a3.8 3.8 0 1 1 7.6 0C10.8 8.6 7 12.6 7 12.6Z"
      fill="none"
      stroke="var(--nav-icon)"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <circle cx="7" cy="5.8" r="1.4" fill="var(--nav-icon)" />
  </svg>
);

export const IconSettings = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <circle cx="7" cy="7" r="2.1" fill="none" stroke="var(--nav-icon)" strokeWidth="1.4" />
    <path
      d="M7 1.4v2M7 10.6v2M1.4 7h2M10.6 7h2M3 3l1.5 1.5M9.5 9.5L11 11M11 3L9.5 4.5M4.5 9.5L3 11"
      stroke="var(--nav-icon)"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

export const IconWind = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path
      d="M1.5 4.5h6.8a1.9 1.9 0 1 0-1.8-2.5M1.5 7.5h9.6a2 2 0 1 1-1.9 2.6M1.5 10.5h4.6"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

/** 항공사진(위성) 아이콘 */
export const IconAerial = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    <path d="M1.5 9.5l3-3 2.5 2.5 2-2 3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="9.5" cy="5.2" r="1.1" fill="currentColor" />
  </svg>
);

export const IconDownload = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <path d="M6 1.5v6M3.5 5.2 6 7.7l2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M1.5 9.2v0.8A1.5 1.5 0 0 0 3 11.5h6a1.5 1.5 0 0 0 1.5-1.5v-0.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const IconRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
    <path d="M11 6.5a4.5 4.5 0 1 1-1.3-3.2" stroke="rgba(60,40,30,0.65)" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M11 1v2.5H8.5" stroke="rgba(60,40,30,0.65)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconPlay = () => (
  <svg width="14" height="14" viewBox="0 0 14 14">
    <path d="M4 2.2v9.6c0 .7.8 1.1 1.4.7l7-4.8c.5-.4.5-1.1 0-1.4l-7-4.8C4.8 1.1 4 1.5 4 2.2Z" fill="#fff" />
  </svg>
);

export const IconPause = () => (
  <svg width="13" height="13" viewBox="0 0 13 13">
    <rect x="2" y="1.5" width="3.2" height="10" rx="1" fill="#fff" />
    <rect x="7.8" y="1.5" width="3.2" height="10" rx="1" fill="#fff" />
  </svg>
);

export const IconArrowUp = ({ rotate }: { rotate: number }) => (
  <svg width="9" height="9" viewBox="0 0 12 12" style={{ transform: `rotate(${rotate}deg)` }}>
    <path d="M6 11V1.6M6 1.6 3 4.8M6 1.6l3 3.2" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconFolder = () => (
  <svg width="15" height="15" viewBox="0 0 15 15">
    <path
      d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 1.5H12A1.5 1.5 0 0 1 13.5 6v5A1.5 1.5 0 0 1 12 12.5H3A1.5 1.5 0 0 1 1.5 11V4.5Z"
      fill="none"
      stroke="rgba(60,40,30,0.55)"
      strokeWidth="1.4"
    />
  </svg>
);

export const IconChevronLeft = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M6.5 1.5 3 5l3.5 3.5" stroke="rgba(60,40,30,0.7)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconChevronRight = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M3.5 1.5 7 5 3.5 8.5" stroke="rgba(60,40,30,0.7)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconClose = () => (
  <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
    <path d="M1.5 1.5 7.5 7.5M7.5 1.5 1.5 7.5" stroke="rgba(60,40,30,0.7)" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
