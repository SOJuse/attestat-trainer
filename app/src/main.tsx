import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { detectPlatform } from './platform';
import './assets/fonts/fonts.css';
import './styles/tokens.css';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App platform={detectPlatform()} />
  </React.StrictMode>,
);
