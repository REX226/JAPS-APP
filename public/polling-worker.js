
let intervalId = null;

self.onmessage = function(e) {
  if (e.data === 'start') {
    if (intervalId) clearInterval(intervalId);
    // Tick every 250ms for high precision checks
    intervalId = setInterval(() => {
      self.postMessage('tick');
    }, 250);
  } else if (e.data === 'stop') {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }
};
