
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertMessage } from '../types';
import { getActiveAlerts, getNextEvent } from '../services/storage';
import { AlertCard } from '../components/AlertCard';
import { Button } from '../components/Button';
import { isCloudEnabled } from '../services/config';
import { initializePushNotifications } from '../services/firebase';

// 1. SILENT MP3 (Base64) - Plays continuously to keep the browser tab awake
const SILENT_MP3 = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAASAAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA//OEZAAAAAABIAAAAAAAAAAAASAAK8AAAASAAAAA";

export const UserBroadcast: React.FC = () => {
  const navigate = useNavigate();
  
  // UI State
  const [alerts, setAlerts] = useState<AlertMessage[]>([]);
  const [nextEvent, setNextEvent] = useState<{ time: number, content: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  
  // Refs for Engine
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const nextEventRef = useRef<{ time: number, content: string } | null>(null);
  const loopIdRef = useRef<any>(null);

  // Digital Siren Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  
  // --- DIGITAL SIREN (Web Audio API) ---
  // This generates sound via code, no MP3 file needed.
  const startDigitalSiren = () => {
      try {
          if (!audioContextRef.current) {
              audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
          }

          const ctx = audioContextRef.current;
          
          // Resume context if suspended (common in browsers)
          if (ctx.state === 'suspended') {
              ctx.resume();
          }

          // Create Oscillator (The sound generator)
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sawtooth'; // Harsh sound
          osc.frequency.value = 600; // Start freq

          // LFO to modulate frequency (Make it wail up and down)
          const lfo = ctx.createOscillator();
          lfo.type = 'sine';
          lfo.frequency.value = 2; // Speed of wail (2 Hz)
          
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = 400; // Depth of wail (+- 400Hz)

          lfo.connect(lfoGain);
          lfoGain.connect(osc.frequency);
          
          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start();
          lfo.start();

          // Save refs to stop later
          oscillatorRef.current = osc;
          gainNodeRef.current = gain;
          
          // Ramp volume up
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 0.1);

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
      if (audioContextRef.current) {
          // Don't close context, just suspend to keep it ready
          audioContextRef.current.suspend(); 
      }
  };
  
  // --- ALARM TRIGGER ---
  const triggerAlarm = useCallback(() => {
    console.log("🚨 ALARM TRIGGERED");
    setIsAlarmActive(true);

    // 1. Play Digital Siren
    startDigitalSiren();

    // 2. Vibrate
    if (navigator.vibrate) {
        navigator.vibrate([1000, 200, 1000, 200, 2000]);
    }

    // 3. Stop after 30 seconds
    setTimeout(() => stopAlarm(), 30000);
  }, []);

  const stopAlarm = () => {
      setIsAlarmActive(false);
      stopDigitalSiren();
      if (navigator.vibrate) navigator.vibrate(0);
      checkData();
  };

  // --- DATA CHECK ---
  const checkData = async () => {
      const currentAlerts = await getActiveAlerts();
      setAlerts(currentAlerts);

      const next = await getNextEvent();
      setNextEvent(next);
      nextEventRef.current = next;
  };

  // --- THE TICKER (Runs every 1s) ---
  const tick = () => {
      const now = Date.now();
      setCurrentTime(now); 

      const target = nextEventRef.current;
      if (target) {
          // Check if we hit the target time (within 1 min window)
          if (now >= target.time && now < target.time + 60000) {
              if (!isAlarmActive) {
                  triggerAlarm();
                  // Prevent immediate re-trigger
                  nextEventRef.current = null;
                  setNextEvent(null); 
              }
          }
      }
  };

  // --- ACTIVATE ENGINE ---
  const handleActivate = async () => {
      setAudioEnabled(true);
      
      // 1. Initialize Audio Context on user click (Required by browsers)
      if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      // Resume immediately to unlock audio subsystem
      if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
      }

      // 2. Start Silent Loop (Keeps tab throttled less)
      if (silentAudioRef.current) {
          silentAudioRef.current.play().catch(e => console.error("Silent audio failed", e));
      }

      // 3. Request Wake Lock (Keep screen on)
      if ('wakeLock' in navigator) {
          try { await (navigator as any).wakeLock.request('screen'); } catch(e) {}
      }
      
      // 4. Start Interval
      if (loopIdRef.current) clearInterval(loopIdRef.current);
      loopIdRef.current = setInterval(() => {
          tick();
          // Check data sync every 5 seconds
          if (Date.now() % 5000 < 1000) checkData();
      }, 1000);

      // 5. Initial Load
      checkData();
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
          stopDigitalSiren();
      };
  }, []);

  return (
    <div className={`min-h-screen text-white flex flex-col transition-colors duration-500 ${isAlarmActive ? 'alarm-flash' : 'bg-slate-900'}`}>
      
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
