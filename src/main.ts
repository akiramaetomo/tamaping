import RAPIER from '@dimforge/rapier2d-compat';
import { DotpingApp } from './app/DotpingApp';
import './style.css';

async function boot() {
  await RAPIER.init();

  const root = document.querySelector<HTMLElement>('#app');
  if (!root) {
    throw new Error('Missing #app root');
  }

  const app = new DotpingApp(root, RAPIER);
  await app.start();
}

boot().catch((error) => {
  console.error(error);
  document.body.textContent = 'dotping failed to start';
});
