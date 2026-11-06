import { ReactNode, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface DropzoneProps {
  onFile: (file: File) => void
  accept?: string
  /** Konten default saat belum ada file. */
  children?: ReactNode
  className?: string
  disabled?: boolean
  multiple?: boolean
}

/**
 * Area upload seragam: klik atau drag & drop. Menangani state drag sendiri
 * supaya halaman tidak mengulang handler onDragOver/onDrop yang sama.
 */
function Dropzone({ onFile, accept, children, className, disabled, multiple }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    onFile(multiple ? files[0] : files[0])
    if (multiple) Array.from(files).forEach((f) => f !== files[0] && onFile(f))
  }

  return (
    <>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (!disabled) handleFiles(e.dataTransfer.files)
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center',
          'transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50',
          dragOver
            ? 'border-primary bg-primary/5 shadow-[0_0_24px_rgba(0,168,255,0.15)]'
            : 'border-border hover:border-primary/40 hover:bg-accent/30',
          className
        )}
      >
        {children}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </>
  )
}

export { Dropzone }
export type { DropzoneProps }
