
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertMessage } from '../types';
import { getActiveAlerts, getNextEvent } from '../services/storage';
import { AlertCard } from '../components/AlertCard';
import { Button } from '../components/Button';
import { isCloudEnabled } from '../services/config';
import { initializePushNotifications } from '../services/firebase';

// 1. SILENT WAV (Base64) - Universally supported "Keep Awake" file
const SILENT_AUDIO = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

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
  const loopIdRef = useRef<any>(null);
  
  // 1. PREVENT LOOPING: Keep track of alerts we have already played
  // We use a string key: "timestamp-content" to uniquely identify an event instance
  const processedKeysRef = useRef<Set<string>>(new Set());

  // Digital Siren Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  
  // --- DIGITAL SIREN (Web Audio API) ---
  const playOneSecondSiren = () => {
      try {
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!audioContextRef.current) {
              audioContextRef.current = new AudioContextClass();
          }

          const ctx = audioContextRef.current;
          
          if (ctx.state === 'suspended') {
              ctx.resume();
          }

          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          // SIREN SOUND: Sawtooth wave (Classic Siren Texture)
          osc.type = 'sawtooth'; 
          osc.frequency.value = 600; // Base frequency

          // LFO (The "Wail") - Faster wail (4Hz) to fit in 1 second
          const lfo = ctx.createOscillator();
          lfo.type = 'sine';
          lfo.frequency.value = 4; 
          
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = 200; // Modulation depth

          lfo.connect(lfoGain);
          lfoGain.connect(osc.frequency);
          
          osc.connect(gain);
          gain.connect(ctx.destination);

          // ENVELOPE: Ramp up, sustain, then fade out smoothly
          const now = ctx.currentTime;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.5, now + 0.1); // Volume 50% (Siren is loud)
          gain.gain.setValueAtTime(0.5, now + 0.8);
          gain.gain.linearRampToValueAtTime(0.001, now + 1.0); // Fade out to avoid click

          osc.start(now);
          lfo.start(now);
          
          osc.stop(now + 1.0);
          lfo.stop(now + 1.0);

          oscillatorRef.current = osc;

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
      // We do NOT suspend context here, keeping it hot for the silent loop
  };
  
  // --- ALARM TRIGGER ---
  const triggerAlarm = useCallback((eventKey: string) => {
    console.log("🚨 ALARM TRIGGERED for:", eventKey);
    
    // Mark as processed IMMEDIATELY so it doesn't loop
    processedKeysRef.current.add(eventKey);
    
    setIsAlarmActive(true);

    // 1. Play Siren (1 Sec)
    playOneSecondSiren();

    // 2. Vibrate (1 second)
    if (navigator.vibrate) {
        navigator.vibrate([1000]);
    }

    // 3. UI Auto-Stop after 1 second
    setTimeout(() => {
        setIsAlarmActive(false);
        stopDigitalSiren(); 
        checkData(); // Refresh list
    }, 1000);
  }, []);

  // --- DATA CHECK ---
  const checkData = async () => {
      const currentAlerts = await getActiveAlerts();
      setAlerts(currentAlerts);

      const next = await getNextEvent();
      nextEventRef.current = next;
  };

  // --- THE TICKER ---
  const tick = () => {
      const now = Date.now();
      setCurrentTime(now); 

      const target = nextEventRef.current;
      if (target) {
          // Check if inside the 60-second window
          if (now >= target.time && now < target.time + 60000) {
              
              // CREATE UNIQUE KEY
              const eventKey = `${target.time}-${target.content.substring(0, 10)}`;

              // CHECK IF ALREADY PLAYED
              if (!processedKeysRef.current.has(eventKey) && !isAlarmActive) {
                  triggerAlarm(eventKey);
              }
          }
      }
  };

  // --- ACTIVATE ENGINE ---
  const handleActivate = async () => {
      setAudioEnabled(true);
      
      try {
          // 1. Initialize Audio Context
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          if (!audioContextRef.current) {
              audioContextRef.current = new AudioContextClass();
          }
          if (audioContextRef.current.state === 'suspended') {
              await audioContextRef.current.resume();
          }

          // 2. Start Silent Loop (Keep Awake)
          if (silentAudioRef.current) {
              silentAudioRef.current.src = SILENT_AUDIO;
              silentAudioRef.current.load();
              await silentAudioRef.current.play().catch(e => console.error("Silent play failed (non-fatal):", e));
          }

          // 3. Request Wake Lock
          if ('wakeLock' in navigator) {
              try { await (navigator as any).wakeLock.request('screen'); } catch(e) {}
          }
          
          // 4. Start Interval
          if (loopIdRef.current) clearInterval(loopIdRef.current);
          loopIdRef.current = setInterval(() => {
              tick();
              if (Date.now() % 5000 < 1000) checkData();
          }, 1000);

          // 5. Initial Load
          checkData();
          if (isCloudEnabled()) initializePushNotifications();

      } catch (e) {
          console.error("Activation Error:", e);
          alert("Could not start audio engine. Please try again.");
      }
  };

  const handleStop = () => {
      setAudioEnabled(false);
      setIsAlarmActive(false);
      stopDigitalSiren();
      if (silentAudioRef.current) {
          silentAudioRef.current.pause();
          silentAudioRef.current.currentTime = 0;
      }
      if (loopIdRef.current) clearInterval(loopIdRef.current);
  };

  useEffect(() => {
      checkData();
      return () => {
          if (loopIdRef.current) clearInterval(loopIdRef.current);
          stopDigitalSiren();
      };
  }, []);

  return (
    <div className={`min-h-screen text-white flex flex-col transition-colors duration-200 ${isAlarmActive ? 'bg-red-700' : 'bg-slate-900'}`}>
      
      {/* 1. SILENT AUDIO (Web Engine) */}
      <audio 
        ref={silentAudioRef} 
        loop 
        playsInline 
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
                      Tap <b>ACTIVATE</b> to start the monitor.
                  </p>
              </div>
          ) : (
              <div className="bg-slate-800 border border-slate-700 p-6 rounded-lg mb-6 relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-full h-1 bg-green-500 animate-pulse"></div>
                   
                   <div className="text-center">
                       <p className="text-xs text-green-400 uppercase tracking-widest font-bold mb-1">
                           <i className="fas fa-wave-square mr-2"></i> 
                           Web Monitor Running
                       </p>
                       <p className="text-4xl font-oswald text-white tabular-nums">
                           {new Date(currentTime).toLocaleTimeString([], { hour12: false })}
                       </p>
                       <p className="text-[10px] text-slate-500 mt-2">
                           Do not close this tab. Screen can be turned off if supported.
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
