
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertMessage } from '../types';
import { getActiveAlerts, getNextEvent } from '../services/storage';
import { AlertCard } from '../components/AlertCard';
import { Button } from '../components/Button';
import { isCloudEnabled, getBackendUrl } from '../services/config';
import { initializePushNotifications, checkFirebaseConfig } from '../services/firebase';

// Tiny silent MP3 to keep the audio channel open and background execution alive
const SILENT_MP3 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAASAAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA";

// ✅ CUSTOM AUDIO FILE PATH (Put your file in the 'public' folder)
const CUSTOM_SIREN_PATH = "./siren.mp3";

export const UserBroadcast: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [alerts, setAlerts] = useState<AlertMessage[]>([]);
  const [nextEvent, setNextEvent] = useState<{ time: number, content: string, type: string } | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isSilentPlaying, setIsSilentPlaying] = useState(false);
  const [lastAlertCount, setLastAlertCount] = useState<number | null>(null);
  
  // Emergency Mode State
  const [isEmergencyMode, setIsEmergencyMode] = useState(false);
  
  // Install State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallPopup, setShowInstallPopup] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
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
  const alarmAudioRef = useRef<HTMLAudioElement | null>(null); // ✅ Ref for Custom Audio
  const vibrationIntervalRef = useRef<any>(null);
  const workerRef = useRef<Worker | null>(null);
  const fetchAlertsRef = useRef<() => void>(() => {});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastCheckTimeRef = useRef<number>(Date.now());
  
  // Ref to hold next event time for worker-thread access
  const nextEventTimeRef = useRef<number | null>(null);

  // --- AUDIO HELPERS ---
  const getAudioContext = () => {
    if (!audioCtxRef.current) {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  };

  const playBeep = () => {
      try {
          const ctx = getAudioContext();
          if(ctx.state === 'suspended') ctx.resume();
          
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          // High-pitched confirmation beep
          osc.type = 'square';
          osc.frequency.setValueAtTime(880, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
          
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
          
          osc.start();
          osc.stop(ctx.currentTime + 0.3);
      } catch(e) { console.error("Beep Error:", e); }
  };

  const stopSiren = () => {
      // 1. Stop Audio File
      if (alarmAudioRef.current) {
          alarmAudioRef.current.pause();
          alarmAudioRef.current.currentTime = 0;
      }
      // 2. Stop Vibration
      stopVibration();
      setIsAlarmActive(false);
  };

  const stopVibration = () => {
    if (vibrationIntervalRef.current) {
      clearInterval(vibrationIntervalRef.current);
      vibrationIntervalRef.current = null;
    }
    if (navigator.vibrate) navigator.vibrate(0);
  };

  const playSiren = useCallback(() => {
    if (isAlarmActive) return; // Prevent double trigger
    setIsAlarmActive(true);
    
    // Auto stop after 20 seconds
    setTimeout(() => { 
        stopSiren();
    }, 20000);

    // 1. Vibration
    if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200, 100, 500, 100, 500, 100, 500, 100]);
        if (vibrationIntervalRef.current) clearInterval(vibrationIntervalRef.current);
        vibrationIntervalRef.current = setInterval(() => {
             navigator.vibrate([200, 100, 200, 100, 200, 100, 500, 100, 500, 100, 500, 100]);
        }, 3000);
    }

    // 2. Play Custom Audio File
    if (alarmAudioRef.current) {
        // Ensure volume is maxed (programmatically limits apply)
        alarmAudioRef.current.volume = 1.0; 
        alarmAudioRef.current.currentTime = 0;
        
        const playPromise = alarmAudioRef.current.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error("Audio playback failed:", error);
                // Fallback to beep if file fails
                playBeep();
            });
        }
    }

  }, [isAlarmActive]);

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
    
    // Check OS (Specific check for iOS to warn about Silent Switch)
    const isIOSCheck = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(isIOSCheck);

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
        // Just checking status here, request happens on interaction
        if (Notification.permission === 'granted') {
            initializePushNotifications();
        }
    }

    // CHECK EMERGENCY FLAG
    if (searchParams.get('emergency') === 'true') {
        console.log("Opened via Emergency Notification");
        setIsEmergencyMode(true);
    }
    
    return () => stopSiren(); // Cleanup on unmount
  }, []);

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) return;
    
    // iOS requires this to be a direct result of user interaction
    const perm = await Notification.requestPermission();
    setPushPermission(perm);
    
    if (perm === 'granted' && checkFirebaseConfig()) {
        await initializePushNotifications();
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
      if (document.visibilityState === 'visible') {
         // Immediate re-fetch when app comes to foreground (fixes "5 hour sleep" issue)
         fetchAlerts();

         if (audioEnabled) {
            requestWakeLock();
            // Ensure silent loop is playing
            if (silentAudioRef.current && silentAudioRef.current.paused) {
                silentAudioRef.current.play().catch(() => {});
            }
         }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [audioEnabled]);

  const enableAudio = async (isAutoResume = false) => {
    // 1. Silent Loop for Background persistence
    if (silentAudioRef.current) {
        const playPromise = silentAudioRef.current.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                // Success handled by onPlay event listener
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title: 'Sentinel Active',
                        artist: 'Emergency Broadcast System',
                        artwork: [{ src: 'https://cdn-icons-png.flaticon.com/512/564/564619.png', sizes: '512x512', type: 'image/png' }]
                    });
                    navigator.mediaSession.setActionHandler('play', () => { silentAudioRef.current?.play(); });
                    navigator.mediaSession.playbackState = 'playing';
                }
            }).catch(() => {
                console.log("Auto-play prevented");
                setIsSilentPlaying(false);
            });
        }
    }
    
    setAudioEnabled(true);
    localStorage.setItem('sentinel_armed', 'true');
    setIsEmergencyMode(false); // Clear emergency overlay once enabled
    
    // Explicitly request permissions on the click event (Vital for iOS)
    if (!isAutoResume) {
        await requestNotificationPermission();
    }
    
    requestWakeLock();
    
    // Play short confirmation beep
    if (!isAutoResume) {
        playBeep();
        
        // If opened via emergency, start the full siren immediately
        if (searchParams.get('emergency') === 'true' || isEmergencyMode) {
           playSiren();
        }
    }
  };

  const deactivateSystem = () => {
    setAudioEnabled(false);
    localStorage.removeItem('sentinel_armed');
    setIsAlarmActive(false);
    stopVibration();
    stopSiren();
    if (wakeLock) {
        wakeLock.release().then(() => setWakeLock(null));
    }
    if (silentAudioRef.current) {
        silentAudioRef.current.pause();
        setIsSilentPlaying(false);
    }
    nextEventTimeRef.current = null; // Clear local schedule
  };

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

    // --- NEW: UPDATE NEXT EVENT REF FOR WORKER ---
    const next = await getNextEvent();
    setNextEvent(next);

    // If there is an upcoming event, store it in the ref so the worker can check it every second
    if (next && audioEnabled) {
        nextEventTimeRef.current = next.time;
    } else {
        nextEventTimeRef.current = null;
    }

  }, [lastAlertCount, playSiren, audioEnabled]);

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
            const now = Date.now();
            
            // --- OFFLINE ALARM CHECK ---
            // Triggers exactly on time even if network is slow
            if (nextEventTimeRef.current && now >= nextEventTimeRef.current) {
                console.log("⏰ Local Worker Timer Triggered!");
                playSiren();
                nextEventTimeRef.current = null; // Prevent looping
                if (fetchAlertsRef.current) fetchAlertsRef.current(); // Sync with server
            }

            // DRIFT DETECTION: If tick is delayed by > 5 seconds, we likely just woke up
            if (now - lastCheckTimeRef.current > 5000) {
                 console.log("System woke from sleep - forcing fetch");
                 if (fetchAlertsRef.current) fetchAlertsRef.current();
            }
            lastCheckTimeRef.current = now;
            setLastHeartbeat(now);
            if (fetchAlertsRef.current) fetchAlertsRef.current();
          }
        };
        workerRef.current.postMessage('start');
    } catch(e) { }
    return () => workerRef.current?.terminate();
  }, [playSiren]);

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
        setShowInstallPopup(true); // Show popup when ready
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => { setIsAppInstalled(true); setDeferredPrompt(null); setShowInstallPopup(false); });
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((res: any) => {
        if (res.outcome === 'accepted') {
            setDeferredPrompt(null);
            setShowInstallPopup(false);
        }
      });
    } else if (isIOS) {
        // Show iOS Manual Instructions
        setShowIOSInstructions(true);
        setShowInstallPopup(false);
    } else {
        // Fallback Android instructions
        alert("To Install: Tap the browser menu (⋮) -> 'Install App' or 'Add to Home Screen'.");
    }
  };

  const formatNextTime = (ts: number) => {
      const d = new Date(ts);
      const now = new Date();
      const isToday = d.getDate() === now.getDate();
      const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      return isToday ? `Today at ${timeStr}` : `${d.toLocaleDateString()} at ${timeStr}`;
  };

  return (
    <div className={`min-h-screen text-white flex flex-col transition-colors duration-500 ${isAlarmActive ? 'alarm-flash' : 'bg-slate-900'}`}>
      
      {/* 1. SILENT AUDIO LOOP (Maintains background activity) */}
      <audio 
        ref={silentAudioRef} 
        src={SILENT_MP3} 
        loop 
        playsInline 
        style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }} 
        onPlay={() => setIsSilentPlaying(true)}
        onPause={() => setIsSilentPlaying(false)}
      />

      {/* 2. CUSTOM ALARM AUDIO (Plays when alert triggers) */}
      <audio 
          ref={alarmAudioRef} 
          src={CUSTOM_SIREN_PATH} 
          loop 
          preload="auto"
          style={{ display: 'none' }}
          onError={(e) => console.log("Custom Audio File not found. Ensure public/siren.mp3 exists.")}
      />

      {/* ANDROID INSTALL POPUP (FIXED BOTTOM) */}
      {showInstallPopup && !isAppInstalled && !isIOS && (
         <div className="fixed bottom-4 left-4 right-4 z-[999] bg-slate-800 border border-slate-600 shadow-2xl rounded-lg p-4 flex flex-col gap-3 animate-bounce">
             <div className="flex justify-between items-start">
                 <div className="flex items-center gap-3">
                     <div className="bg-blue-600 w-10 h-10 rounded-lg flex items-center justify-center">
                        <i className="fas fa-download text-white"></i>
                     </div>
                     <div>
                         <h3 className="font-bold text-white text-base">Install App</h3>
                         <p className="text-xs text-slate-400">Get offline access & full screen.</p>
                     </div>
                 </div>
                 <button onClick={() => setShowInstallPopup(false)} className="text-slate-400 hover:text-white p-1">
                     <i className="fas fa-times"></i>
                 </button>
             </div>
             <Button onClick={handleInstallClick} fullWidth variant="primary">Install Now</Button>
         </div>
      )}

      {/* iOS INSTALL INSTRUCTIONS MODAL */}
      {(showIOSInstructions || (isIOS && !isAppInstalled && showInstallPopup)) && (
          <div className="fixed inset-0 z-[1000] bg-black/80 flex items-end md:items-center justify-center p-4">
              <div className="bg-slate-800 w-full max-w-sm rounded-t-2xl md:rounded-2xl p-6 border-t md:border border-slate-700 shadow-2xl animate-slide-up">
                  <div className="flex justify-between items-start mb-4">
                       <h2 className="text-xl font-oswald text-white flex items-center gap-2">
                           <i className="fab fa-apple text-white"></i> Install on iPhone
                       </h2>
                       <button onClick={() => { setShowIOSInstructions(false); setShowInstallPopup(false); }} className="text-slate-400 hover:text-white">
                           <i className="fas fa-times text-lg"></i>
                       </button>
                  </div>
                  
                  <div className="space-y-4 text-sm text-slate-300">
                      <p className="text-yellow-400 font-bold text-xs uppercase tracking-wider">Required for Notifications</p>
                      <div className="flex items-center gap-4">
                          <span className="bg-slate-700 w-8 h-8 rounded-full flex items-center justify-center font-bold text-white flex-shrink-0">1</span>
                          <p>Tap the <span className="text-blue-400 font-bold"><i className="fas fa-share-square"></i> Share Button</span> below.</p>
                      </div>
                      <div className="flex items-center gap-4">
                          <span className="bg-slate-700 w-8 h-8 rounded-full flex items-center justify-center font-bold text-white flex-shrink-0">2</span>
                          <p>Scroll down and tap <span className="text-white font-bold"><i className="fas fa-plus-square"></i> Add to Home Screen</span>.</p>
                      </div>
                      <div className="flex items-center gap-4">
                          <span className="bg-slate-700 w-8 h-8 rounded-full flex items-center justify-center font-bold text-white flex-shrink-0">3</span>
                          <p>Open the app from your Home Screen.</p>
                      </div>
                  </div>
                  
                  <div className="mt-6 flex justify-center">
                       <i className="fas fa-arrow-down text-blue-400 animate-bounce text-2xl"></i>
                  </div>
              </div>
          </div>
      )}

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
          
          {/* LEFT: Identity */}
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
          
          {/* RIGHT: Actions */}
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
                   <div className="mt-2 text-green-500 text-xs font-mono animate-pulse">
                       <i className="fas fa-satellite-dish"></i> Background Signal Active
                   </div>
                   
                   {/* SHOW NEXT ALARM INFO */}
                   {nextEvent && (
                       <div className="mt-6 bg-slate-800 border border-slate-700 p-4 rounded-lg flex items-center gap-4 animate-pulse">
                           <div className="text-yellow-500 text-2xl">
                               <i className="fas fa-clock"></i>
                           </div>
                           <div className="text-left">
                               <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">Upcoming Alarm</div>
                               <div className="text-lg font-oswald text-white">{formatNextTime(nextEvent.time)}</div>
                               <div className="text-xs text-slate-500 truncate max-w-[200px]">{nextEvent.content}</div>
                           </div>
                       </div>
                   )}
                 </>
             ) : (
                 <div className="mt-2 text-slate-600 text-xs font-mono">
                     <i className="fas fa-volume-mute"></i> System Disarmed
                 </div>
             )}

             {/* INSTRUCTIONS */}
             <div className="mt-8 text-center max-w-sm mx-auto space-y-4">
                
                {/* iOS SPECIFIC WARNING */}
                {isIOS && (
                    <div className="bg-orange-900/50 border border-orange-600 p-4 rounded-lg text-left">
                        <p className="text-orange-300 font-bold text-sm mb-2"><i className="fab fa-apple"></i> iPHONE WARNING</p>
                        <ul className="list-disc pl-4 text-xs text-orange-200 space-y-1">
                            <li>Check the <strong>Side Switch</strong>. If it shows <strong>RED</strong> (Silent), the alarm may not sound.</li>
                            <li>You <strong>MUST</strong> add this app to your Home Screen for notifications to work.</li>
                        </ul>
                         {/* Manual Install Button for iOS users who dismissed the popup */}
                         {!isAppInstalled && (
                            <button onClick={() => setShowIOSInstructions(true)} className="mt-3 text-xs bg-orange-800 hover:bg-orange-700 text-white px-3 py-1 rounded">
                                Show Install Guide
                            </button>
                         )}
                    </div>
                )}

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
      
      {/* Footer: Flex Row and Justify Between to ensure side-by-side on mobile */}
      <footer className="bg-slate-950 p-4 border-t border-slate-900 flex flex-row justify-center items-center gap-8">
        <button onClick={() => navigate('/admin')} className="text-slate-800 hover:text-slate-500 text-xs whitespace-nowrap">Admin Access</button>
      </footer>
    </div>
  );
};
