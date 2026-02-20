import { createRoot } from 'react-dom/client';
import App from './App';
import favicon from './assets/carnage.png';

(() => {
  const head = document.head || document.getElementsByTagName('head')[0];
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    head.appendChild(link);
  }
  link.href = favicon;
})();

createRoot(document.getElementById('root')).render(<App/>);