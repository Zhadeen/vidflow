import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from '../../panel/Panel';
import { chromeRunClient } from '../../studio/runClient';
import '../../studio/theme/studio.css';
import '../../panel/panel.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Panel client={chromeRunClient()} />
  </StrictMode>,
);
