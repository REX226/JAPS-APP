
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
  const [timeInput, setTimeInput] = useState(''); // HH:MM
  
  // Data State
  const [scheduledAlerts, setScheduledAlerts] = useState<AlertMessage[]>([]);
  const [sentHistory, setSentHistory] = useState<AlertMessage[]>([]);
  const [recurringAlerts, setRecurringAlerts] = useState<RecurringAlert[]>([]);
  
  // System State
  const [monitorStatus, setMonitorStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'create' | 'recurring' | 'scheduled' | 'history' | 'settings'>('create');
  
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
            // Consider online if seen in last 10 seconds (allow some buffer for network latency)
            const isAlive = (Date.now() - status.last_seen) < 10000 && status.online;
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
    // ✅ REDUCED TO 2 SECONDS
    const interval = setInterval(refreshData, 2000); 
    return () => clearInterval(interval);
  }, [refreshData]);

  const handleLogout = () => {
    onLogout();
    navigate('/');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content || !timeInput) return;

    if (isCloud && monitorStatus === 'offline') {
        if (!window.confirm("⚠️ WARNING: The Monitor Script is OFFLINE.\n\nPush notifications will NOT be sent to closed apps.\n\nRun 'npm run monitor' on your PC to fix this.\n\nSchedule anyway?")) {
            return;
        }
    }

    const now = new Date();
    const [hours, minutes] = timeInput.split(':').map(Number);
    const scheduledDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

    const newAlert = createAlert(content, scheduledDate.getTime(), severity);
    await saveAlert(newAlert);
    
    resetForm();
    await refreshData();
    alert('One-time Alert Scheduled Successfully');
  };

  const handleCreateRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content || !timeInput) return;

    const newRecurring = createRecurringAlert(content, timeInput, severity);
    await saveRecurringAlert(newRecurring);

    resetForm();
    await refreshData();
    alert('Recurring Alert Created Successfully');
  };

  const resetForm = () => {
    setContent('');
    setTimeInput('');
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

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col md:flex-row">
      
      {/* MOBILE HEADER */}
      <div className="md:hidden bg-slate-800 p-4 flex justify-between items-center border-b border-slate-700 sticky top-0 z-50 shadow-lg">
         <div className="flex items-center gap-2">
            <i className="fas fa-shield-alt text-blue-500"></i>
            <h2 className="text-xl font-bold font-oswald text-white">ADMIN</h2>
         </div>
         <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="text-white p-2 focus:outline-none">
           <i className={`fas ${isMobileMenuOpen ? 'fa-times' : 'fa-bars'} text-2xl`}></i>
         </button>
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
           <div className="bg-slate-950/50 p-3 rounded border border-slate-700 space-y-2">
               {!isCloud ? (
                 <div className="flex items-center gap-2 text-xs text-yellow-500">
                    <i className="fas fa-exclamation-triangle"></i> Local Mode
                 </div>
               ) : (
                 <div className="flex items-center gap-2 text-xs text-green-400">
                    <i className="fas fa-wifi"></i> DB Connected
                 </div>
               )}

               {isCloud && (
                   <div 
                      onClick={() => handleTabChange('settings')}
                      className={`flex items-center gap-2 text-xs font-bold cursor-pointer hover:opacity-80 transition-opacity ${
                       monitorStatus === 'online' ? 'text-green-400' : 
                       monitorStatus === 'checking' ? 'text-yellow-400' : 'text-red-500'
                   }`}>
                      <span className={`w-2 h-2 rounded-full ${
                          monitorStatus === 'online' ? 'bg-green-500 animate-pulse' : 
                          monitorStatus === 'checking' ? 'bg-yellow-500' : 'bg-red-500'
                      }`}></span>
                      {monitorStatus === 'online' ? 'Monitor: ONLINE' : monitorStatus === 'checking' ? 'Checking...' : 'Monitor: OFFLINE'}
                   </div>
               )}
           </div>
        </div>
        
        <nav className="flex-1 md:p-4 space-y-2">
          <NavButton active={activeTab === 'create'} onClick={() => handleTabChange('create')} icon="fa-plus-circle" label="One-Time Alert" />
          <NavButton active={activeTab === 'recurring'} onClick={() => handleTabChange('recurring')} icon="fa-sync-alt" label="Recurring Alerts" />
          <NavButton active={activeTab === 'scheduled'} onClick={() => handleTabChange('scheduled')} icon="fa-clock" label="Scheduled" count={scheduledAlerts.length} />
          <NavButton active={activeTab === 'history'} onClick={() => handleTabChange('history')} icon="fa-history" label="History" />
          <NavButton active={activeTab === 'settings'} onClick={() => handleTabChange('settings')} icon="fa-cog" label="Settings & Keys" />
        </nav>

        <div className="p-4 border-t border-slate-700 mt-auto">
           <Button variant="outline" fullWidth onClick={handleLogout}>Logout</Button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 p-4 md:p-6 overflow-y-auto">
        {/* CREATE ONE-TIME */}
        {activeTab === 'create' && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-6 font-oswald flex items-center gap-3">
                <i className="fas fa-bullhorn text-blue-500"></i> One-Time Broadcast
            </h2>
            <form onSubmit={handleCreate} className="space-y-6 bg-slate-800 p-6 md:p-8 rounded-lg shadow-xl border border-slate-700">
              <FormFields 
                severity={severity} setSeverity={setSeverity}
                timeInput={timeInput} setTimeInput={setTimeInput}
                content={content} setContent={setContent}
                isGenerating={isGenerating} onGenerate={handleGenerateAI}
              />
              <div className="pt-4">
                <Button type="submit" fullWidth disabled={isGenerating}>
                  <i className="fas fa-paper-plane mr-2"></i> Schedule Today
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* CREATE RECURRING */}
        {activeTab === 'recurring' && (
          <div className="max-w-4xl mx-auto">
             <div className="grid md:grid-cols-2 gap-8">
               <div>
                  <h2 className="text-2xl md:text-3xl font-bold mb-6 font-oswald text-purple-400">Recurring Rule</h2>
                  <form onSubmit={handleCreateRecurring} className="space-y-6 bg-slate-800 p-6 md:p-8 rounded-lg shadow-xl border border-slate-700">
                    <FormFields 
                      severity={severity} setSeverity={setSeverity}
                      timeInput={timeInput} setTimeInput={setTimeInput}
                      content={content} setContent={setContent}
                      isGenerating={isGenerating} onGenerate={handleGenerateAI}
                    />
                    <div className="pt-4">
                      <Button type="submit" fullWidth disabled={isGenerating} className="bg-purple-600 hover:bg-purple-500">
                        <i className="fas fa-save mr-2"></i> Save Rule
                      </Button>
                    </div>
                  </form>
               </div>
               <div>
                 <h2 className="text-2xl font-bold mb-6 font-oswald text-slate-400">Active Rules</h2>
                 {recurringAlerts.length === 0 ? (
                   <div className="text-slate-500 italic border border-dashed border-slate-700 p-8 rounded text-center">No recurring rules.</div>
                 ) : (
                   <div className="space-y-4">
                     {recurringAlerts.map(rule => (
                       <div key={rule.id} className={`p-4 rounded border-l-4 flex flex-col gap-2 shadow bg-slate-800 ${rule.isActive ? 'border-purple-500' : 'border-slate-600 opacity-60'}`}>
                         <div className="flex justify-between items-start">
                           <div className="font-mono text-xl font-bold text-white">{formatTime12h(rule.scheduledTime)}</div>
                           <div className="flex gap-2">
                             <button type="button" onClick={() => handleToggleRecurring(rule.id)} className={`px-2 py-1 text-xs rounded font-bold uppercase ${rule.isActive ? 'bg-green-900 text-green-400' : 'bg-slate-700 text-slate-400'}`}>{rule.isActive ? 'Active' : 'Paused'}</button>
                             <button type="button" onClick={(e) => { e.preventDefault(); handleDeleteRecurring(rule.id); }} className="w-8 h-8 flex items-center justify-center bg-red-600 hover:bg-red-500 text-white rounded"><i className="fas fa-trash text-xs"></i></button>
                           </div>
                         </div>
                         <div className={`text-xs font-bold uppercase ${rule.severity === 'CRITICAL' ? 'text-red-400' : rule.severity === 'WARNING' ? 'text-yellow-400' : 'text-blue-400'}`}>{rule.severity}</div>
                         <p className="text-sm text-slate-300">{rule.content}</p>
                       </div>
                     ))}
                   </div>
                 )}
               </div>
             </div>
          </div>
        )}

        {/* Scheduled List */}
        {activeTab === 'scheduled' && (
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-6 font-oswald text-blue-400">Scheduled Queue</h2>
            {scheduledAlerts.length === 0 ? <p className="text-slate-500 italic">No alerts scheduled.</p> : scheduledAlerts.map(alert => <AlertCard key={alert.id} alert={alert} isAdmin onDelete={handleDelete} />)}
          </div>
        )}

        {/* History List */}
        {activeTab === 'history' && (
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-6 font-oswald text-slate-400">History</h2>
            {sentHistory.length === 0 ? <p className="text-slate-500 italic">No history.</p> : sentHistory.map(alert => <div key={alert.id} className="opacity-75"><AlertCard alert={alert} isAdmin onDelete={alert.id.startsWith('recurring') ? undefined : handleDelete} /></div>)}
          </div>
        )}
        
        {/* Settings Tab */}
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
                    <h3 className="text-lg font-bold text-white mb-4">2. Server Monitor</h3>
                    
                    <div className="mt-4 border-t border-slate-700 pt-4">
                        <h4 className="font-bold text-slate-300 mb-2">Debug Monitor Connection</h4>
                        
                        <div className={`p-4 rounded border text-sm space-y-2 ${monitorStatus === 'offline' ? 'bg-red-900/20 border-red-500' : 'bg-slate-900 border-slate-600'}`}>
                             <div className="flex items-center justify-between mb-2">
                                <span className="text-slate-400">Current Status:</span>
                                <span className={`font-bold ${monitorStatus === 'online' ? 'text-green-400' : 'text-red-500'}`}>{monitorStatus === 'online' ? 'ONLINE' : 'OFFLINE'}</span>
                            </div>
                            
                            {monitorStatus === 'offline' && (
                              <div className="text-red-300 text-xs mb-3 font-bold">
                                <i className="fas fa-exclamation-circle mr-1"></i>
                                Action Required: The URL in this dashboard must match the URL used by the monitor script.
                              </div>
                            )}
                            
                            <p className="text-slate-400 mb-2">
                                To fix OFFLINE, open <code>monitor-local.js</code> and change <strong>MANUAL_DB_URL</strong> to:
                            </p>
                            
                            <div className="flex gap-2">
                                <code className="block bg-black p-2 rounded text-green-400 flex-1 overflow-x-auto whitespace-nowrap font-mono select-all">
                                    {dbUrl || 'No Database URL Set'}
                                </code>
                            </div>
                        </div>

                        <div className="mt-4 text-xs text-slate-500">
                           <p>Running the monitor script:</p>
                           <code className="block bg-slate-950 p-2 mt-1 rounded text-slate-300">npm run monitor</code>
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
    <button onClick={onClick} className={`w-full text-left px-4 py-3 rounded transition-colors flex items-center justify-between ${active ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-700'}`}>
      <span><i className={`fas ${icon} w-6`}></i> {label}</span>
      {count > 0 && <span className="bg-slate-900 px-2 py-0.5 rounded-full text-xs font-bold">{count}</span>}
    </button>
);

