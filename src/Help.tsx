// Help: each task as a short run of posters, one step per poster, with a
// large numeral, a moving pictogram, a headline and one sentence.
import { useState, type ReactNode } from 'react'
import type { Strings } from './i18n'
import { BackButton, CancelButton } from './ui'

export type Topic = 'pay' | 'add' | 'out' | 'safe'
const TOPICS: Topic[] = ['pay', 'add', 'out', 'safe']

const BUY_URL = 'https://p2p.binance.com/en/trade/all-payments/USDC?fiat=MGA'
const SELL_URL = 'https://p2p.binance.com/en/trade/sell/USDC?fiat=MGA&payment=all-payments'

export function Help(p: { t: Strings; start?: Topic; onClose: () => void }) {
  const { t } = p
  const [topic, setTopic] = useState<Topic | null>(p.start ?? null)
  const [step, setStep] = useState(0)

  const titles: Record<Topic, string> = { pay: t.guidePay, add: t.addHelp, out: t.guideOut, safe: t.guideSafe }
  const fill = (s: string) =>
    s
      .replace('{charge}', t.charge)
      .replace('{receive}', t.receive)
      .replace('{send}', t.cashOut)
      .replace('{settings}', t.settings)
      .replace('{backup}', t.backup)
      .replace('{restore}', t.restore)
  // Opened from another screen for one guide: leaving the guide returns there.
  const leave = () => (p.start ? p.onClose() : (setTopic(null), setStep(0)))

  if (!topic)
    return (
      <div className="page">
        <header className="top">
          <h2>{t.help}</h2>
          <BackButton t={t} onClick={p.onClose} />
        </header>
        <p className="muted">{t.helpIntro}</p>
        <div className="stack topics">
          {TOPICS.map((k, i) => (
            <button key={k} className="secondary" onClick={() => setTopic(k)}>
              <b aria-hidden="true">{i + 1}</b>
              <span>{titles[k]}</span>
            </button>
          ))}
        </div>
        <h3 className="faq-title">{t.faq.title}</h3>
        <div className="stack">
          {t.faq.items.map(([q, answer]) => (
            <details key={q} className="card help">
              <summary>{q}</summary>
              <p className="small" style={{ marginTop: 10 }}>
                {fill(answer)}
              </p>
            </details>
          ))}
        </div>
      </div>
    )

  const steps = t.guides[topic]
  const last = step === steps.length - 1
  const [head, body] = steps[step]
  const link = topic === 'add' ? BUY_URL : topic === 'out' ? SELL_URL : null

  return (
    <div className="page">
      <header className="top">
        <h2>{titles[topic]}</h2>
        <CancelButton t={t} onClick={leave} />
      </header>

      {/* The key restarts the entrance and the pictogram on every step. */}
      <section className="card poster" key={`${topic}${step}`} aria-live="polite">
        <div className="poster-no" aria-hidden="true">
          {step + 1}
        </div>
        <div className="poster-art">{scene(topic, step)}</div>
        <h2>{head}</h2>
        <p>{fill(body)}</p>
      </section>

      <div className="dots" aria-hidden="true">
        {steps.map((_, i) => (
          <i key={i} className={i === step ? 'on' : ''} />
        ))}
      </div>

      {last && link && (
        <a className="filebtn" href={link} target="_blank" rel="noreferrer">
          {t.openBinance} ↗
        </a>
      )}
      <div className="row two">
        <button className="secondary" onClick={() => (step === 0 ? leave() : setStep(step - 1))}>
          {t.back}
        </button>
        <button className="primary" onClick={() => (last ? leave() : setStep(step + 1))}>
          {last ? t.done : t.next}
        </button>
      </div>
    </div>
  )
}

function scene(topic: Topic, step: number): ReactNode {
  const all: Record<Topic, ReactNode[]> = {
    pay: [<Amount />, <Scan />, <Seal />],
    add: [<Trade from="Ar" to="$" />, <Network />, <Fly toPhone />],
    out: [<Network />, <Fly />, <Trade from="$" to="Ar" />],
    safe: [<Paper />, <Hide />, <Restore />],
  }
  return all[topic][step]
}

/* ---- Pictograms: line drawings in the note's ink, 240 × 150. ---- */

const Art = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 240 150" role="img" aria-hidden="true">
    {children}
  </svg>
)

const Phone = ({ x, children }: { x: number; children?: ReactNode }) => (
  <g transform={`translate(${x} 12)`}>
    <rect className="hp-body" width="72" height="126" rx="9" />
    <path className="hp-ink" d="M28 9h16" />
    {children}
  </g>
)

/** A coin. The outer group is free for an animation; the inner one places it. */
const Coin = ({ x, y, label, className }: { x: number; y: number; label: string; className?: string }) => (
  <g className={className}>
    <g transform={`translate(${x} ${y})`}>
      <circle className="hp-gold" r="15" />
      <text className="hp-txt">{label}</text>
    </g>
  </g>
)

/** The exchange, drawn as a small counter with a roof. */
const Exchange = ({ x }: { x: number }) => (
  <g transform={`translate(${x} 38)`}>
    <path className="hp-body" d="M0 24 33 0l33 24v50H0z" />
    <text className="hp-txt hp-small" x="33" y="50">
      Binance
    </text>
  </g>
)

const Arrow = ({ x, y, w }: { x: number; y: number; w: number }) => (
  <>
    <path className="hp-ink hp-flow" strokeDasharray="6 7" d={`M${x} ${y}h${w - 4}`} />
    <path className="hp-ink" d={`M${x + w - 9} ${y - 7}l9 7-9 7`} />
  </>
)

