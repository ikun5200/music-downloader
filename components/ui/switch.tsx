'use client'

import { cn } from '@/lib/utils'

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full transition-colors duration-200',
        checked ? 'bg-violet-500' : 'bg-white/[0.14]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60',
        disabled && 'cursor-not-allowed opacity-40'
      )}
    >
      <span
        className={cn(
          'block h-[16px] w-[16px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.35)] transition-transform duration-200',
          'motion-safe:[transition-timing-function:cubic-bezier(0.23,1,0.32,1)]',
          checked ? 'translate-x-[21px]' : 'translate-x-[3px]'
        )}
      />
    </button>
  )
}
