import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { CONTACT, strings } from './src/i18n'

// Every build gets a stamp like 26.11.17-1532 (UTC). The app shows it in
// Settings and compares it with /version.json to tell whether it is current.
const d = new Date()
const two = (n: number) => String(n).padStart(2, '0')
const BUILD = `${two(d.getUTCFullYear() % 100)}.${two(d.getUTCMonth() + 1)}.${two(d.getUTCDate())}-${two(d.getUTCHours())}${two(d.getUTCMinutes())}`

// The privacy text, as a plain page at /privacy.html: a public address to give
// to Facebook and others. Built from the same words the app shows in Settings.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
function privacyPage() {
  const names = { mg: 'Malagasy', fr: 'Français', en: 'English' }
  const langs = ['fr', 'mg', 'en'] as const
  const section = (l: (typeof langs)[number]) => {
    const v = strings[l].privacy
    return `<section id="${l}" lang="${l}">
<h1>Tanako Wallet: ${esc(v.title)}</h1>
<p>${esc(v.intro)}</p>
${v.parts.map(([h, b]) => `<h2>${esc(h)}</h2>\n<p>${esc(b)}</p>`).join('\n')}
<h2>${esc(v.removeTitle)}</h2>
<p>${esc(v.removeIntro)}</p>
<ol>${v.removeSteps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
<p>${esc(v.removeElse)}</p>
<p class="foot">${esc(v.contact.replace('{c}', ''))}<a href="${CONTACT}">${CONTACT.replace('https://', '')}</a><br>${esc(v.updated)}</p>
</section>`
  }
  return `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tanako Wallet: privacy / confidentialité</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
body { margin: 0; background: #e9e3c8; color: #10271b; font: 17px/1.5 'Helvetica Neue', Arial, sans-serif; }
main { max-width: 640px; margin: 0 auto; padding: 24px 20px 60px; }
nav { display: flex; gap: 16px; flex-wrap: wrap; padding-bottom: 12px; border-bottom: 1.5px solid #10271b; }
a { color: #0c4a2d; font-weight: 700; }
h1 { font-size: 1.5rem; line-height: 1.2; margin: 36px 0 12px; }
h2 { font-size: 1.05rem; margin: 22px 0 4px; }
p, ol { margin: 0 0 10px; }
.foot { color: #3f4a3f; font-size: 0.9rem; margin-top: 20px; }
</style>
<main>
<nav><a href="/">Tanako Wallet</a>${langs.map((l) => `<a href="#${l}">${names[l]}</a>`).join('')}</nav>
${langs.map(section).join('\n')}
</main>
</html>
`
}

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [
    react(),
    {
      name: 'version-file',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) })
        this.emitFile({ type: 'asset', fileName: 'privacy.html', source: privacyPage() })
      },
    },
  ],
  server: {
    port: Number(process.env.PORT) || 5180,
    strictPort: true,
    // The fee service: `npm run relayer` locally, a Firebase function when deployed.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
