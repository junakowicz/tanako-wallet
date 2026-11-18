import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource/courier-prime/latin-400.css'
import '@fontsource/courier-prime/latin-700.css'
import '@fontsource/courier-prime/latin-ext-400.css'
import '@fontsource/courier-prime/latin-ext-700.css'
import '@fontsource/playfair-display/latin-400.css'
import '@fontsource/playfair-display/latin-ext-400.css'
import '@fontsource/archivo/latin-500.css'
import '@fontsource/archivo/latin-700.css'
import '@fontsource/archivo/latin-800.css'
import '@fontsource/archivo/latin-ext-500.css'
import '@fontsource/archivo/latin-ext-700.css'
import '@fontsource/archivo/latin-ext-800.css'
import './styles.css'
import { registerServiceWorker } from './device'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
