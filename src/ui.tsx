// Small shared controls: the round "seal" buttons used in screen headers.
import type { Strings } from './i18n'

/** Back: an arrow in a seal. With `label`, the word is shown beside the arrow. */
export function BackButton({ t, onClick, label = false }: { t: Strings; onClick: () => void; label?: boolean }) {
  return (
    <button className={label ? 'link back' : 'seal'} aria-label={label ? undefined : t.back} title={t.back} onClick={onClick}>
      <svg className="arrow" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path d="M10.500 5 3.500 12l7 7" />
        <path d="M4 12h16.500" />
        <path d="M14.500 8.500h6M14.500 15.500h6" />
      </svg>
      {label && t.back}
    </button>
  )
}

/** Cancel: an X in a seal. */
export function CancelButton({ t, onClick }: { t: Strings; onClick: () => void }) {
  return (
    <button className="seal close" aria-label={t.cancel} title={t.cancel} onClick={onClick}>
      <svg className="arrow" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path d="M6.500 6.500l11 11M17.500 6.500l-11 11" />
      </svg>
    </button>
  )
}

/** Help and Settings: a "?" and a cog, each in a seal. */
export function Tools({ t, onHelp, onSettings }: { t: Strings; onHelp: () => void; onSettings: () => void }) {
  return (
    <div className="tools">
      <button className="seal" aria-label={t.help} title={t.help} onClick={onHelp}>
        <span aria-hidden="true">?</span>
      </button>
      <button className="seal" aria-label={t.settings} title={t.settings} onClick={onSettings}>
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
          <path d="M18.40 9.70L20.97 9.95L20.97 14.05L18.40 14.30L18.15 14.90L19.79 16.89L16.89 19.79L14.90 18.15L14.30 18.40L14.05 20.97L9.95 20.97L9.70 18.40L9.10 18.15L7.11 19.79L4.21 16.89L5.85 14.90L5.60 14.30L3.03 14.05L3.03 9.95L5.60 9.70L5.85 9.10L4.21 7.11L7.11 4.21L9.10 5.85L9.70 5.60L9.95 3.03L14.05 3.03L14.30 5.60L14.90 5.85L16.89 4.21L19.79 7.11L18.15 9.10Z" />
          <circle cx="12" cy="12" r="2.800" />
        </svg>
      </button>
    </div>
  )
}
