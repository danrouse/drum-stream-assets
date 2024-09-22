import React from 'react'
import ReactDOM from 'react-dom/client'
import SongBrowserUI from './SongBrowserUI.tsx'
import './index.css'

/**
 * Entry point for the Now Playing UI
 * running on the server host via Electron
 */

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SongBrowserUI />
  </React.StrictMode>,
);
