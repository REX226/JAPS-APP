
// This worker runs in a separate thread.
// Browsers do not throttle Web Workers as aggressively as the main UI thread when the tab is in the background.

let intervalId = null;

self.onmessage = function(e) {
  if (e.data === 'start') {
    if (intervalId) clearInterval(intervalId);
    
    // Check every 1 second (Changed from 2000 to 1000)
    intervalId = setInterval(() => {
      self.postMessage('tick');
    }, 1000);
  } else if (e.data === 'stop') {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }
};
