import { PLATFORM_COLORS, PLATFORM_NAMES, type Platform } from '@/lib/constants'
import { cn } from '@/lib/utils'

export function PlatformBadge({
  platform,
  className,
  showName = true,
}: {
  platform: Platform
  className?: string
  showName?: boolean
}) {
  const color = PLATFORM_COLORS[platform] || '#8b5cf6'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        className
      )}
      style={{
        color,
        borderColor: `${color}33`,
        backgroundColor: `${color}14`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {showName ? PLATFORM_NAMES[platform] : null}
    </span>
  )
}
