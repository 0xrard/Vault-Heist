import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Tab yang terbuka lama bisa memegang referensi chunk dari deployment lama.
// Bila sebuah chunk lazy (mis. SDK FHE) gagal dimuat karena sudah tergantikan
// deployment yang lebih baru, muat ulang halaman SEKALI agar tab konsisten
// dengan build terbaru (guard sessionStorage mencegah loop reload).
window.addEventListener('vite:preloadError', () => {
  const KEY = 'vh-chunk-reloaded'
  if (!sessionStorage.getItem(KEY)) {
    sessionStorage.setItem(KEY, '1')
    window.location.reload()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
