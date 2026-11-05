import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getMediaStore } from '../../store/projects';
import { App } from '../../studio/App';
import { chromeRunClient } from '../../studio/runClient';
import '../../studio/theme/studio.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="vf-page">
      <App client={chromeRunClient()} media={getMediaStore()} />
    </div>
  </StrictMode>,
);
