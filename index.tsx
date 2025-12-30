import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Register Service Worker for PWA capabilities
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      console.log('SW registered: ', registration);
      
      // Check for updates every time page loads
      registration.update();

      // IF a new service worker is waiting, valid, and we have a controller,
      // the 'sw.js' handles skipWaiting(), which triggers 'controllerchange'.
    }).catch((registrationError) => {
      console.log('SW registration failed: ', registrationError);
    });

    // AUTO-RELOAD LOGIC:
    // When the Service Worker updates (because you bumped the version in sw.js),
    // it will claim the client. This event fires, and we reload the window
    // so the user sees the new changes immediately.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);