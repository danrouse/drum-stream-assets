import React from 'react'
import ReactDOM from 'react-dom/client'
import SongBrowserUI from './SongBrowserUI.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SongBrowserUI />
  </React.StrictMode>,
);
