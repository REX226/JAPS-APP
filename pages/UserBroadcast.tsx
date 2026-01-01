
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertMessage } from '../types';
import { getActiveAlerts, getNextEvent } from '../services/storage';
import { AlertCard } from '../components/AlertCard';
import { Button } from '../components/Button';
import { isCloudEnabled } from '../services/config';
import { initializePushNotifications } from '../services/firebase';

// 1. SILENT MP3 (Base64) - Plays continuously to keep the browser tab awake
// This is critical for iOS/Android background execution
const SILENT_MP3 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAASAAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA";

export const UserBroadcast: React.FC = () => {
  const navigate = useNavigate();
  
  // UI State
  const [alerts, setAlerts] = useState<AlertMessage[]>([]);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  
  // Refs for Engine
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextEventRef = useRef<{ time: number, content: string } | null>(null);
  const workerRef = useRef<Worker | null>(null); // Use Web Worker for background timing
  const lastDataCheckRef = useRef<number>(0);

  // Digital Siren Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  
  // --- DIGITAL SIREN (Web Audio API) ---
  const startDigitalSiren = () => {
      try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!audioContextRef.current) {
              audioContextRef.current = new AudioContextClass();
          }

          const ctx = audioContextRef.current;
          
          // Force resume (Fix for iOS locked screen)
          if (ctx.state === 'suspended') {
              ctx.resume();
          }

          // Create Oscillator
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'square'; // 'Square' wave cuts through noise better than sawtooth
          osc.frequency.setValueAtTime(800, ctx.currentTime);
          osc.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.1);
          osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 0.6);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start();
          
          // Save ref
          oscillatorRef.current = osc;
          
          // Ramp volume
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.05);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);

      } catch (e) {
          console.error("Audio Context Error:", e);
      }
  };

  const stopDigitalSiren = () => {
      if (oscillatorRef.current) {
          try {
              oscillatorRef.current.stop();
              oscillatorRef.current.disconnect();
          } catch(e) {}
          oscillatorRef.current = null;
      }
      // Do NOT close/suspend audio context here. Keeping it open helps iOS stay awake.
  };
  
  // --- ALARM TRIGGER ---
  const triggerAlarm = useCallback(() => {
    console.log("🚨 ALARM TRIGGERED");
    setIsAlarmActive(true);

    // 1. Play Digital Siren
    startDigitalSiren();

    // 2. Vibrate
    if (navigator.vibrate) {
        navigator.vibrate([600]); 
    }

    // 3. STOP AFTER 0.6 Seconds (The "Sweet Spot")
    // Short, aggressive bursts are more reliable in background than long files
    setTimeout(() => {
        setIsAlarmActive(false);
        stopDigitalSiren();
        if (navigator.vibrate) navigator.vibrate(0);
        
        // Clear event immediately so we don't loop infinitely on the same second
        nextEventRef.current = null;
        checkData(); // Refresh data to clear the alert state if needed
    }, 600);
  }, []);

  // --- DATA CHECK ---
  const checkData = async () => {
      const currentAlerts = await getActiveAlerts();
      setAlerts(currentAlerts);

      const next = await getNextEvent();
      nextEventRef.current = next;
  };

  // --- THE TICKER (Triggered by Web Worker) ---
  const handleTick = () => {
      const now = Date.now();
      setCurrentTime(now); 

      // Data Polling (Every 2 seconds)
      if (now - lastDataCheckRef.current > 2000) {
          lastDataCheckRef.current = now;
          checkData();
      }

      const target = nextEventRef.current;
      if (target) {
          // Trigger window: 60 seconds
          if (now >= target.time && now < target.time + 60000) {
              if (!isAlarmActive) {
                  triggerAlarm();
              }
          }
      }
  };

  // --- ACTIVATE ENGINE ---
  const handleActivate = async () => {
      setAudioEnabled(true);
      
      // 1. Initialize Audio Context (User Gesture Required)
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!audioContextRef.current) {
          audioContextRef.current = new AudioContextClass();
      }
      await audioContextRef.current.resume();

      // 2. Start Silent Loop (Keep Awake Hack)
      if (silentAudioRef.current) {
          silentAudioRef.current.play().catch(e => console.error("Silent audio failed", e));
      }

      // 3. Request Wake Lock
      if ('wakeLock' in navigator) {
          try { await (navigator as any).wakeLock.request('screen'); } catch(e) {}
      }
      
      // 4. Start Web Worker (Background Timer)
      // This runs in a separate thread, so Chrome/iOS throttles it LESS than setInterval
      if (!workerRef.current) {
          workerRef.current = new Worker(new URL('/polling-worker.js', import.meta.url));
          workerRef.current.onmessage = (e) => {
              if (e.data === 'tick') handleTick();
          };
          workerRef.current.postMessage('start');
      }

      // 5. Initial Load
      checkData();
      if (isCloudEnabled()) initializePushNotifications();
  };

  const handleStop = () => {
      setAudioEnabled(false);
      setIsAlarmActive(false);
      stopDigitalSiren();
      
      if (silentAudioRef.current) silentAudioRef.current.pause();
      
      if (workerRef.current) {
          workerRef.current.postMessage('stop');
          workerRef.current.terminate();
          workerRef.current = null;
      }
  };

  // Setup on mount
  useEffect(() => {
      checkData();
      return () => {
          handleStop();
      };
  }, []);

  return (
    <div className={`min-h-screen text-white flex flex-col transition-colors duration-200 ${isAlarmActive ? 'bg-red-700' : 'bg-slate-900'}`}>
      
      {/* 1. SILENT AUDIO (Web Engine) */}
      <audio 
        ref={silentAudioRef} 
        src={SILENT_MP3} 
        loop 
        playsInline 
        autoPlay={false} 
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
                     {audioEnabled ? <span className="text-green-400 font-bold">● MONITOR ACTIVE</span> : <span className="text-slate-500">● PAUSED</span>}
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
                      Tap <b>ACTIVATE</b>. Do not close the app.
                  </p>
              </div>
          ) : (
              <div className="bg-slate-800 border border-slate-700 p-6 rounded-lg mb-6 relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-1 bg-green-500 animate-pulse"></div>
                   
                   <div className="text-center">
                       <p className="text-xs text-green-400 uppercase tracking-widest font-bold mb-1">
                           <i className="fas fa-wave-square mr-2"></i> 
                           Monitoring Background
                       </p>
                       <p className="text-4xl font-oswald text-white tabular-nums">
                           {new Date(currentTime).toLocaleTimeString([], { hour12: false })}
                       </p>
                       <p className="text-[10px] text-slate-500 mt-2">
                           If phone is locked, the <b>Notification</b> will ring.
                       </p>
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
