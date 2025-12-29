
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertMessage } from '../types';
import { getActiveAlerts } from '../services/storage';
import { AlertCard } from '../components/AlertCard';
import { Button } from '../components/Button';
import { isCloudEnabled } from '../services/config';

// Tiny silent MP3 to keep the audio channel open and background execution alive
const SILENT_MP3 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAASAAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA";

export const UserBroadcast: React.FC = () => {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AlertMessage[]>([]);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [lastAlertCount, setLastAlertCount] = useState<number | null>(null);
  
  // Install State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [isAppInstalled, setIsAppInstalled] = useState(false);

  // Status State
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [isCloud, setIsCloud] = useState(false);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [wakeLockError, setWakeLockError] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<number>(Date.now());
  const [showHeartbeat, setShowHeartbeat] = useState(false);
  
  // Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const vibrationIntervalRef = useRef<any>(null);
  const workerRef = useRef<Worker | null>(null);
  const fetchAlertsRef = useRef<() => void>(() => {});

  // --- INITIALIZATION ---
  useEffect(() => {
    // Check persistence
    const wasArmed = localStorage.getItem('sentinel_armed') === 'true';
    if (wasArmed) {
      enableAudio(true);
    }
    // Check install status
    if (window.matchMedia('(display-mode: standalone)').matches) {
        setIsAppInstalled(true);
    }
  }, []);

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
      await Notification.requestPermission();
    }
  };

  // --- WAKE LOCK (SCREEN ON) FEATURE ---
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        const lock = await (navigator as any).wakeLock.request('screen');
        setWakeLock(lock);
        setWakeLockError(false);
        console.log('✅ Screen Wake Lock acquired');
        
        lock.addEventListener('release', () => {
          console.log('⚠️ Screen Wake Lock released');
          setWakeLock(null);
          // Auto-reacquire if still armed and visible
          if (document.visibilityState === 'visible' && localStorage.getItem('sentinel_armed') === 'true') {
            requestWakeLock();
          }
        });
      } catch (err: any) {
        console.error(`Wake Lock failed: ${err.name}, ${err.message}`);
        setWakeLockError(true);
      }
    } else {
        setWakeLockError(true); // Feature not supported
    }
  };

  // Re-acquire wake lock on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && audioEnabled) {
        requestWakeLock();
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [audioEnabled]);

  const enableAudio = (isAutoResume = false) => {
    // 1. Audio Context
    if (!audioCtxRef.current) {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => console.log("Auto-resume waiting for gesture"));
    }

    // 2. Silent Loop (Background Keep-Alive)
    if (silentAudioRef.current) {
        const playPromise = silentAudioRef.current.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: 'Sentinel Active',
                        artist: 'Emergency Broadcast System',
                        artwork: [{ src: 'https://cdn-icons-png.flaticon.com/512/564/564619.png', sizes: '512x512', type: 'image/png' }]
                    });
                    navigator.mediaSession.setActionHandler('play', () => { silentAudioRef.current?.play(); });
                    navigator.mediaSession.playbackState = 'playing';
                }
            }).catch(() => console.log("Auto-play prevented"));
        }
    }
    
    setAudioEnabled(true);
    localStorage.setItem('sentinel_armed', 'true');
    
    requestNotificationPermission();
    requestWakeLock(); // <--- Trigger Screen Lock
    
    // Play beep if manual
    if (!isAutoResume) {
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
        } catch (e) { console.error(e); }

        if (deferredPrompt && !isAppInstalled) setShowInstallModal(true);
    }
  };

  const deactivateSystem = () => {
    setAudioEnabled(false);
    localStorage.removeItem('sentinel_armed');
    setIsAlarmActive(false);
    stopVibration();
    if (wakeLock) {
        wakeLock.release().then(() => setWakeLock(null));
    }
    if (audioCtxRef.current) audioCtxRef.current.suspend();
    if (silentAudioRef.current) silentAudioRef.current.pause();
  };

  // ... (Vibration and Siren Logic remains same) ...
  const stopVibration = () => {
    if (vibrationIntervalRef.current) {
      clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
    if (navigator.vibrate) navigator.vibrate(0);
  };

  const playSiren = useCallback(() => {
    setIsAlarmActive(true);
    setTimeout(() => { setIsAlarmActive(false); stopVibration(); }, 15000);

    if (navigator.vibrate) {
        navigator.vibrate([500, 200, 500, 200, 1000]);
        if (vibrationIntervalRef.current) clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = setInterval(() => {
            navigator.vibrate([500, 200, 500]);
        }, 2000);
    }

    if (!audioEnabled || !audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sawtooth';
      
      const now = ctx.currentTime;
      for(let i=0; i < 15; i++) {
          const t = now + i;
          osc.frequency.setValueAtTime(600, t);
          osc.frequency.linearRampToValueAtTime(1200, t + 0.5);
          osc.frequency.linearRampToValueAtTime(600, t + 1.0);
      }
      gain.gain.setValueAtTime(0.5, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 15);
      osc.start(now);
      osc.stop(now + 15);
    } catch (e) { console.error(e); }
  }, [audioEnabled]);

  // --- POLLING & WORKER ---
  const fetchAlerts = useCallback(async () => {
    setIsCloud(isCloudEnabled());
    const currentAlerts = await getActiveAlerts();
    setAlerts(currentAlerts);

    if (lastAlertCount !== null && currentAlerts.length > lastAlertCount) {
      playSiren();
      if (currentAlerts.length > 0) showSystemNotification(currentAlerts[0]);
    }
    setLastAlertCount(currentAlerts.length);
  }, [lastAlertCount, playSiren]);

  useEffect(() => { fetchAlertsRef.current = fetchAlerts; }, [fetchAlerts]);

  // Visual Heartbeat tick
  useEffect(() => {
    if (lastHeartbeat) {
      setShowHeartbeat(true);
      const t = setTimeout(() => setShowHeartbeat(false), 500);
      return () => clearTimeout(t);
    }
  }, [lastHeartbeat]);

  useEffect(() => {
    try {
        workerRef.current = new Worker(new URL('./polling-worker.js', window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/')).href);
        workerRef.current.onmessage = (e) => {
          if (e.data === 'tick') {
            setLastHeartbeat(Date.now());
            if (fetchAlertsRef.current) fetchAlertsRef.current();
          }
        };
        workerRef.current.postMessage('start');
    } catch(e) { }
    return () => workerRef.current?.terminate();
  }, []);

  const showSystemNotification = (alert: AlertMessage) => {
      // ... (Same as previous impl)
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      try {
         if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            navigator.serviceWorker.ready.then(reg => {
                reg.showNotification(`🚨 ${alert.severity}`, {
                    body: alert.content,
                    icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png',
                    tag: 'sentinel-alert',
                    renotify: true,
                    requireInteraction: true,
                    vibrate: [500, 200, 500]
                } as any);
            });
         } else {
             new Notification(`🚨 ${alert.severity}`, { body: alert.content });
         }
      } catch(e) {}
  };

  // --- INSTALL UI ---
  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setIsAppInstalled(true); setShowInstallModal(false); });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((res: any) => {
        if (res.outcome === 'accepted') setShowInstallModal(false);
        setDeferredPrompt(null);
      });
    }
  };

  return (
    <div className={`min-h-screen text-white flex flex-col transition-colors duration-500 ${isAlarmActive ? 'alarm-flash' : 'bg-slate-900'}`}>
      <audio ref={silentAudioRef} src={SILENT_MP3} loop playsInline style={{ display: 'none' }} />

      {/* HEADER */}
      <header className="bg-slate-800 border-b border-slate-700 p-4 sticky top-0 z-50 shadow-md">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 bg-red-600 rounded-full flex items-center justify-center ${isAlarmActive ? 'animate-spin' : 'animate-pulse'}`}>
               <i className="fas fa-bullhorn text-white text-xl"></i>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-wider text-red-500">SENTINEL</h1>
              
              <div className="flex items-center gap-3 mt-1 text-[10px] font-mono">
                 {isCloud ? <span className="text-green-400">● CLOUD</span> : <span className="text-yellow-500">● LOCAL</span>}
                 
                 {/* SCREEN LOCK INDICATOR */}
                 {audioEnabled && (
                    wakeLock ? (
                        <span className="text-blue-400 flex items-center gap-1">
                             <i className="fas fa-desktop"></i> SCREEN ON
                        </span>
                    ) : (
                        <span className={`${wakeLockError ? 'text-red-400' : 'text-slate-500'} flex items-center gap-1`}>
                             <i className="fas fa-desktop"></i> {wakeLockError ? 'LOCK FAILED' : 'NORMAL'}
                        </span>
                    )
                 )}
                 
                 <span className={`transition-opacity duration-200 ${showHeartbeat ? 'opacity-100 text-blue-400' : 'opacity-20 text-slate-500'}`}>
                    <i className="fas fa-heartbeat"></i>
                 </span>
              </div>
            </div>
          </div>
          
          <div className="flex gap-2 items-center">
            {deferredPrompt && !isAppInstalled && (
              <Button onClick={() => setShowInstallModal(true)} variant="secondary" className="text-xs px-2">
                <i className="fas fa-download"></i>
              </Button>
            )}

            {!audioEnabled ? (
              <Button onClick={() => enableAudio(false)} variant="danger" className="animate-bounce font-bold shadow-lg shadow-red-900/50">
                ACTIVATE SYSTEM
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                  <div className="flex items-center text-green-400 text-sm font-mono bg-green-900/20 px-3 py-1 rounded border border-green-900 h-10">
                    <i className="fas fa-satellite-dish mr-2 animate-pulse"></i> ARMED
                  </div>
                  <Button onClick={deactivateSystem} variant="secondary" className="text-xs opacity-60 hover:opacity-100">
                    STOP
                  </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* INSTALL MODAL */}
      {showInstallModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-slate-800 border border-slate-600 p-6 rounded-lg max-w-sm w-full shadow-2xl">
                <div className="text-center mb-4">
                    <i className="fas fa-download text-4xl text-blue-500 mb-2"></i>
                    <h2 className="text-xl font-bold font-oswald">Install App</h2>
                    <p className="text-slate-400 text-sm mt-2">Required for reliable background alerts.</p>
                </div>
                <Button onClick={handleInstallClick} fullWidth className="bg-blue-600 mb-2">Install Now</Button>
                <button onClick={() => setShowInstallModal(false)} className="text-slate-500 text-xs underline w-full text-center">Not now</button>
            </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-4 md:p-8">
        {alerts.length === 0 ? (
           <div className="flex flex-col items-center justify-center h-64 text-slate-500">
             <i className="fas fa-shield-alt text-6xl mb-4 opacity-20"></i>
             <p className="text-xl">Monitoring Active</p>
             
             {audioEnabled && (audioCtxRef.current?.state === 'suspended') && (
                 <div className="mt-4 p-3 bg-yellow-900/30 text-yellow-500 border border-yellow-800 rounded text-sm animate-pulse cursor-pointer" onClick={() => enableAudio(false)}>
                    <i className="fas fa-exclamation-circle mr-2"></i> Audio suspended. Tap to fix.
                 </div>
             )}
             
             {/* SCREEN LOCK INSTRUCTION */}
             <div className="mt-8 text-center">
                <div className="inline-block bg-slate-950 p-4 rounded-lg border border-slate-800 text-xs text-left">
                    <p className="font-bold text-slate-400 mb-2"><i className="fas fa-lightbulb text-yellow-500"></i> BEST PRACTICES</p>
                    <ul className="space-y-1 text-slate-500 list-disc pl-4">
                        <li>Turn Volume <strong>MAX</strong>.</li>
                        <li>Keep this screen <strong>OPEN</strong> (Do not swipe away).</li>
                        <li>Screen will stay <strong>ON</strong> (Wake Lock: {wakeLock ? 'Active' : 'Inactive'}).</li>
                    </ul>
                </div>
             </div>
           </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
              <h2 className="text-slate-400 uppercase tracking-widest text-sm font-semibold">Live Alert</h2>
            </div>
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </main>
      
      <footer className="bg-slate-950 p-6 text-center text-slate-600 text-xs border-t border-slate-900">
        <button onClick={() => navigate('/admin')} className="text-slate-800 hover:text-slate-500">Admin Access</button>
      </footer>
    </div>
  );
};
