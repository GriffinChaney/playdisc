import { Buffer } from 'buffer';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// music-metadata-browser expects Node's global Buffer to exist (it's a
// browser build in name, but some codepaths still reach for it directly
// instead of only using the imported polyfill), so without this every
// parseBlob() call throws "Buffer is not defined" and silently falls back
// to filename-only metadata with no artwork.
window.Buffer = window.Buffer || Buffer;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
