import { useState, useRef, TouchEvent, ReactNode } from 'react'

interface SwipeableProps {
  children: ReactNode
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  leftAction?: { icon: ReactNode; label: string; color: string }
  rightAction?: { icon: ReactNode; label: string; color: string }
  threshold?: number
}

export function Swipeable({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftAction,
  rightAction,
  threshold = 80,
}: SwipeableProps) {
  const [offsetX, setOffsetX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const startX = useRef(0)
  const currentX = useRef(0)

  const handleTouchStart = (e: TouchEvent) => {
    startX.current = e.touches[0].clientX
    setSwiping(true)
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!swiping) return
    currentX.current = e.touches[0].clientX
    const diff = currentX.current - startX.current

    if (diff < 0 && onSwipeLeft) {
      setOffsetX(Math.max(diff, -threshold * 1.5))
    } else if (diff > 0 && onSwipeRight) {
      setOffsetX(Math.min(diff, threshold * 1.5))
    }
  }

  const handleTouchEnd = () => {
    setSwiping(false)
    if (offsetX < -threshold && onSwipeLeft) {
      onSwipeLeft()
    } else if (offsetX > threshold && onSwipeRight) {
      onSwipeRight()
    }
    setOffsetX(0)
  }

  const showLeft = offsetX < -20 && leftAction
  const showRight = offsetX > 20 && rightAction
  const progress = Math.min(Math.abs(offsetX) / threshold, 1)

  return (
    <div className="relative overflow-hidden rounded-xl">
      {(showLeft || showRight) && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background: showLeft
              ? `rgba(239, 68, 68, ${0.15 * progress})`
              : `rgba(16, 185, 129, ${0.15 * progress})`,
          }}
        >
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: showLeft ? '#ef4444' : '#10b981' }}>
            {showLeft ? leftAction?.icon : rightAction?.icon}
            <span>{showLeft ? leftAction?.label : rightAction?.label}</span>
          </div>
        </div>
      )}
      <div
        className="transition-transform"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: swiping ? 'none' : 'transform 0.2s ease-out',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  )
}
