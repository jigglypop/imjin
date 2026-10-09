import { createRoot } from 'react-dom/client';
import { App } from './App';
import './ui/styles.css';
import './ui/conquest.css';
import './ui/menu.css';
import './ui/ios.css';

createRoot(document.getElementById('root')!).render(<App />);
