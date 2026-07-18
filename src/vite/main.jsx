import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'material-symbols/outlined.css';
import '@/app/globals.css';
import App from './App.jsx';

function markMaterialSymbolsReady() {
  let completed = false;
  const finish = () => {
    if (completed) return;
    completed = true;
    document.documentElement.classList.add('symbols-loaded');
  };
  if (!document.fonts?.load) {
    finish();
    return;
  }
  const timeout = globalThis.setTimeout(finish, 3000);
  document.fonts.load('24px "Material Symbols Outlined"').then(() => {
    globalThis.clearTimeout(timeout);
    finish();
  }, () => {
    globalThis.clearTimeout(timeout);
    finish();
  });
}

markMaterialSymbolsReady();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