const FormFields: React.FC<any> = ({ severity, setSeverity, timeInput, setTimeInput, content, setContent, isGenerating, onGenerate }) => (
  <>
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">Severity Level</label>
      <div className="grid grid-cols-3 gap-2 md:gap-4">
        {(Object.values(AlertSeverity) as AlertSeverity[]).map((sev) => (
          <button key={sev} type="button" onClick={() => setSeverity(sev)} className={`py-3 rounded border-2 font-bold text-xs md:text-sm ${severity === sev ? sev === 'CRITICAL' ? 'border-red-500 bg-red-500/20 text-red-500' : sev === 'WARNING' ? 'border-yellow-500 bg-yellow-500/20 text-yellow-500' : 'border-blue-500 bg-blue-500/20 text-blue-500' : 'border-slate-600 text-slate-500'}`}>{sev}</button>
        ))}
      </div>
    </div>
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">Time (HH:MM)</label>
      <input type="time" required value={timeInput} onChange={(e) => setTimeInput(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono text-lg" />
    </div>
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">Message Content</label>
      <div className="relative">
        <textarea required value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="Enter alert message..." className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none pr-12" />
        <button type="button" onClick={onGenerate} disabled={isGenerating} className="absolute top-2 right-2 text-slate-400 hover:text-blue-400 p-2"><i className={`fas ${isGenerating ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`}></i></button>
      </div>
    </div>
  </>
);
