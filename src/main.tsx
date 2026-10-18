import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AssetBar } from './ui/AssetBar';
import { installAssetProgress } from './ui/assetProgress';
import './ui/styles.css';
import './ui/conquest.css';
import './ui/menu.css';
import './ui/ios.css';

installAssetProgress();
createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <AssetBar />
  </>,
);
