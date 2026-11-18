# Tanako Wallet

A wallet for Madagascar that runs in the phone's browser: get paid in digital dollars (USDC on Polygon) and bitcoin, and keep the money in your own hand. In Malagasy, French and English.

Live at <https://tanako-wallet.web.app>.

- **No account.** The wallet is 12 words, created and kept on the phone, locked with a PIN. Tanako never sees them.
- **One small fee per transfer**, paid in USDC. The sender needs no other coin.
- **Works without Tanako.** The same 12 words open the money in any other wallet.

What the app stores, and how to remove it, is in the [privacy text](https://tanako-wallet.web.app/privacy.html).

## Layout

| Path | What it is |
| --- | --- |
| `src/` | The app: React and TypeScript, built with Vite |
| `functions/` | The server, on Firebase: the fee service that relays signed transfers, and payment alerts |
| `public/` | Icons, the web app manifest and the service worker for alerts |

## Run it

```bash
npm install
npm run dev
```

Sending needs the fee service. To run it locally, see `.env.example`, then:

```bash
npm run relayer
```

`npm run build` checks the types and builds the app into `dist/`, with `privacy.html` generated from the words in `src/i18n.ts`.
