import { createAgriEyeApplication } from './app.js';

const application = createAgriEyeApplication();

application.start().catch((error) => {
  console.error('AgriEye initialization failed:', error);
  const status = document.querySelector('#loading-screen .loader-status');
  if (status) {
    status.textContent = `Could not start: ${error?.message || error}`;
    status.style.color = '#e5533d';
  }
});

export { application };
