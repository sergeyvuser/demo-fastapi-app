import type { ReactNode } from 'react'

// Feather's outlines for the card's controls, drawn in place: five icons do
// not earn an icon library. All decorative — the control around each carries
// the name a screen reader reads.
function Icon({ size = 16, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function PauseIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </Icon>
  )
}

export function PlayIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <polygon points="5 3 19 12 5 21 5 3" />
    </Icon>
  )
}

export function CopyIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  )
}

export function MoreIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </Icon>
  )
}

export function EditIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </Icon>
  )
}

export function TrashIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Icon>
  )
}
