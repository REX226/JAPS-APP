
// This worker runs in a separate thread.
// Browsers do not throttle Web Workers as aggressively as the main UI thread when the tab is in the background.

let intervalId = null;

self.onmessage = function(e) {
  if (e.data === 'start') {
    if (intervalId) clearInterval(intervalId);
    
    // Check every 2 seconds
    intervalId = setInterval(() => {
      self.postMessage('tick');
    }, 2000);
  } else if (e.data === 'stop') {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }
};
