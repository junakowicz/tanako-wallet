// Firebase entry points.
//   api   – /api/** on the app's own domain: the fee service and alert sign-up.
//   watch – once a minute: looks for incoming payments and pushes alerts.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { onRequest } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret } from 'firebase-functions/params'
import { createRelayer } from './core.js'
import { createPush } from './push.js'

initializeApp()
const KEY = defineSecret('RELAYER_PRIVATE_KEY')
const VAPID = defineSecret('VAPID_PRIVATE_KEY')
const REGION = 'europe-west1'

let relayer
let push
const getPush = () => (push ??= createPush({ db: getFirestore(), vapidPrivateKey: VAPID.value().trim() }))

export const api = onRequest(
  // A single instance, so the per-wallet limits and the transaction queue are shared.
  { region: REGION, secrets: [KEY, VAPID], maxInstances: 1, concurrency: 40, memory: '256MiB', timeoutSeconds: 60, invoker: 'public' },
  async (req, res) => {
    const route = req.path.replace(/^\/api/, '').replace(/\/$/, '') || '/'
    let status, body
    try {
      if (route.startsWith('/push/')) {
        ;[status, body] = await getPush().handle(req.method, route, req.body)
      } else {
        relayer ??= createRelayer({ key: KEY.value().trim(), payout: process.env.PAYOUT_ADDRESS })
        ;[status, body] = await relayer.handle(req.method, req.path, req.body)
      }
    } catch (e) {
      console.error('request failed:', e.message)
      ;[status, body] = [503, { error: 'service unavailable' }]
    }
    res.set('cache-control', 'no-store').status(status).json(body)
  },
)

export const watch = onSchedule(
  { schedule: 'every 1 minutes', region: REGION, secrets: [VAPID], maxInstances: 1, memory: '256MiB', timeoutSeconds: 55, retryCount: 0 },
  async () => {
    await getPush().watch()
  },
)
