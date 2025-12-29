
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
            // Consider online if seen in last 15 seconds
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
    const interval = setInterval(refreshData, 5000); 
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

  const getNextOccurrence = (timeStr: string) => {
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const trigger = new Date(now);
    trigger.setHours(hours, minutes, 0, 0);
    if (trigger.getTime() <= now.getTime()) trigger.setDate(trigger.getDate() + 1);
    const isToday = trigger.getDate() === now.getDate();
    return `${isToday ? 'Today' : 'Tomorrow'} at ${trigger.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-6 border-b border-slate-700">
           <h2 className="text-2xl font-bold font-oswald text-blue-400">ADMIN PANEL</h2>
           <p className="text-xs text-slate-500 mt-1">SENTINEL CONTROL</p>
           
           <div className="mt-4 bg-slate-900 p-3 rounded border border-slate-700 space-y-2">
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
                   <div className={`flex items-center gap-2 text-xs font-bold ${
                       monitorStatus === 'online' ? 'text-green-400' : 
                       monitorStatus === 'checking' ? 'text-yellow-400' : 'text-red-500'
                   }`}>
                      <span className={`w-2 h-2 rounded-full ${
                          monitorStatus === 'online' ? 'bg-green-500 animate-pulse' : 
                          monitorStatus === 'checking' ? 'bg-yellow-500' : 'bg-red-500'
                      }`}></span>
                      {monitorStatus === 'online' ? 'Monitor: ONLINE' : monitorStatus === 'checking' ? 'Monitor: CHECKING...' : 'Monitor: OFFLINE'}
                   </div>
               )}
               {isCloud && monitorStatus === 'offline' && (
                   <p className="text-[10px] text-red-400 leading-tight mt-1">
                       Run 'npm run monitor' on PC.
                   </p>
               )}
           </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <button onClick={() => setActiveTab('create')} className={`w-full text-left px-4 py-3 rounded transition-colors ${activeTab === 'create' ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-700'}`}>
            <i className="fas fa-plus-circle mr-3"></i> One-Time Alert
          </button>
          <button onClick={() => setActiveTab('recurring')} className={`w-full text-left px-4 py-3 rounded transition-colors ${activeTab === 'recurring' ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-700'}`}>
            <i className="fas fa-sync-alt mr-3"></i> Recurring Alerts
          </button>
          <button onClick={() => setActiveTab('scheduled')} className={`w-full text-left px-4 py-3 rounded transition-colors ${activeTab === 'scheduled' ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-700'}`}>
            <i className="fas fa-clock mr-3"></i> Scheduled
            {scheduledAlerts.length > 0 && <span className="ml-auto bg-slate-900 px-2 py-0.5 rounded-full text-xs float-right">{scheduledAlerts.length}</span>}
          </button>
          <button onClick={() => setActiveTab('history')} className={`w-full text-left px-4 py-3 rounded transition-colors ${activeTab === 'history' ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-700'}`}>
            <i className="fas fa-history mr-3"></i> History
          </button>
          <button onClick={() => setActiveTab('settings')} className={`w-full text-left px-4 py-3 rounded transition-colors ${activeTab === 'settings' ? 'bg-blue-600' : 'text-slate-400 hover:bg-slate-700'}`}>
            <i className="fas fa-cog mr-3"></i> Settings & Keys
          </button>
        </nav>

        <div className="p-4 border-t border-slate-700">
           <Button variant="outline" fullWidth onClick={handleLogout}>Logout</Button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
        {/* CREATE ONE-TIME */}
        {activeTab === 'create' && (
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold mb-6 font-oswald">One-Time Broadcast</h2>
            <form onSubmit={handleCreate} className="space-y-6 bg-slate-800 p-8 rounded-lg shadow-xl border border-slate-700">
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
                  <h2 className="text-3xl font-bold mb-6 font-oswald text-purple-400">Recurring Rule</h2>
                  <form onSubmit={handleCreateRecurring} className="space-y-6 bg-slate-800 p-8 rounded-lg shadow-xl border border-slate-700">
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
            <h2 className="text-3xl font-bold mb-6 font-oswald text-blue-400">Scheduled Queue</h2>
            {scheduledAlerts.length === 0 ? <p className="text-slate-500 italic">No alerts scheduled.</p> : scheduledAlerts.map(alert => <AlertCard key={alert.id} alert={alert} isAdmin onDelete={handleDelete} />)}
          </div>
        )}

        {/* History List */}
        {activeTab === 'history' && (
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold mb-6 font-oswald text-slate-400">History</h2>
            {sentHistory.length === 0 ? <p className="text-slate-500 italic">No history.</p> : sentHistory.map(alert => <div key={alert.id} className="opacity-75"><AlertCard alert={alert} isAdmin onDelete={alert.id.startsWith('recurring') ? undefined : handleDelete} /></div>)}
          </div>
        )}
        
        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto">
             <h2 className="text-3xl font-bold mb-6 font-oswald text-slate-200">System Configuration</h2>
             <div className="space-y-6">
                
                {/* 1. DATABASE CONNECTION */}
                <div className="bg-slate-800 p-8 rounded-lg shadow-xl border border-slate-700">
                    <h3 className="text-lg font-bold text-white mb-4">1. Database Connection</h3>
                    <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Firebase Database URL</label>
                    <input type="text" placeholder="https://your-project.firebaseio.com" value={dbUrl} onChange={(e) => setDbUrl(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="flex justify-between items-center pt-4">
                    <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${isCloud ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="text-sm font-medium">{isCloud ? 'Cloud Connected' : 'Local Mode'}</span>
                    </div>
                    <Button onClick={handleSaveSettings}>Save & Connect</Button>
                    </div>
                </div>

                {/* 2. SERVER MONITOR KEYS */}
                <div className="bg-slate-800 p-8 rounded-lg shadow-xl border border-slate-700">
                    <h3 className="text-lg font-bold text-white mb-4">2. Server Keys (Secret Generation)</h3>
                    <p className="text-sm text-slate-400 mb-4">
                        To enable the "Monitor" script (which sends Push Notifications to closed apps), you need a Service Account Key file.
                    </p>
                    
                    <div className="bg-slate-900 p-4 rounded border border-slate-600 text-sm space-y-2 font-mono text-slate-300">
                        <p className="text-blue-400 font-bold">// HOW TO GENERATE KEY:</p>
                        <p>1. Go to Firebase Console &rarr; Project Settings.</p>
                        <p>2. Tab: <strong>Service Accounts</strong>.</p>
                        <p>3. Click <strong>Generate New Private Key</strong>.</p>
                        <p>4. Save the file as <span className="text-yellow-400">service-account.json</span> in your project root.</p>
                        <p>5. Run <span className="text-green-400">npm run monitor</span>.</p>
                    </div>

                    <div className="mt-6 border-t border-slate-700 pt-4">
                        <h4 className="font-bold text-slate-300 mb-2">Monitor Status Check</h4>
                        <div className="flex items-center justify-between bg-slate-900/50 p-3 rounded">
                            <span className="text-sm">Current Status:</span>
                            <span className={`text-sm font-bold ${monitorStatus === 'online' ? 'text-green-400' : monitorStatus === 'checking' ? 'text-yellow-400' : 'text-red-500'}`}>{monitorStatus === 'online' ? 'ONLINE' : monitorStatus === 'checking' ? 'CHECKING...' : 'OFFLINE'}</span>
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

const FormFields: React.FC<any> = ({ severity, setSeverity, timeInput, setTimeInput, content, setContent, isGenerating, onGenerate }) => (
  <>
    <div>
      <label className="block text-sm font-medium text-slate-400 mb-2">Severity Level</label>
      <div className="grid grid-cols-3 gap-4">
        {(Object.values(AlertSeverity) as AlertSeverity[]).map((sev) => (
          <button key={sev} type="button" onClick={() => setSeverity(sev)} className={`py-3 rounded border-2 font-bold ${severity === sev ? sev === 'CRITICAL' ? 'border-red-500 bg-red-500/20 text-red-500' : sev === 'WARNING' ? 'border-yellow-500 bg-yellow-500/20 text-yellow-500' : 'border-blue-500 bg-blue-500/20 text-blue-500' : 'border-slate-600 text-slate-500'}`}>{sev}</button>
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
