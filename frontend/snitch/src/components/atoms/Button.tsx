import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  fullWidth?: boolean
  children: ReactNode
}

const variantStyles: Record<Variant, string> = {
  primary: 'bg-primary-fixed text-primary border-primary',
  ghost: 'bg-transparent text-on-surface border-on-surface',
  danger: 'bg-error-container text-on-error-container border-error',
}

export default function Button({
  variant = 'primary',
  fullWidth = false,
  children,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        'btn-sketch relative inline-flex items-center justify-center gap-2',
        'px-6 py-3 font-display font-semibold tracking-widest text-sm uppercase',
        'rounded-lg cursor-pointer transition-all duration-150 select-none',
        'active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:active:translate-y-0',
        variantStyles[variant],
        fullWidth ? 'w-full' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </button>
  )
}
