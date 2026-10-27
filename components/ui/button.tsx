import * as React from 'react'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-b from-violet-500 to-violet-600 text-white shadow-[0_1px_0_rgba(255,255,255,0.18)_inset,0_8px_24px_rgba(139,92,246,0.24)] hover:from-violet-400 hover:to-violet-500',
  secondary:
    'bg-white/[0.06] text-ink border border-white/10 hover:bg-white/[0.1] hover:border-white/[0.16]',
  ghost: 'text-muted hover:text-ink hover:bg-white/[0.06]',
  danger: 'bg-red-500/12 text-red-300 border border-red-500/25 hover:bg-red-500/20',
  outline: 'border border-white/12 text-white/75 hover:bg-white/[0.06] hover:text-white',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-6 text-[15px] rounded-xl gap-2',
  icon: 'h-9 w-9 rounded-lg justify-center',
}

export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className?: string
) {
  return cn(
    'inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors select-none disabled:opacity-45 disabled:pointer-events-none',
    variants[variant],
    sizes[size],
    className
  )
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button ref={ref} className={buttonClass(variant, size, className)} {...props} />
  )
)
Button.displayName = 'Button'
