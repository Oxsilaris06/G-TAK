// L'ordre est vital ici : Polyfills d'abord, le reste ensuite.
import './polyfills'; 

import { registerRootComponent } from 'expo';
import React from 'react';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

const SafeApp = () => (
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

registerRootComponent(SafeApp);
