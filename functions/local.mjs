// Runs the fee service on this computer, for development.
// Run: RELAYER_PRIVATE_KEY=0x... node functions/local.mjs   (the app's dev server proxies /api to it)
import { createServer } from 'node:http'
import { createRelayer } from './core.js'

const PORT = Number(process.env.RELAYER_PORT) || 8787
const relayer = createRelayer({ key: process.env.RELAYER_PRIVATE_KEY, payout: process.env.PAYOUT_ADDRESS })

createServer(async (req, res) => {
  let body
  if (req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > 8192) break
    }
    try {
      body = JSON.parse(raw)
    } catch {
      body = undefined
    }
  }
  const [status, json] = await relayer.handle(req.method, new URL(req.url, 'http://x').pathname, body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(json))
}).listen(PORT, () => console.log(`Tanako fee service on :${PORT}, wallet ${relayer.address}`))
