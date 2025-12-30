
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertMessage } from '../types';
import { getActiveAlerts } from '../services/storage';
import { AlertCard } from '../components/AlertCard';
import { Button } from '../components/Button';
import { isCloudEnabled, getBackendUrl } from '../services/config';
import { initializePushNotifications, checkFirebaseConfig } from '../services/firebase';

// Tiny silent MP3 to keep the audio channel open and background execution alive
const SILENT_MP3 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAASAAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA";

// Alarm Beep Sound (HTML5 Audio source) - Replaces Oscillator for background reliability
const ALARM_MP3 = "data:audio/mp3;base64,//uQxAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uQxAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uQxAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uQxAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//uQxAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";

export const UserBroadcast: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [alerts, setAlerts] = useState<AlertMessage[]>([]);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [lastAlertCount, setLastAlertCount] = useState<number | null>(null);
  
  // Emergency Mode State
  const [isEmergencyMode, setIsEmergencyMode] = useState(false);
  
  // Install State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  // Status State
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [isCloud, setIsCloud] = useState(false);
  const [wakeLock, setWakeLock] = useState<any>(null);
  const [wakeLockError, setWakeLockError] = useState(false);
  const [lastHeartbeat, setLastHeartbeat] = useState<number>(Date.now());
  const [showHeartbeat, setShowHeartbeat] = useState(false);
  
  // Config Status
  const [firebaseConfigured, setFirebaseConfigured] = useState(true);
  const [pushPermission, setPushPermission] = useState<string>('default');
  
  // Refs
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const alarmAudioRef = useRef<HTMLAudioElement | null>(null);
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
    const checkStandalone = () => {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
        setIsAppInstalled(!!isStandalone);
    };
    checkStandalone();
    window.matchMedia('(display-mode: standalone)').addEventListener('change', checkStandalone);
    
    // Check OS
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream);

    const isConf = checkFirebaseConfig();
    setFirebaseConfigured(isConf);

    if ("Notification" in window) {
        setPushPermission(Notification.permission);
    }

    // Initialize cloud status
    const backendUrl = getBackendUrl();
    setIsCloud(!!backendUrl && backendUrl.length > 0);

    // Try to init push if cloud is active
    if (isCloudEnabled() && isConf) {
        initializePushNotifications();
    }

    // CHECK EMERGENCY FLAG
    if (searchParams.get('emergency') === 'true') {
        console.log("Opened via Emergency Notification");
        setIsEmergencyMode(true);
    }
  }, []);

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setPushPermission(perm);
    if (perm === 'granted' && checkFirebaseConfig()) {
        initializePushNotifications();
    }
  };

  // --- WAKE LOCK (SCREEN ON) FEATURE ---
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        const lock = await (navigator as any).wakeLock.request('screen');
        setWakeLock(lock);
        setWakeLockError(false);
        
        lock.addEventListener('release', () => {
          setWakeLock(null);
          if (document.visibilityState === 'visible' && localStorage.getItem('sentinel_armed') === 'true') {
            requestWakeLock();
          }
        });
      } catch (err: any) {
        setWakeLockError(true);
      }
    } else {
        setWakeLockError(true);
    }
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && audioEnabled) {
        requestWakeLock();
        // Ensure silent loop is playing
        if (silentAudioRef.current && silentAudioRef.current.paused) {
            silentAudioRef.current.play().catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [audioEnabled]);

  const enableAudio = (isAutoResume = false) => {
    // 1. Silent Loop for Background persistence
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
    setIsEmergencyMode(false); // Clear emergency overlay once enabled
    
    requestNotificationPermission();
    requestWakeLock();
    
    // Play short confirmation beep via the alarm audio element
    if (!isAutoResume && alarmAudioRef.current) {
        try {
            alarmAudioRef.current.currentTime = 0;
            alarmAudioRef.current.play().catch(e => console.error("Confirmation beep failed", e));
            setTimeout(() => {
                if (alarmAudioRef.current) {
                    alarmAudioRef.current.pause();
                    alarmAudioRef.current.currentTime = 0;
                }
            }, 500);
            
            // If opened via emergency, start the full siren immediately
            if (searchParams.get('emergency') === 'true' || isEmergencyMode) {
               playSiren();
            }
        } catch (e) { console.error(e); }
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
    if (silentAudioRef.current) silentAudioRef.current.pause();
    if (alarmAudioRef.current) {
        alarmAudioRef.current.pause();
        alarmAudioRef.current.currentTime = 0;
    }
  };

  const stopVibration = () => {
    if (vibrationIntervalRef.current) {
      clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
    if (navigator.vibrate) navigator.vibrate(0);
  };

  const playSiren = useCallback(() => {
    setIsAlarmActive(true);
    
    // Auto stop after 15 seconds
    setTimeout(() => { 
        setIsAlarmActive(false); 
        stopVibration(); 
        if (alarmAudioRef.current) {
            alarmAudioRef.current.pause();
            alarmAudioRef.current.currentTime = 0;
        }
    }, 15000);

    // Vibration
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200, 100, 500, 100, 500, 100, 500, 100]);
        if (vibrationIntervalRef.current) clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = setInterval(() => {
             navigator.vibrate([200, 100, 200, 100, 200, 100, 500, 100, 500, 100, 500, 100]);
        }, 3000);
    }

    // Audio - Using HTML5 Audio Element for background capability
    if (alarmAudioRef.current) {
        alarmAudioRef.current.currentTime = 0;
        // Playing an <audio> element that was initialized during 'enableAudio' (via user gesture)
        // should play even in background if the silent loop kept the session active.
        alarmAudioRef.current.play().catch(e => console.error("Siren play failed", e));
    }
  }, [audioEnabled]);

  // --- POLLING & WORKER ---
  const fetchAlerts = useCallback(async () => {
    setIsCloud(isCloudEnabled());
    const currentAlerts = await getActiveAlerts();
    setAlerts(currentAlerts);

    if (lastAlertCount !== null && currentAlerts.length > lastAlertCount) {
      playSiren();
      if (document.visibilityState === 'hidden') {
         if (currentAlerts.length > 0) showSystemNotification(currentAlerts[0]);
      }
    }
    setLastAlertCount(currentAlerts.length);
  }, [lastAlertCount, playSiren]);

  useEffect(() => { fetchAlertsRef.current = fetchAlerts; }, [fetchAlerts]);

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
                    vibrate: [500, 200, 500, 200, 1000]
                } as any);
            });
         }
      } catch(e) {}
  };

  // --- INSTALL UI ---
  useEffect(() => {
    const handler = (e: any) => { 
        e.preventDefault(); 
        setDeferredPrompt(e); 
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setIsAppInstalled(true); setDeferredPrompt(null); });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((res: any) => {
        if (res.outcome === 'accepted') setDeferredPrompt(null);
      });
    } else {
      // Manual Instructions
      if (isIOS) {
          alert("📲 INSTALL ON iPHONE:\n\n1. Tap the 'Share' button (Box with arrow) at the bottom of Safari.\n\n2. Scroll down and tap 'Add to Home Screen' (+).");
      } else {
          alert("📲 INSTALL ON ANDROID:\n\n1. Tap the browser menu (three dots ⋮) at the top right.\n\n2. Select 'Install App' or 'Add to Home Screen'.");
      }
    }
  };

  return (
    <div className={`min-h-screen text-white flex flex-col transition-colors duration-500 ${isAlarmActive ? 'alarm-flash' : 'bg-slate-900'}`}>
      <audio ref={silentAudioRef} src={SILENT_MP3} loop playsInline style={{ display: 'none' }} />
      {/* Alarm Audio - Not displayed, used for playback */}
      <audio ref={alarmAudioRef} src={ALARM_MP3} playsInline style={{ display: 'none' }} />

      {/* EMERGENCY FULLSCREEN OVERLAY */}
      {isEmergencyMode && (
          <div 
             className="fixed inset-0 z-[100] bg-red-600 flex flex-col items-center justify-center cursor-pointer animate-pulse"
             onClick={() => enableAudio(false)}
          >
              <i className="fas fa-radiation text-9xl text-white mb-8 animate-bounce"></i>
              <h1 className="text-4xl font-bold text-center text-white font-oswald mb-4">EMERGENCY ALERT</h1>
              <p className="text-2xl text-white font-bold blink">TAP SCREEN TO LISTEN</p>
          </div>
      )}

      {/* HEADER */}
      <header className="bg-slate-800 border-b border-slate-700 p-3 sticky top-0 z-50 shadow-md">
        <div className="max-w-4xl mx-auto flex flex-row justify-between items-center gap-2">
          
          {/* LEFT: Identity - Using flex-1 and min-w-0 to allow shrinking */}
          <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
            <div className={`w-10 h-10 flex-shrink-0 bg-red-600 rounded-full flex items-center justify-center shadow-lg shadow-red-900/50 ${isAlarmActive ? 'animate-spin' : 'animate-pulse'}`}>
               <i className="fas fa-bullhorn text-white text-lg md:text-xl"></i>
            </div>
            <div className="flex flex-col min-w-0">
              <h1 className="text-lg md:text-xl font-bold tracking-wider text-red-500 leading-tight truncate">SENTINEL</h1>
              
              <div className="flex items-center gap-2 md:gap-3 text-[10px] md:text-xs font-mono truncate">
                 {isCloud ? <span className="text-green-400 font-bold flex-shrink-0">● ON</span> : <span className="text-red-500 font-bold animate-pulse flex-shrink-0">● OFF</span>}
                 
                 {audioEnabled && (
                    wakeLock ? (
                        <span className="text-blue-400 hidden md:inline truncate"><i className="fas fa-desktop"></i> SCREEN ON</span>
                    ) : (
                        <span className={`${wakeLockError ? 'text-red-400' : 'text-slate-500'} hidden md:inline truncate`}><i className="fas fa-desktop"></i> {wakeLockError ? 'LOCK FAIL' : 'NORMAL'}</span>
                    )
                 )}
                 <span className={`transition-opacity duration-200 ${showHeartbeat ? 'opacity-100 text-blue-400' : 'opacity-20 text-slate-500'}`}><i className="fas fa-heartbeat"></i></span>
              </div>
            </div>
          </div>
          
          {/* RIGHT: Actions - Prevent shrinking */}
          <div className="flex gap-2 items-center flex-shrink-0">
            {!audioEnabled ? (
              <Button onClick={() => enableAudio(false)} variant="danger" className="animate-bounce font-bold shadow-lg shadow-red-900/50 text-sm px-3 md:px-4 h-10">
                ACTIVATE
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                  <div className="hidden md:flex items-center text-green-400 text-sm font-mono bg-green-900/20 px-3 py-1 rounded border border-green-900 h-10">
                    <i className="fas fa-satellite-dish mr-2 animate-pulse"></i> ARMED
                  </div>
                  <Button onClick={deactivateSystem} variant="secondary" className="text-xs opacity-60 hover:opacity-100 h-10">
                    STOP
                  </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* CONFIG WARNINGS */}
      {!isCloud && (
         <div className="bg-red-600 text-white p-2 text-center text-xs md:text-sm font-bold animate-pulse">
           ❌ OFFLINE MODE. Check internet.
         </div>
      )}

      {/* MAIN CONTENT */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-4 md:p-8 mb-16">
        
        {alerts.length === 0 ? (
           <div className="flex flex-col items-center justify-center h-64 text-slate-500">
             <i className="fas fa-shield-alt text-6xl mb-4 opacity-20"></i>
             <p className="text-xl">Monitoring Active</p>
             
             {audioEnabled ? (
                 <>
                   {silentAudioRef.current?.paused && (
                       <div className="mt-4 p-3 bg-yellow-900/30 text-yellow-500 border border-yellow-800 rounded text-sm animate-pulse cursor-pointer" onClick={() => enableAudio(false)}>
                          <i className="fas fa-exclamation-circle mr-2"></i> Audio suspended. Tap to fix.
                       </div>
                   )}
                   <div className="mt-2 text-green-500 text-xs font-mono animate-pulse">
                       <i className="fas fa-satellite-dish"></i> Background Signal Active
                   </div>
                 </>
             ) : (
                 <div className="mt-2 text-slate-600 text-xs font-mono">
                     <i className="fas fa-volume-mute"></i> System Disarmed
                 </div>
             )}

             {/* INSTRUCTIONS */}
             <div className="mt-8 text-center max-w-sm mx-auto">
                <div className="inline-block bg-slate-950 p-4 rounded-lg border border-slate-800 text-xs text-left w-full mb-4">
                    <p className="font-bold text-slate-400 mb-2"><i className="fas fa-lightbulb text-yellow-500"></i> BEST PRACTICES</p>
                    <ul className="space-y-2 text-slate-500 list-disc pl-4">
                        <li>Turn Volume <strong>MAX</strong>.</li>
                        <li className="text-green-400">✅ Screen can be <strong>LOCKED</strong> (Off).</li>
                        <li className="text-red-400">❌ Do <strong>NOT</strong> swipe-close the app.</li>
                        <li className="text-blue-300">Tap "Activate" to start background mode.</li>
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
      
      <footer className="bg-slate-950 p-6 border-t border-slate-900 flex flex-row justify-center items-center gap-6">
        {!isAppInstalled && (
            <button 
                onClick={handleInstallClick}
                className="text-blue-500 hover:text-blue-400 font-bold text-xs flex items-center gap-2 animate-pulse"
            >
                <i className="fas fa-download"></i> INSTALL APP
            </button>
        )}
        <button onClick={() => navigate('/admin')} className="text-slate-800 hover:text-slate-500 text-xs">Admin Access</button>
      </footer>
    </div>
  );
};
