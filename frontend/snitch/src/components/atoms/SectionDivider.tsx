

interface SectionDividerProps {
  label?: string
}

export default function SectionDivider({ label }: SectionDividerProps) {
  if (!label) return <hr className="border-outline-variant my-3" />

  return (
    <div className="flex items-center gap-3 my-4">
      <div className="flex-1 border-t border-outline-variant" />
      <span className="text-xs font-body font-semibold tracking-widest text-on-surface-variant uppercase">
        {label}
      </span>
      <div className="flex-1 border-t border-outline-variant" />
    </div>
  )
}
