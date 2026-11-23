import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import * as pdfjsLib from 'pdfjs-dist'

// Use a bundled local copy of the PDF.js worker to work offline and avoid CDN failures.
// The file is copied to public/ during npm run dev or npm run build.
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.mjs';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
