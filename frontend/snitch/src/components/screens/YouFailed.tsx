import Button from '../atoms/Button'
import SectionDivider from '../atoms/SectionDivider'

export default function YouFailed() {
  return (
    <div className="flex flex-col min-h-full px-6 py-10 justify-between gap-12">
      <div className="flex flex-col items-center gap-8">
        <p className="font-body text-sm text-on-surface-variant tracking-widest uppercase">
          You Failed
        </p>

        {/* Broken piggy bank */}
        <div className="w-52 h-52 rounded-full border-2 border-outline-variant bg-surface-container flex items-center justify-center overflow-hidden">
          <span
            className="select-none"
            style={{ fontSize: '100px', lineHeight: 1, filter: 'grayscale(20%)' }}
            role="img"
            aria-label="broken piggy bank"
          >
            🐷
          </span>
        </div>

        {/* Amount */}
        <p className="font-display font-semibold text-4xl text-on-surface tabular-nums">
          <span className="text-2xl text-on-surface-variant font-body font-normal">$ </span>
          25.00
        </p>

        <SectionDivider label="Penalty Applied" />

        <p className="font-body italic text-base text-on-surface-variant text-center leading-relaxed max-w-xs">
          "I'm not mad, just disappointed. That's five lattes you just handed over for a TikTok scroll."
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Button variant="ghost" fullWidth>Accept Defeat</Button>
        <Button variant="primary" fullWidth>View Stats</Button>
      </div>
    </div>
  )
}
