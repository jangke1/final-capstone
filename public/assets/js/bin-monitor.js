document.addEventListener('DOMContentLoaded', () => {
  const binCapacityLiters = 100;
  const connectionStatus = document.querySelector('[data-bin-connection]');
  const firstUnit = document.querySelector('.unit-card');
  const binCards = firstUnit ? firstUnit.querySelectorAll('[data-bin]') : [];
  let brokerConnected = false;
  let alertThreshold = 85;
  const lastValidReadings = new Map();

  function setConnectionStatus(state) {
    if (!connectionStatus) {
      return;
    }

    const labels = {
      receiving: 'Receiving live data',
      connected: 'Broker connected - waiting for unit',
      disconnected: 'Waiting for MQTT',
    };
    connectionStatus.textContent = labels[state];
    connectionStatus.classList.toggle('is-connected', state === 'receiving');
    connectionStatus.classList.toggle('is-connecting', state !== 'receiving');
  }

  function renderReadings(message) {
    if (!message || !message.bins) {
      return;
    }

    for (const card of binCards) {
      const reading = message.bins[card.dataset.bin];
      const fillLevel = card.querySelector('[data-bin-fill-level]');
      const progress = card.querySelector('[data-bin-progress]');
      const status = card.querySelector('[data-bin-status]');
      const statusLabel = card.querySelector('[data-bin-status-label]');

      if (!reading || reading.valid !== true || !Number.isFinite(reading.fullnessPercent)) {
        const previous = lastValidReadings.get(card.dataset.bin);
        if (previous) {
          const fullness = previous.fullness;
          const liters = previous.liters;
          const isFull = fullness >= alertThreshold;
          card.classList.toggle('full', isFull);
          card.classList.toggle('filling', !isFull);
          fillLevel.textContent = `${liters}L / ${binCapacityLiters}L (${fullness.toFixed(0)}%)`;
          progress.style.width = `${fullness}%`;
          statusLabel.textContent = 'Last reading';
          status.classList.toggle('pill-full', isFull);
          status.classList.toggle('pill-filling', !isFull);
          continue;
        }

        card.classList.remove('full');
        card.classList.add('filling');
        fillLevel.textContent = 'Invalid reading';
        progress.style.width = '0%';
        statusLabel.textContent = 'Invalid';
        status.classList.remove('pill-full');
        status.classList.add('pill-filling');
        continue;
      }

      const fullness = Math.max(0, Math.min(100, reading.fullnessPercent));
      const isFull = fullness >= alertThreshold;
      const liters = Number((fullness * binCapacityLiters / 100).toFixed(2));
      lastValidReadings.set(card.dataset.bin, { fullness, liters });
      card.classList.toggle('full', isFull);
      card.classList.toggle('filling', !isFull);
      fillLevel.textContent = `${liters}L / ${binCapacityLiters}L (${fullness.toFixed(0)}%)`;
      progress.style.width = `${fullness}%`;
      statusLabel.textContent = isFull ? 'Full' : 'Filling';
      status.classList.toggle('pill-full', isFull);
      status.classList.toggle('pill-filling', !isFull);
    }
  }

  const stream = new EventSource('/api/bin-readings/events');
  fetch('/api/settings')
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to load alert threshold')))
    .then((settings) => {
      if (Number.isFinite(settings.alertThreshold) && settings.alertThreshold >= 0 && settings.alertThreshold <= 100) {
        alertThreshold = settings.alertThreshold;
      }
    })
    .catch((error) => console.error('[Bin monitor] Failed to load alert threshold:', error));
  stream.addEventListener('broker-status', (event) => {
    brokerConnected = JSON.parse(event.data).connected === true;
    setConnectionStatus(brokerConnected ? 'connected' : 'disconnected');
  });
  stream.addEventListener('bin-readings', (event) => {
    const readings = JSON.parse(event.data);
    renderReadings(readings);
    window.dispatchEvent(new CustomEvent('bin-readings-updated', { detail: readings }));
    setConnectionStatus('receiving');
  });
  stream.onerror = () => {
    brokerConnected = false;
    setConnectionStatus('disconnected');
  };
});