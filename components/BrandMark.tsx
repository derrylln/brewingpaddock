/**
 * The Brewing Paddock mark: three orange waves over red/white bands, as in the
 * poster artwork. Drawn as SVG so it stays crisp and adapts to either theme.
 */
export default function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id="bp-band-clip">
          <rect x="7" y="11" width="50" height="42" rx="1.5" />
        </clipPath>
      </defs>
      <g clipPath="url(#bp-band-clip)">
        <rect x="7" y="11" width="50" height="42" fill="#ffffff" />
        <rect x="7" y="17" width="50" height="9" fill="#e4002b" />
        <rect x="7" y="34" width="50" height="9" fill="#e4002b" />
      </g>
      <g
        fill="none"
        stroke="#f5a11c"
        strokeWidth="9.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22.5 15c-3.6 5.4 3.6 8.6 0 14s3.6 8.6 0 14" />
        <path d="M32 15c-3.6 5.4 3.6 8.6 0 14s3.6 8.6 0 14" />
        <path d="M41.5 15c-3.6 5.4 3.6 8.6 0 14s3.6 8.6 0 14" />
      </g>
    </svg>
  );
}
