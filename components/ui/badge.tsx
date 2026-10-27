import * as React from 'react'
import { cn } from '@/lib/utils'

export function Badge({
  className,
  tone = 'neutral',
  children,
}: {
  className?: string
  tone?: 'neutral' | 'violet' | 'cyan' | 'green' | 'red' | 'amber'
  children: React.ReactNode
}) {
  const tones = {
    neutral: 'bg-white/[0.05] text-white/55 border-white/[0.08]',
    violet: 'bg-violet-500/12 text-violet-300 border-violet-400/20',
    cyan: 'bg-cyan-500/12 text-cyan-300 border-cyan-400/20',
    green: 'bg-emerald-500/12 text-emerald-300 border-emerald-400/20',
    red: 'bg-red-500/12 text-red-300 border-red-400/20',
    amber: 'bg-amber-500/12 text-amber-300 border-amber-400/20',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
