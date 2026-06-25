import { createRoot } from 'react-dom/client';
import './index.css';
import App from './components/App.jsx';

// Note: StrictMode intentionally disabled during dev — it double-mounts
// components which causes the socket to connect then immediately disconnect.
// Re-enable after the socket lifecycle is managed at a higher level (Phase 4).
createRoot(document.getElementById('root')).render(<App />);
