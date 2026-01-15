import './polyfills'; // TOUJOURS EN PREMIER

import { registerRootComponent } from 'expo';
import React from 'react';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// On enveloppe l'App dans une sécurité pour éviter l'écran blanc/figé
const SafeApp = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

registerRootComponent(SafeApp);
