
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  createAlert, 
  saveAlert, 
  getScheduledAlerts, 
  deleteAlert, 
  getActiveAlerts,
  getRecurringAlerts,
  createRecurringAlert,
  saveRecurringAlert,
  toggleRecurringAlert,
  deleteRecurringAlert,
  getMonitorStatus
} from '../services/storage';
import { generateAlertContent } from '../services/gemini';
import { AlertMessage, AlertSeverity, RecurringAlert } from '../types';
import { Button } from '../components/Button';
import { AlertCard } from '../components/AlertCard';
import { isCloudEnabled, getBackendUrl, setBackendUrl } from '../services/config';

export const AdminDashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const navigate = useNavigate();
  // Common State
  const [content, setContent] = useState('');
  const [severity, setSeverity] = useState<AlertSeverity>(AlertSeverity.INFO);
  
  // Inputs
  const [timeInput, setTimeInput] = useState(''); // HH:MM (For Recurring)
  const [dateTimeInput, setDateTimeInput] = useState(''); // YYYY-MM-DDTHH:MM (For Manual)
  
  // Data State
  const [scheduledAlerts, setScheduledAlerts] = useState<AlertMessage[]>([]);
  const [sentHistory, setSentHistory] = useState<AlertMessage[]>([]);
  const [recurringAlerts, setRecurringAlerts] = useState<RecurringAlert[]>([]);
  
  // System State
  const [monitorStatus, setMonitorStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [isGenerating, setIsGenerating] = useState(false);
  // UPDATED: Default is now 'recurring' (Auto-Pilot) based on user request
  const [activeTab, setActiveTab] = useState<'create' | 'recurring' | 'scheduled' | 'history' | 'settings'>('recurring');
  
  // Mobile Nav State
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Settings State
  const [dbUrl, setDbUrl] = useState(getBackendUrl());
  const [isCloud, setIsCloud] = useState(isCloudEnabled());

  const refreshData = useCallback(async () => {
    setScheduledAlerts(await getScheduledAlerts());
    setSentHistory(await getActiveAlerts());
    setRecurringAlerts(await getRecurringAlerts());
    setIsCloud(isCloudEnabled());
    setDbUrl(getBackendUrl());

    // Check Monitor Status
    if (isCloudEnabled()) {
        const status = await getMonitorStatus();
        if (status) {
            // Consider online if seen in last 15 seconds (allow some buffer for network latency)
            const isAlive = (Date.now() - status.last_seen) < 15000 && status.online;
            setMonitorStatus(isAlive ? 'online' : 'offline');
        } else {
            setMonitorStatus('offline');
        }
    } else {
        setMonitorStatus('offline');
    }
  }, []);

  useEffect(() => {
    refreshData();
    // Check every 2 seconds
    const interval = setInterval(refreshData, 2000); 
    return () => clearInterval(interval);
  }, [refreshData]);

  const handleLogout = () => {
    onLogout();
    navigate('/');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content || !dateTimeInput) return;

    if (isCloud && monitorStatus === 'offline') {
        if (!window.confirm("⚠️ WARNING: The Cloud Server appears OFFLINE.\n\nPush notifications might not reach locked phones.\n\nSchedule anyway?")) {
            return;
        }
    }

    const scheduledDate = new Date(dateTimeInput);
    if (isNaN(scheduledDate.getTime())) {
        alert("Invalid Date");
        return;
    }

    const newAlert = createAlert(content, scheduledDate.getTime(), severity);
    await saveAlert(newAlert);
    
    resetForm();
    await refreshData();
    // Switch to scheduled tab to show the result
    setActiveTab('scheduled');
  };

  const handleCreateRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content || !timeInput) return;

    const newRecurring = createRecurringAlert(content, timeInput, severity);
    await saveRecurringAlert(newRecurring);

    resetForm();
    await refreshData();
    alert('Auto-Pilot Rule Created Successfully');
  };

  const resetForm = () => {
    setContent('');
    setTimeInput('');
    setDateTimeInput('');
    setSeverity(AlertSeverity.INFO);
  };

  const handleGenerateAI = async () => {
    if (!content) {
      alert("Please enter a topic first.");
      return;
    }
    setIsGenerating(true);
    try {
      const generated = await generateAlertContent(content, severity);
      setContent(generated);
    } catch (e) {
      alert("Failed to generate content");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if(window.confirm('Remove this alert?')) {
        await deleteAlert(id);
        await refreshData();
    }
  };

  const handleDeleteRecurring = async (id: string) => {
    await deleteRecurringAlert(id);
    await refreshData();
  };

  const handleToggleRecurring = async (id: string) => {
    await toggleRecurringAlert(id);
    await refreshData();
  };
  
  const handleSaveSettings = () => {
    if (dbUrl && !dbUrl.startsWith('https://')) {
        alert("URL must start with https://");
        return;
    }
    setBackendUrl(dbUrl);
    refreshData();
    alert("Database connection updated.");
  };

  const formatTime12h = (time24: string) => {
    if(!time24) return "";
    const [h, m] = time24.split(':');
    const d = new Date();
    d.setHours(parseInt(h), parseInt(m));
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const handleTabChange = (tab: any) => {
      setActiveTab(tab);
      setIsMobileMenuOpen(false); // Close menu on selection
  };

  // Validation helper
  const isUrlSuspicious = dbUrl && !dbUrl.includes('.firebaseio.com') && !dbUrl.includes('.firebasedatabase.app');
  const isUrlTypo = dbUrl && (dbUrl.endsWith('.co') || dbUrl.endsWith('.c'));

  // Get current date/time for min attribute
  const getCurrentDateTime = () => {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      return now.toISOString().slice(0, 16);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col md:flex-row">
      
      {/* MOBILE HEADER */}
      <div className="md:hidden bg-slate-800 p-4 flex justify-between items-center border-b border-slate-700 sticky top-0 z-50 shadow-lg">
         <div className="flex items-center gap-2">
            <i className="fas fa-shield-alt text-blue-500"></i>
            <h2 className="text-xl font-bold font-oswald text-white">ADMIN</h2>
         </div>
         <div className="flex items-center gap-3">
             {/* Mini Status on Mobile Header */}
             {monitorStatus === 'online' && (
                 <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-[0_0_10px_#22c55e]"></span>
             )}
             <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-white p-2 focus:outline-none">
               <i className={`fas ${isMobileMenuOpen ? 'fa-times' : 'fa-bars'} text-2xl`}></i>
             </button>
         </div>
      </div>

      {/* SIDEBAR NAVIGATION (Responsive) */}
      <aside className={`
          fixed inset-0 z-40 bg-slate-900/95 backdrop-blur-md transform transition-transform duration-300 ease-in-out
          md:relative md:translate-x-0 md:w-64 md:flex md:flex-col md:bg-slate-800 md:border-r md:border-slate-700
          ${isMobileMenuOpen ? 'translate-x-0 flex flex-col pt-20 px-6' : '-translate-x-full hidden'}
      `}>
        <div className="hidden md:block p-6 border-b border-slate-700">
           <h2 className="text-2xl font-bold font-oswald text-blue-400">ADMIN PANEL</h2>
           <p className="text-xs text-slate-500 mt-1">SENTINEL CONTROL</p>
        </div>
        
        {/* Connection Status Widget (Visible in menu) */}
        <div className="md:px-6 md:pt-4 mb-4 mt-4 md:mt-0">
           <div className={`p-3 rounded border space-y-2 transition-colors duration-500 ${monitorStatus === 'online' ? 'bg-green-900/10 border-green-800' : 'bg-red-900/10 border-red-800'}`}>
               {!isCloud ? (
                 <div className="flex items-center gap-2 text-xs text-yellow-500">
                    <i className="fas fa-exclamation-triangle"></i> Local Mode
                 </div>
               ) : (
                 <div className="flex items-center gap-2 text-xs text-slate-400">
                    <i className="fas fa-wifi"></i> DB Connected
                 </div>
               )}

               {isCloud && (
                   <div 
                      onClick={() => handleTabChange('settings')}
                      className={`flex flex-col gap-1 text-xs font-bold cursor-pointer hover:opacity-80 transition-opacity ${
                       monitorStatus === 'online' ? 'text-green-400' : 
                       monitorStatus === 'checking' ? 'text-yellow-400' : 'text-red-500'
                   }`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                            monitorStatus === 'online' ? 'bg-green-500 animate-pulse' : 
                            monitorStatus === 'checking' ? 'bg-yellow-500' : 'bg-red-500'
                        }`}></span>
                        {monitorStatus === 'online' ? 'CLOUD: ACTIVE' : monitorStatus === 'checking' ? 'Checking...' : 'CLOUD: OFFLINE'}
                      </div>
                      {monitorStatus === 'online' && (
                          <span className="text-[10px] text-green-600/80 font-normal pl-4">Safe to turn off PC</span>
                      )}
                   </div>
               )}
           </div>
        </div>
        
        <nav className="flex-1 md:p-4 space-y-2">
          {/* UPDATED: Auto-Pilot is now first */}
          <NavButton active={activeTab === 'recurring'} onClick={() => handleTabChange('recurring')} icon="fa-robot" label="Auto-Pilot Rules" />
          <NavButton active={activeTab === 'create'} onClick={() => handleTabChange('create')} icon="fa-paper-plane" label="Manual Alert" />
          <NavButton active={activeTab === 'scheduled'} onClick={() => handleTabChange('scheduled')} icon="fa-clock" label="Scheduled Queue" count={scheduledAlerts.length} />
          <NavButton active={activeTab === 'history'} onClick={() => handleTabChange('history')} icon="fa-history" label="History" />
          <NavButton active={activeTab === 'settings'} onClick={() => handleTabChange('settings')} icon="fa-cog" label="Settings" />
        </nav>

        <div className="p-4 border-t border-slate-700 mt-auto">
           <Button variant="outline" fullWidth onClick={handleLogout}>Logout</Button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 p-4 md:p-6 overflow-y-auto">
        
        {/* TAB: AUTO-PILOT (RECURRING) */}
        {activeTab === 'recurring' && (
          <div className="max-w-5xl mx-auto">
             
             {/* SERVER STATUS BANNER */}
             <div className={`mb-6 p-4 rounded-lg border flex items-center gap-4 ${monitorStatus === 'online' ? 'bg-green-900/20 border-green-800 text-green-100' : 'bg-red-900/20 border-red-800 text-red-100'}`}>
                 <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${monitorStatus === 'online' ? 'bg-green-800 text-white' : 'bg-red-800 text-white'}`}>
                     <i className={`fas ${monitorStatus === 'online' ? 'fa-cloud' : 'fa-plug'}`}></i>
                 </div>
                 <div className="flex-1">
                     <h3 className="font-bold text-lg">{monitorStatus === 'online' ? 'Auto-Pilot is Running 24/7' : 'Auto-Pilot Offline'}</h3>
                     <p className="text-sm opacity-80">
                         {monitorStatus === 'online' 
                            ? "Your Cloud Server is active. You can safely close this page and turn off your computer." 
                            : "The monitor script is not running. Automated alerts will NOT send. Please check Render."}
                     </p>
                 </div>
             </div>

             <div className="grid md:grid-cols-12 gap-8">
               
               {/* FORM */}
               <div className="md:col-span-5">
                  <h2 className="text-2xl md:text-3xl font-bold mb-6 font-oswald text-purple-400 flex items-center gap-2">
                      <i className="fas fa-plus-circle"></i> New Rule
                  </h2>
                  <form onSubmit={handleCreateRecurring} className="space-y-6 bg-slate-800 p-6 md:p-8 rounded-lg shadow-xl border border-slate-700">
                    <FormFields 
                      severity={severity} setSeverity={setSeverity}
                      isRecurring={true}
                      timeInput={timeInput} setTimeInput={setTimeInput}
                      content={content} setContent={setContent}
                      isGenerating={isGenerating} onGenerate={handleGenerateAI}
                    />
                    <div className="pt-4">
                      <Button type="submit" fullWidth disabled={isGenerating} className="bg-purple-600 hover:bg-purple-500">
                        <i className="fas fa-robot mr-2"></i> Set Auto-Pilot
                      </Button>
                    </div>
                  </form>
               </div>

               {/* LIST */}
               <div className="md:col-span-7">
                 <h2 className="text-2xl font-bold mb-6 font-oswald text-slate-300">Active Rules</h2>
                 {recurringAlerts.length === 0 ? (
                   <div className="text-slate-500 italic border border-dashed border-slate-700 p-8 rounded text-center">
                       <i className="fas fa-robot text-4xl mb-3 opacity-20"></i>
                       <p>No automated rules set.</p>
                   </div>
                 ) : (
                   <div className="space-y-4">
                     {recurringAlerts.map(rule => (
                       <div key={rule.id} className={`p-4 rounded-r-lg border-l-4 flex flex-col gap-2 shadow-lg transition-all ${rule.isActive ? 'bg-slate-800 border-purple-500' : 'bg-slate-800/50 border-slate-600 opacity-60'}`}>
                         <div className="flex justify-between items-center">
                           <div className="flex items-center gap-3">
                               <div className="bg-black/30 px-3 py-1 rounded text-xl font-mono font-bold text-white">
                                   {formatTime12h(rule.scheduledTime)}
                               </div>
                               <div className={`text-xs font-bold px-2 py-0.5 rounded border ${rule.severity === 'CRITICAL' ? 'border-red-500 text-red-400' : rule.severity === 'WARNING' ? 'border-yellow-500 text-yellow-400' : 'border-blue-500 text-blue-400'}`}>
                                   {rule.severity}
                               </div>
                           </div>
                           <div className="flex gap-2">
                             <button type="button" onClick={() => handleToggleRecurring(rule.id)} className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${rule.isActive ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                                 <i className={`fas ${rule.isActive ? 'fa-power-off' : 'fa-play'}`}></i>
                             </button>
                             <button type="button" onClick={(e) => { e.preventDefault(); handleDeleteRecurring(rule.id); }} className="w-8 h-8 flex items-center justify-center bg-red-900/50 hover:bg-red-600 text-red-200 hover:text-white rounded-full transition-colors">
                                 <i className="fas fa-trash text-xs"></i>
                             </button>
                           </div>
                         </div>
                         <p className="text-sm text-slate-300 pl-1 border-l-2 border-slate-700 ml-1 mt-1">{rule.content}</p>
                         <div className="text-[10px] text-slate-500 text-right mt-1">Runs Daily</div>
                       </div>
                     ))}
                   </div>
                 )}
               </div>
             </div>
          </div>
        )}

        {/* TAB: MANUAL ALERT */}
        {activeTab === 'create' && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-6 font-oswald flex items-center gap-3 text-blue-400">
                <i className="fas fa-paper-plane"></i> Manual Broadcast
            </h2>
            <form onSubmit={handleCreate} className="space-y-6 bg-slate-800 p-6 md:p-8 rounded-lg shadow-xl border border-slate-700">
              <FormFields 
                severity={severity} setSeverity={setSeverity}
                isRecurring={false}
                timeInput={dateTimeInput} setTimeInput={setDateTimeInput}
                content={content} setContent={setContent}
                isGenerating={isGenerating} onGenerate={handleGenerateAI}
                minDate={getCurrentDateTime()}
              />
              <div className="pt-4">
                <Button type="submit" fullWidth disabled={isGenerating}>
                  <i className="fas fa-check mr-2"></i> Schedule One-Time Alert
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* TAB: SCHEDULED */}
        {activeTab === 'scheduled' && (
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-6 font-oswald text-blue-400">Scheduled Queue</h2>
            {scheduledAlerts.length === 0 ? (
                <div className="text-slate-500 italic border border-dashed border-slate-700 p-8 rounded text-center">
                   <p>No one-time alerts in queue.</p>
                </div>
            ) : scheduledAlerts.map(alert => <AlertCard key={alert.id} alert={alert} isAdmin onDelete={handleDelete} />)}
          </div>
        )}

        {/* TAB: HISTORY */}
        {activeTab === 'history' && (
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-6 font-oswald text-slate-400">History (Last 15m)</h2>
            {sentHistory.length === 0 ? <p className="text-slate-500 italic">No recent history.</p> : sentHistory.map(alert => <div key={alert.id} className="opacity-75"><AlertCard alert={alert} isAdmin onDelete={alert.id.startsWith('recurring') ? undefined : handleDelete} /></div>)}
          </div>
        )}
        
        {/* TAB: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto">
             <h2 className="text-2xl md:text-3xl font-bold mb-6 font-oswald text-slate-200">System Configuration</h2>
             <div className="space-y-6">
                
                {/* 1. DATABASE CONNECTION */}
                <div className="bg-slate-800 p-6 md:p-8 rounded-lg shadow-xl border border-slate-700">
                    <h3 className="text-lg font-bold text-white mb-4">1. Database Connection</h3>
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">Firebase Database URL</label>
                        <input 
                            type="text" 
                            placeholder="https://your-project.firebaseio.com" 
                            value={dbUrl} 
                            onChange={(e) => setDbUrl(e.target.value.trim())} 
                            className={`w-full bg-slate-900 border rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none ${isUrlTypo || isUrlSuspicious ? 'border-red-500' : 'border-slate-700'}`} 
                        />
                        {isUrlTypo && (
                             <p className="text-red-400 text-xs mt-2 animate-pulse font-bold">
                                ⚠️ It looks like there is a typo in your URL (ending in .co). It usually ends in <code>.com</code>.
                            </p>
                        )}
                        {!isUrlTypo && isUrlSuspicious && (
                            <p className="text-yellow-400 text-xs mt-2">
                                ⚠️ Standard Firebase URLs usually end in <code>.firebaseio.com</code> or <code>.firebasedatabase.app</code>.
                            </p>
                        )}
                    </div>
                    <div className="flex flex-col md:flex-row justify-between items-center pt-4 gap-4">
                        <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${isCloud ? 'bg-green-500' : 'bg-red-500'}`}></div>
                            <span className="text-sm font-medium">{isCloud ? 'Cloud Connected' : 'Local Mode'}</span>
                        </div>
                        <Button onClick={handleSaveSettings} fullWidth className="md:w-auto">Save & Connect</Button>
                    </div>
                </div>

                {/* 2. SERVER MONITOR KEYS */}
                <div className="bg-slate-800 p-6 md:p-8 rounded-lg shadow-xl border border-slate-700">
                    <h3 className="text-lg font-bold text-white mb-4">2. Cloud Server Status</h3>
                    
                    <div className="mt-4 border-t border-slate-700 pt-4">
                        
                        <div className={`p-4 rounded border text-sm space-y-2 ${monitorStatus === 'offline' ? 'bg-red-900/20 border-red-500' : 'bg-green-900/20 border-green-500'}`}>
                             <div className="flex items-center justify-between mb-2">
                                <span className="text-slate-300">Heartbeat:</span>
                                <span className={`font-bold ${monitorStatus === 'online' ? 'text-green-400' : 'text-red-500'}`}>{monitorStatus === 'online' ? 'ONLINE' : 'OFFLINE'}</span>
                            </div>
                            
                            {monitorStatus === 'online' ? (
                                <div className="text-green-300 text-xs">
                                    <i className="fas fa-check-circle mr-1"></i>
                                    System is healthy. Render.com is running the monitor script.
                                </div>
                            ) : (
                                <div className="text-red-300 text-xs">
                                    <i className="fas fa-exclamation-circle mr-1"></i>
                                    <b>Monitor Down:</b> Check Render Dashboard or Cron-Job.org.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

             </div>
          </div>
        )}
      </main>
    </div>
  );
};

const NavButton: React.FC<any> = ({ active, onClick, icon, label, count }) => (
    <button onClick={onClick} className={`w-full text-left px-4 py-3 rounded transition-colors flex items-center justify-between ${active ? 'bg-blue-600 shadow-lg' : 'text-slate-400 hover:bg-slate-700'}`}>
      <span><i className={`fas ${icon} w-6`}></i> {label}</span>
      {count > 0 && <span className="bg-slate-900 px-2 py-0.5 rounded-full text-xs font-bold">{count}</span>}
    </button>
);

// Updated form fields to handle Date-Time vs Time-Only
const FormFields: React.FC<any> = ({ 
    severity, setSeverity, 
    timeInput, setTimeInput, 
    content, setContent, 
    isGenerating, onGenerate, 
    isRecurring, minDate 
}) => (
  <>
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">Severity Level</label>
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        {(Object.values(AlertSeverity) as AlertSeverity[]).map((sev) => (
          <button key={sev} type="button" onClick={() => setSeverity(sev)} className={`py-3 rounded border-2 font-bold text-xs md:text-sm transition-all ${severity === sev ? sev === 'CRITICAL' ? 'border-red-500 bg-red-500/20 text-red-500' : sev === 'WARNING' ? 'border-yellow-500 bg-yellow-500/20 text-yellow-500' : 'border-blue-500 bg-blue-500/20 text-blue-500' : 'border-slate-600 text-slate-500 hover:bg-slate-700'}`}>{sev}</button>
        ))}
      </div>
    </div>
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">
          {isRecurring ? 'Time (Every Day)' : 'Scheduled Date & Time'}
      </label>
      
      {isRecurring ? (
          <input 
            type="time" 
            required 
            value={timeInput} 
            onChange={(e) => setTimeInput(e.target.value)} 
            className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono text-lg" 
          />
      ) : (
          <input 
            type="datetime-local" 
            required 
            min={minDate}
            value={timeInput} 
            onChange={(e) => setTimeInput(e.target.value)} 
            className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono text-lg" 
          />
      )}
    </div>
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">Message Content</label>
      <div className="relative">
        <textarea required value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="Enter alert message..." className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none pr-12" />
        {process.env.API_KEY && (
             <button type="button" onClick={onGenerate} disabled={isGenerating} className="absolute top-2 right-2 text-slate-400 hover:text-blue-400 p-2" title="Generate with AI"><i className={`fas ${isGenerating ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i></button>
        )}
      </div>
    </div>
  </>
);
