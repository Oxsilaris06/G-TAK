/**
 * Exports centralisés de l'application Praxis
 */

// Types
export * from './types';

// Constants
export * from './constants';

// Services
export { mmkvStorage, mmkvAsyncStorageCompat } from './services/mmkvStorage';
export { configService } from './services/configService';
export { connectivityService } from './services/connectivityService';
export { locationService } from './services/locationService';
export { permissionService } from './services/permissionService';

// Store
export {
  usePraxisStore,
  useUser,
  useNetwork,
  useMapState,
  useUI,
  usePings,
  useLogs,
  useSettings,
  useActions,
} from './store/usePraxisStore';

// Components
export { default as TacticalMap } from './components/TacticalMap';
export { default as OperatorCard } from './components/OperatorCard';
export { default as SettingsView } from './components/SettingsView';
export { default as OperatorActionModal } from './components/OperatorActionModal';
export { default as MainCouranteView } from './components/MainCouranteView';
export { default as PrivacyConsentModal } from './components/PrivacyConsentModal';
export { NotificationToast } from './components/NotificationToast';
export { default as ComposantOrdreInitial } from './components/ComposantOrdreInitial';
export { default as TacticalBackground } from './components/TacticalBackground';
export { default as ErrorBoundary } from './components/ErrorBoundary';
