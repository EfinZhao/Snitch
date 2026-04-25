import type { ReactNode } from 'react'

type ChipVariant = 'default' | 'success' | 'warning'

interface ChipProps {
  children: ReactNode
  variant?: ChipVariant
}

const variantStyles: Record<ChipVariant, string> = {
  default: 'border-outline-variant text-on-surface-variant',
  success: 'border-primary text-primary bg-primary-fixed',
  warning: 'border-error text-on-error-container bg-error-container',
}

export default function Chip({ children, variant = 'default' }: ChipProps) {
  return (
    <span
      className={[
        'inline-flex items-center px-2.5 py-0.5 rounded-full border text-xs font-body font-semibold',
        variantStyles[variant],
      ].join(' ')}
    >
      {children}
    </span>
  )
}
