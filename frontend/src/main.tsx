// Токены и сброс — раньше стилей компонентов, чтобы в бандле они шли первыми.
import '@/styles/tokens.css';
import '@/styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { USE_MOCKS } from '@/config';

async function startMocks(): Promise<void> {
  if (!USE_MOCKS) return;
  const { worker } = await import('@/mocks/browser');
  // Мокаем только то, что есть в handlers; остальное уходит на бэк.
  await worker.start({ onUnhandledRequest: 'bypass' });
}

function render() {
  const root = document.getElementById('root');
  if (!root) throw new Error('Нет #root в index.html');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

startMocks()
  .catch((error: unknown) => console.error('Моки MSW не запустились', error))
  .finally(render);
