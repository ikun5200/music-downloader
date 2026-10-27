import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-sm text-ink placeholder:text-white/30 transition-colors focus:border-violet-400/50 focus:bg-white/[0.06]',
        className
      )}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-sm text-ink placeholder:text-white/30 transition-colors focus:border-violet-400/50 focus:bg-white/[0.06]',
      className
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'select-caret h-9 cursor-pointer rounded-lg border border-white/10 bg-[#17171c] px-3 text-[12.5px] text-ink transition-colors hover:border-white/20 focus:border-violet-400/50 focus:outline-none',
        className
      )}
      {...props}
    />
  )
}
