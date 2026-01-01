
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertMessage } from '../types';
import { getActiveAlerts, getNextEvent } from '../services/storage';
import { AlertCard } from '../components/AlertCard';
import { Button } from '../components/Button';
import { isCloudEnabled, getBackendUrl } from '../services/config';
import { initializePushNotifications } from '../services/firebase';

// 1. SILENT MP3 (Base64) - Plays continuously to keep the app alive
const SILENT_MP3 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAASAAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA";

// 2. LOUD SIREN (Path)
const CUSTOM_SIREN_PATH = "./siren.mp3";

export const UserBroadcast: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  // UI State
  const [alerts, setAlerts] = useState<AlertMessage[]>([]);
  const [nextEvent, setNextEvent] = useState<{ time: number, content: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [isCloud, setIsCloud] = useState(false);
  
  // Refs for Engine
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const alarmAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextEventRef = useRef<{ time: number, content: string } | null>(null);
  const loopIdRef = useRef<any>(null);
  
  // --- ALARM TRIGGER ---
  const triggerAlarm = useCallback(() => {
    console.log("🚨 ALARM TRIGGERED");
    setIsAlarmActive(true);

    // 1. Play Loud Audio
    if (alarmAudioRef.current) {
        alarmAudioRef.current.currentTime = 0;
        alarmAudioRef.current.volume = 1.0;
        
        const playPromise = alarmAudioRef.current.play();
        if (playPromise !== undefined) {
            playPromise
                .then(() => console.log("🔊 Siren playing"))
                .catch(e => console.error("❌ Siren failed:", e));
        }
    }

    // 2. Vibrate (Pattern: Long, Short, Long)
    if (navigator.vibrate) {
        navigator.vibrate([1000, 200, 1000, 200, 2000]);
        // Keep vibrating every 4 seconds
        const vibInt = setInterval(() => {
            if(alarmAudioRef.current && !alarmAudioRef.current.paused) {
                 navigator.vibrate([1000, 200, 1000, 200, 2000]);
            } else {
                clearInterval(vibInt);
            }
        }, 4000);
    }

    // 3. Stop after 30 seconds automatically
    setTimeout(() => stopAlarm(), 30000);
  }, []);

  const stopAlarm = () => {
      setIsAlarmActive(false);
      if (alarmAudioRef.current) {
          alarmAudioRef.current.pause();
          alarmAudioRef.current.currentTime = 0;
      }
      if (navigator.vibrate) navigator.vibrate(0);
      
      // Refresh data immediately after stopping
      checkData();
  };

  // --- DATA CHECK ---
  const checkData = async () => {
      setIsCloud(isCloudEnabled());
      const currentAlerts = await getActiveAlerts();
      setAlerts(currentAlerts);

      const next = await getNextEvent();
      setNextEvent(next);
      nextEventRef.current = next;
  };

  // --- THE TICKER (Runs every 1s) ---
  // This function is kept alive by the silent audio loop
  const tick = () => {
      const now = Date.now();
      setCurrentTime(now); // Update UI clock

      const target = nextEventRef.current;

      if (target) {
          // Check if we reached the time (with 1s precision)
          // Also check if we are within 60s past the time (in case of slight drift)
          if (now >= target.time && now < target.time + 60000) {
              
              // Only trigger if alarm is not already ringing
              if (alarmAudioRef.current && alarmAudioRef.current.paused) {
                  triggerAlarm();
                  // Clear the ref so we don't trigger again in the next second
                  nextEventRef.current = null;
                  setNextEvent(null); 
              }
          }
      }
  };

  // --- ACTIVATE ENGINE ---
  const handleActivate = async () => {
      setAudioEnabled(true);
      
      // 1. Start Silent Loop (The "Keep-Alive" Hack)
      if (silentAudioRef.current) {
          silentAudioRef.current.play().catch(e => console.error("Silent audio failed", e));
      }

      // 2. Request Wake Lock (Screen stays bright if app is open)
      if ('wakeLock' in navigator) {
          try { await (navigator as any).wakeLock.request('screen'); } catch(e) {}
      }

      // 3. Setup Media Session (Lock Screen Controls)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Sentinel Active',
            artist: 'Monitoring...',
            artwork: [{ src: 'https://cdn-icons-png.flaticon.com/512/564/564619.png', sizes: '512x512', type: 'image/png' }]
        });
        navigator.mediaSession.setActionHandler('play', () => { 
            if(silentAudioRef.current) silentAudioRef.current.play(); 
        });
      }

      // 4. Start the Interval Logic
      if (loopIdRef.current) clearInterval(loopIdRef.current);
      loopIdRef.current = setInterval(() => {
          tick();
          // Periodically refresh data (every 5s) to get new alerts from admin
          if (Date.now() % 5000 < 1000) checkData();
      }, 1000);

      // 5. Initial Data Load
      checkData();

      // 6. Request Notification Perms (Backup)
      if (isCloudEnabled()) initializePushNotifications();
  };

  const handleStop = () => {
      setAudioEnabled(false);
      stopAlarm();
      if (silentAudioRef.current) silentAudioRef.current.pause();
      if (loopIdRef.current) clearInterval(loopIdRef.current);
  };

  // Setup on mount
  useEffect(() => {
      checkData();
      return () => {
          if (loopIdRef.current) clearInterval(loopIdRef.current);
      };
  }, []);

  return (
    <div className={`min-h-screen text-white flex flex-col transition-colors duration-500 ${isAlarmActive ? 'alarm-flash' : 'bg-slate-900'}`}>
      
      {/* 1. SILENT AUDIO (The Engine) */}
      <audio 
        ref={silentAudioRef} 
        src={SILENT_MP3} 
        loop 
        playsInline 
        autoPlay={false} // Must be triggered by user
        style={{ display: 'none' }}
      />
      
      {/* 2. SIREN AUDIO (The Payload) */}
      <audio 
        ref={alarmAudioRef} 
        src={CUSTOM_SIREN_PATH} 
        preload="auto"
        style={{ display: 'none' }}
      />

      {/* HEADER */}
      <header className="bg-slate-800 border-b border-slate-700 p-3 sticky top-0 z-50 shadow-md">
        <div className="max-w-4xl mx-auto flex flex-row justify-between items-center">
          <div className="flex items-center gap-3">
             <div className={`w-10 h-10 bg-red-600 rounded-full flex items-center justify-center ${isAlarmActive ? 'animate-spin' : ''}`}>
                <i className="fas fa-bullhorn text-white"></i>
             </div>
             <div>
                 <h1 className="font-bold tracking-wider text-red-500">SENTINEL</h1>
                 <div className="flex items-center gap-2 text-[10px]">
                     {audioEnabled ? <span className="text-green-400 font-bold">● ACTIVE</span> : <span className="text-slate-500">● PAUSED</span>}
                     {isCloud ? <span className="text-blue-400">● CLOUD</span> : <span className="text-yellow-500">● LOCAL</span>}
                 </div>
             </div>
          </div>
          
          <div>
            {!audioEnabled ? (
                <Button onClick={handleActivate} variant="danger" className="animate-pulse font-bold shadow-lg shadow-red-900/50">
                    ACTIVATE
                </Button>
            ) : (
                <Button onClick={handleStop} variant="secondary">STOP</Button>
            )}
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-6">
          
          {/* STATUS INDICATOR */}
          {!audioEnabled ? (
              <div className="bg-yellow-900/30 border border-yellow-700 p-6 rounded-lg mb-6 text-center animate-pulse">
                  <i className="fas fa-exclamation-triangle text-3xl text-yellow-500 mb-2"></i>
                  <h3 className="text-yellow-200 font-bold text-lg">System Paused</h3>
                  <p className="text-sm text-yellow-100/80 mt-2">
                      Tap <b>ACTIVATE</b> to start the background engine.
                      <br/>The alarm will not ring if this is paused.
                  </p>
              </div>
          ) : (
              <div className="bg-slate-800 border border-slate-700 p-6 rounded-lg mb-6 relative overflow-hidden">
                   {/* Visual "Heartbeat" to prove JS is running */}
                   <div className="absolute top-0 left-0 w-full h-1 bg-green-500 animate-pulse"></div>
                   
                   <div className="text-center">
                       <p className="text-xs text-green-400 uppercase tracking-widest font-bold mb-1">
                           <i className="fas fa-satellite-dish mr-2"></i> Engine Running
                       </p>
                       <p className="text-4xl font-oswald text-white tabular-nums">
                           {new Date(currentTime).toLocaleTimeString([], { hour12: false })}
                       </p>
                       <p className="text-[10px] text-slate-500 mt-2">
                           System Time (Updates every second)
                       </p>
                   </div>
              </div>
          )}
          
          {/* NEXT ALARM CARD */}
          {nextEvent && audioEnabled && (
             <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 p-6 rounded-lg mb-8 text-center shadow-xl">
                 <div className="inline-block bg-blue-900/50 text-blue-300 px-3 py-1 rounded-full text-xs font-bold mb-4">
                     UPCOMING ALARM
                 </div>
                 <div className="text-5xl font-oswald text-white mb-2">
                     {new Date(nextEvent.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                 </div>
                 <p className="text-lg text-blue-200">{nextEvent.content}</p>
                 <div className="mt-4 text-xs text-slate-500">
                     Scheduled for: {new Date(nextEvent.time).toDateString()}
                 </div>
             </div>
          )}

          <h2 className="text-slate-500 uppercase text-xs font-bold mb-4 border-b border-slate-800 pb-2">Active Alerts</h2>
          {alerts.length === 0 ? (
              <div className="text-center py-12 opacity-50">
                  <i className="fas fa-check-circle text-4xl text-slate-600 mb-3"></i>
                  <p className="text-slate-500">All systems normal.</p>
              </div>
          ) : (
              alerts.map(a => <AlertCard key={a.id} alert={a} />)
          )}

      </main>
      
      <footer className="bg-slate-950 p-4 text-center border-t border-slate-900">
          <button onClick={() => navigate('/admin')} className="text-slate-700 hover:text-slate-500 text-xs transition-colors">
              Admin Access
          </button>
      </footer>
    </div>
  );
};
