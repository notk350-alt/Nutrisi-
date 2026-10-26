import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './index.css';

// Guard against external browser extension unhandled rejections (e.g. MetaMask inpage script inside iframes)
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = typeof reason === 'string' ? reason : reason?.message || '';
    if (
      msg.includes('MetaMask') ||
      msg.includes('metamask') ||
      msg.includes('ethereum') ||
      msg.includes('web3') ||
      msg.includes('wallet')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation?.();
      console.warn('[NutriBodySim] Suppressed extension promise rejection:', msg);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
