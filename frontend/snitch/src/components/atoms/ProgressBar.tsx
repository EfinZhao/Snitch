

interface ProgressBarProps {
  value: number // 0–100
  className?: string
}

export default function ProgressBar({ value, className = '' }: ProgressBarProps) {
  return (
    <div
      className={['relative h-2.5 w-full rounded-full border border-outline-variant bg-surface-container overflow-hidden', className].join(' ')}
    >
      <div
        className="hatch-progress h-full rounded-full bg-primary-fixed-dim transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}
