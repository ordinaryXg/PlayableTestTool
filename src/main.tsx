import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isElectronDesktop } from './desktop/api';
import './styles.css';

const root = document.getElementById('root')!;

if (!isElectronDesktop()) {
  root.innerHTML = `
    <div class="desktop-only-gate">
      <div class="desktop-only-card">
        <h1>Playable 合规检测器</h1>
        <p>本工具仅提供 <strong>Electron 桌面应用</strong>，请勿用浏览器直接打开。</p>
        <p class="desktop-only-cmd">在项目目录执行：</p>
        <pre>npm run dev</pre>
        <p class="desktop-only-hint">已打包用户请运行安装包或便携版 exe。</p>
      </div>
    </div>
  `;
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
