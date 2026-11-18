import { CancelButton } from './ui'
import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import type { Strings } from './i18n'

export function decodeQr(image: ImageData): string | null {
  return jsQR(image.data, image.width, image.height)?.data || null
}

/**
 * Full-screen camera scanner. `onCode` returns true to accept the code and
 * stop, or false to keep scanning (the code was not a payment address).
 */
export function Scanner(p: { t: Strings; onCode: (text: string) => boolean; onClose: () => void }) {
  const { t } = p
  const video = useRef<HTMLVideoElement>(null)
  const onCode = useRef(p.onCode)
  onCode.current = p.onCode
  const [cameraError, setCameraError] = useState(false)
  const [bad, setBad] = useState(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const scan = () => {
      if (stopped) return
      const v = video.current
      if (ctx && v && v.readyState >= 2 && v.videoWidth) {
        const scale = Math.min(1, 640 / v.videoWidth)
        canvas.width = Math.round(v.videoWidth * scale)
        canvas.height = Math.round(v.videoHeight * scale)
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
        const text = decodeQr(ctx.getImageData(0, 0, canvas.width, canvas.height))
        if (text) {
          if (onCode.current(text)) return
          setBad(true)
        }
      }
      raf = requestAnimationFrame(scan)
    }

    if (!navigator.mediaDevices?.getUserMedia) setCameraError(true)
    else
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: 'environment' } })
        .then((s) => {
          if (stopped || !video.current) return s.getTracks().forEach((track) => track.stop())
          stream = s
          video.current.srcObject = s
          void video.current.play()
          raf = requestAnimationFrame(scan)
        })
        .catch(() => setCameraError(true))

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  return (
    <div className="page center">
      <section className="stack">
        {cameraError ? (
          <p className="warn">{t.cameraError}</p>
        ) : (
          <>
            <video ref={video} className="camera" playsInline muted />
            <p className={bad ? 'error' : 'muted'}>{bad ? t.badCode : t.scanHint}</p>
          </>
        )}
        <CancelButton t={t} onClick={p.onClose} />
      </section>
    </div>
  )
}
