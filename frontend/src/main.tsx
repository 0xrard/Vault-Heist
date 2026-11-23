import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// A long-open tab can hold chunk references from an old deployment.
// If a lazy chunk (e.g. the FHE SDK) fails to load because it has been replaced by
// a newer deployment, reload the page ONCE so the tab stays consistent
// with the latest build (a sessionStorage guard prevents a reload loop).
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
