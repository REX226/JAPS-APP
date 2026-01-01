
import { AlertMessage, AlertSeverity, RecurringAlert } from '../types';
import { getBackendUrl, isCloudEnabled } from './config';

const STORAGE_KEY = 'sentinel_alerts_v1';
const RECURRING_KEY = 'sentinel_recurring_v1';
const STATUS_KEY = 'sentinel_status/monitor';

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// --- API Helpers ---

const apiFetch = async (endpoint: string) => {
  if (!isCloudEnabled()) return null;
  const backendUrl = getBackendUrl();
  try {
    const res = await fetch(`${backendUrl}/${endpoint}.json?nocache=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const data = await res.json();
    if (endpoint !== STATUS_KEY) {
        localStorage.setItem(`cache_${endpoint}`, JSON.stringify(data));
    }
    return data;
  } catch (e) {
    if (endpoint !== STATUS_KEY) {
        const cached = localStorage.getItem(`cache_${endpoint}`);
        return cached ? JSON.parse(cached) : null;
    }
    return null;
  }
};

const apiWrite = async (endpoint: string, data: any) => {
  if (!isCloudEnabled()) return;
  const backendUrl = getBackendUrl();
  localStorage.setItem(`cache_${endpoint}`, JSON.stringify(data));
  try {
    await fetch(`${backendUrl}/${endpoint}.json`, {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    console.error("Cloud write error:", e);
  }
};

// --- Monitor Status ---
export interface MonitorStatus {
    online: boolean;
    last_seen: number;
}
export const getMonitorStatus = async (): Promise<MonitorStatus | null> => {
    return await apiFetch(STATUS_KEY);
};

// --- CRUD Operations ---
export const getAlerts = async (): Promise<AlertMessage[]> => {
  if (isCloudEnabled()) {
    const data = await apiFetch(STORAGE_KEY);
    return data ? (Array.isArray(data) ? data : Object.values(data)) : [];
  }
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) { return []; }
};

export const saveAlert = async (alert: AlertMessage): Promise<void> => {
  const current = await getAlerts();
  const updated = [...current, alert];
  if (isCloudEnabled()) await apiWrite(STORAGE_KEY, updated);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
};

export const deleteAlert = async (id: string): Promise<void> => {
  const current = await getAlerts();
  const updated = current.filter(a => a.id !== id);
  if (isCloudEnabled()) await apiWrite(STORAGE_KEY, updated);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
};

export const createAlert = (content: string, scheduledTime: number, severity: AlertSeverity): AlertMessage => {
  return { id: generateId(), content, scheduledTime, createdAt: Date.now(), severity, isSent: false };
};

// --- Recurring Alerts ---
export const getRecurringAlerts = async (): Promise<RecurringAlert[]> => {
  if (isCloudEnabled()) {
    const data = await apiFetch(RECURRING_KEY);
    return data ? (Array.isArray(data) ? data : Object.values(data)) : [];
  }
  try {
    const data = localStorage.getItem(RECURRING_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) { return []; }
};

export const saveRecurringAlert = async (alert: RecurringAlert): Promise<void> => {
  const current = await getRecurringAlerts();
  const updated = [...current, alert];
  if (isCloudEnabled()) await apiWrite(RECURRING_KEY, updated);
  else localStorage.setItem(RECURRING_KEY, JSON.stringify(updated));
};

export const createRecurringAlert = (content: string, timeString: string, severity: AlertSeverity): RecurringAlert => {
  return { id: generateId(), content, scheduledTime: timeString, severity, isActive: true, createdAt: Date.now() };
};

export const toggleRecurringAlert = async (id: string): Promise<void> => {
  const current = await getRecurringAlerts();
  const updated = current.map(alert => alert.id === id ? { ...alert, isActive: !alert.isActive } : alert);
  if (isCloudEnabled()) await apiWrite(RECURRING_KEY, updated);
  else localStorage.setItem(RECURRING_KEY, JSON.stringify(updated));
};

export const deleteRecurringAlert = async (id: string): Promise<void> => {
  const current = await getRecurringAlerts();
  const updated = current.filter(a => a.id !== id);
  if (isCloudEnabled()) await apiWrite(RECURRING_KEY, updated);
  else localStorage.setItem(RECURRING_KEY, JSON.stringify(updated));
};

// --- Logic ---
export const getScheduledAlerts = async (): Promise<AlertMessage[]> => {
  const now = Date.now();
  const alerts = await getAlerts();
  return alerts.filter(a => a.scheduledTime > now).sort((a, b) => a.scheduledTime - b.scheduledTime);
};

export const getNextEvent = async (): Promise<{ time: number, content: string, type: 'MANUAL' | 'RECURRING' } | null> => {
    const now = Date.now();
    
    // 1. Manual Alerts (Look back 60s to ensure we don't miss "just passed" events)
    const alerts = await getAlerts();
    const manual = alerts
      .filter(a => a.scheduledTime > (now - 60000)) 
      .sort((a, b) => a.scheduledTime - b.scheduledTime);
    const nextManual = manual.length > 0 ? manual[0] : null;

    // 2. Recurring Alerts
    const recurring = await getRecurringAlerts();
    let nextRecurring: { time: number, content: string } | null = null;
    const nowDate = new Date();
    
    recurring.filter(r => r.isActive).forEach(r => {
        const [h, m] = r.scheduledTime.split(':').map(Number);
        const rDate = new Date(nowDate);
        rDate.setHours(h, m, 0, 0);
        
        // If the recurring time was < 60 seconds ago, we count it as "Active Now"
        const diff = now - rDate.getTime();
        
        // If it's essentially "tomorrow" (more than 60s passed today)
        if (diff > 60000) {
            rDate.setDate(rDate.getDate() + 1);
        }
        
        // If it's a future event (or strictly "now"), prioritize it
        if (!nextRecurring || rDate.getTime() < nextRecurring.time) {
            nextRecurring = { time: rDate.getTime(), content: r.content };
        }
    });

    if (nextManual && nextRecurring) {
        return nextManual.scheduledTime < nextRecurring.time 
            ? { time: nextManual.scheduledTime, content: nextManual.content, type: 'MANUAL' }
            : { time: nextRecurring.time, content: nextRecurring.content, type: 'RECURRING' };
    } else if (nextManual) {
        return { time: nextManual.scheduledTime, content: nextManual.content, type: 'MANUAL' };
    } else if (nextRecurring) {
        return { time: nextRecurring.time, content: nextRecurring.content, type: 'RECURRING' };
    }
    return null;
}

export const getActiveAlerts = async (): Promise<AlertMessage[]> => {
  const now = Date.now();
  const ALERT_LIFESPAN_MS = 15 * 60 * 1000;

  const allAlerts = await getAlerts();
  const standardAlerts = allAlerts.filter(a => {
      const age = now - a.scheduledTime;
      return a.scheduledTime <= now && age < ALERT_LIFESPAN_MS;
  });

  const allRecurring = await getRecurringAlerts();
  const syntheticAlerts: AlertMessage[] = [];
  const nowDate = new Date();

  allRecurring.filter(r => r.isActive).forEach(r => {
      const [h, m] = r.scheduledTime.split(':').map(Number);
      const rDate = new Date(nowDate);
      rDate.setHours(h, m, 0, 0);
      const age = now - rDate.getTime();
      
      if (age >= 0 && age < ALERT_LIFESPAN_MS) {
        syntheticAlerts.push({
          id: `recurring-${r.id}-${nowDate.toDateString()}`, 
          content: `[DAILY REPEAT] ${r.content}`,
          scheduledTime: rDate.getTime(),
          createdAt: r.createdAt,
          severity: r.severity,
          isSent: true
        });
      }
  });

  return [...standardAlerts, ...syntheticAlerts].sort((a, b) => b.scheduledTime - a.scheduledTime); 
};