const Qr = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    {[
      [0, 0],
      [28, 0],
      [0, 28],
    ].map(([a, b]) => (
      <g key={`${a}${b}`}>
        <rect className="hp-thin" x={a} y={b} width="14" height="14" />
        <rect className="hp-dot" x={a + 5} y={b + 5} width="4" height="4" />
      </g>
    ))}
    {[
      [19, 2],
      [19, 12],
      [2, 19],
      [12, 20],
      [20, 20],
      [30, 19],
      [37, 26],
      [20, 30],
      [29, 36],
      [37, 37],
    ].map(([a, b]) => (
      <rect key={`${a}${b}`} className="hp-dot" x={a} y={b} width="5" height="5" />
    ))}
  </g>
)

const TanakoMark = () => (
  <text className="hp-mark" x="36" y="66">
    T
  </text>
)

function Amount() {
  return (
    <Art>
      <Phone x={84}>
        <rect className="hp-thin" x="10" y="20" width="52" height="26" />
        {['2', '0', '0'].map((d, i) => (
          <text key={i} className="hp-txt hp-type" style={{ animationDelay: `${i * 0.45}s` }} x={23 + i * 13} y="33">
            {d}
          </text>
        ))}
        {[0, 1, 2].flatMap((r) =>
          [0, 1, 2].map((c) => (
            <rect
              key={`${r}${c}`}
              className={`hp-key${r === 1 && c === 1 ? ' hp-press' : ''}`}
              x={13 + c * 17}
              y={56 + r * 17}
              width="12"
              height="12"
            />
          )),
        )}
      </Phone>
    </Art>
  )
}

function Scan() {
  return (
    <Art>
      <Phone x={26}>
        <Qr x={15} y={38} />
      </Phone>
      <Arrow x={106} y={75} w={28} />
      <Phone x={142}>
        <path className="hp-ink" d="M12 44V32h12M48 32h12v12M60 86v12H48M24 98H12V86" />
        <path className="hp-scanline" d="M14 40h44" />
      </Phone>
    </Art>
  )
}

function Seal() {
  return (
    <Art>
      <circle className="hp-ring" cx="120" cy="75" r="58" />
      <g className="hp-stamp">
        <circle className="hp-green" cx="120" cy="75" r="42" />
        <path className="hp-tick" d="M100 77l14 14 27-31" />
      </g>
    </Art>
  )
}

/** One coin goes into the exchange, the other comes out. */
function Trade({ from, to }: { from: string; to: string }) {
  return (
    <Art>
      <Coin x={36} y={90} label={from} className="hp-enter" />
      <Coin x={204} y={90} label={to} className="hp-exit" />
      <Exchange x={87} />
      <Arrow x={58} y={128} w={124} />
    </Art>
  )
}

function Network() {
  return (
    <Art>
      <rect className="hp-body" x="48" y="10" width="144" height="130" />
      <text className="hp-txt" x="120" y="28">
        USDC
      </text>
      <path className="hp-thin" d="M48 42h144" />
      <circle className="hp-thin" cx="68" cy="58" r="5" />
      <path className="hp-thin" d="M82 58h70" />
      <rect className="hp-green hp-pick" x="56" y="72" width="128" height="30" />
      <text className="hp-txt hp-white" x="108" y="87">
        Polygon
      </text>
      <path className="hp-tick hp-check" d="M154 87l6 6 12-14" />
      <circle className="hp-thin" cx="68" cy="120" r="5" />
      <path className="hp-thin" d="M82 120h56" />
    </Art>
  )
}

/** A coin travels between the exchange and the Tanako phone. */
function Fly({ toPhone = false }: { toPhone?: boolean }) {
  return (
    <Art>
      {toPhone ? <Exchange x={14} /> : <Exchange x={160} />}
      <Phone x={toPhone ? 154 : 14}>
        <TanakoMark />
      </Phone>
      <Arrow x={96} y={112} w={48} />
      <Coin x={98} y={64} label="$" className="hp-fly" />
    </Art>
  )
}

function Paper() {
  return (
    <Art>
      <rect className="hp-body" x="72" y="10" width="96" height="130" />
      {[0, 1].flatMap((c) =>
        [0, 1, 2, 3, 4, 5].map((r) => (
          <path
            key={`${c}${r}`}
            className="hp-ink hp-line"
            style={{ animationDelay: `${(c * 6 + r) * 0.22}s` }}
            d={`M${86 + c * 42} ${30 + r * 18}h26`}
          />
        )),
      )}
    </Art>
  )
}

function Hide() {
  return (
    <Art>
      <g className="hp-drop">
        <rect className="hp-body" x="52" y="8" width="56" height="66" />
        <path className="hp-thin" d="M62 24h36M62 36h36M62 48h36M62 60h24" />
      </g>
      <rect className="hp-body" x="30" y="70" width="100" height="68" />
      <path className="hp-ink" d="M30 90h100" />
      <rect className="hp-dot" x="70" y="100" width="20" height="16" />
      <path className="hp-ink" d="M74 100v-5a6 6 0 0 1 12 0v5" />
      <rect className="hp-body" x="170" y="42" width="42" height="66" rx="6" />
      <circle className="hp-ink" cx="191" cy="75" r="9" />
      <path className="hp-no" d="M162 114 220 36" />
    </Art>
  )
}

function Restore() {
  return (
    <Art>
      <rect className="hp-body" x="16" y="34" width="60" height="82" />
      <path className="hp-thin" d="M26 50h40M26 62h40M26 74h40M26 86h40M26 98h28" />
      <Arrow x={86} y={75} w={50} />
      <Phone x={148} />
      <Coin x={184} y={80} label="$" className="hp-pop" />
    </Art>
  )
}
