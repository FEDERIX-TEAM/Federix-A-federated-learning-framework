import { useId } from "react";

export function LogoMark({ size = 32 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--brand-a)" />
          <stop offset="1" stopColor="var(--brand-b)" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <g stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.9">
        <path d="M32 32 18 18M32 32l14-14M32 32 18 46M32 32l14 14" />
      </g>
      <g fill="#fff">
        <circle cx="32" cy="32" r="7" />
        <circle cx="17" cy="17" r="4.5" />
        <circle cx="47" cy="17" r="4.5" />
        <circle cx="17" cy="47" r="4.5" />
        <circle cx="47" cy="47" r="4.5" />
      </g>
    </svg>
  );
}
