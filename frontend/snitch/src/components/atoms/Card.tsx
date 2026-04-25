import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  accent?: 'none' | 'warning' | 'info'
}

const accentStyles = {
  none: 'bg-white border-outline-variant',
  warning: 'bg-error-container border-error',
  info: 'bg-primary-fixed border-primary-fixed-dim',
}

export default function Card({ children, className = '', accent = 'none' }: CardProps) {
  return (
    <div
      className={[
        'card-sketch rounded-lg p-4',
        accentStyles[accent],
        className,
      ].join(' ')}
    >
      {children}
    </div>
  )
}
