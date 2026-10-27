import { cn } from '@/lib/utils'

export function Progress({
  value,
  className,
  tone = 'violet',
}: {
  value: number
  className?: string
  tone?: 'violet' | 'cyan' | 'green' | 'red'
}) {
  const tones = {
    violet: 'from-violet-500 to-fuchsia-400',
    cyan: 'from-cyan-500 to-sky-400',
    green: 'from-emerald-500 to-teal-400',
    red: 'from-red-500 to-rose-400',
  }
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]', className)}>
      <div
        className={cn('h-full rounded-full bg-gradient-to-r progress-fill', tones[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}
