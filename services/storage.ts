
import { AlertMessage, AlertSeverity, RecurringAlert } from '../types';
import { getBackendUrl, isCloudEnabled } from './config';

const STORAGE_KEY = 'sentinel_alerts_v1';
const RECURRING_KEY = 'sentinel_recurring_v1';
const STATUS_KEY = 'sentinel_status/monitor';

// Helper for robust ID generation
const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
};

// --- API Helpers with Offline Caching ---

const apiFetch = async (endpoint: string) => {
  if (!isCloudEnabled()) return null;
  const backendUrl = getBackendUrl();
  try {
    // UPDATED: Added ?nocache=${Date.now()} to prevent browser caching
    const res = await fetch(`${backendUrl}/${endpoint}.json?nocache=${Date.now()}`);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    if (endpoint !== STATUS_KEY) {
        // Cache data, but not status (status should always be fresh)
        localStorage.setItem(`cache_${endpoint}`, JSON.stringify(data));
    }
    return data;
  } catch (e) {
    // Only warn if it's not the status check (status checks fail often if offline)
    if (endpoint !== STATUS_KEY) {
        console.warn(`Cloud fetch error for ${endpoint}, falling back to cache:`, e);
        const cached = localStorage.getItem(`cache_${endpoint}`);
        return cached ? JSON.parse(cached) : null;
    }
    return null;
  }
};

const apiWrite = async (endpoint: string, data: any) => {
  if (!isCloudEnabled()) return;
  const backendUrl = getBackendUrl();
  
  // Optimistically update cache so UI updates immediately even if write is pending
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

// --- Monitor Status Check ---

export interface MonitorStatus {
    online: boolean;
    last_seen: number;
}

export const getMonitorStatus = async (): Promise<MonitorStatus | null> => {
    return await apiFetch(STATUS_KEY);
};

// --- Standard Alerts ---

export const getAlerts = async (): Promise<AlertMessage[]> => {
  if (isCloudEnabled()) {
    const data = await apiFetch(STORAGE_KEY);
    return data ? (Array.isArray(data) ? data : Object.values(data)) : [];
  }
  // Local Fallback (Development Mode)
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("Failed to load alerts", e);
    return [];
  }
};

export const saveAlert = async (alert: AlertMessage): Promise<void> => {
  const current = await getAlerts();
  const updated = [...current, alert];
  
  if (isCloudEnabled()) {
    await apiWrite(STORAGE_KEY, updated);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }
};

export const clearAlerts = async (): Promise<void> => {
  if (isCloudEnabled()) {
    await apiWrite(STORAGE_KEY, []);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
};

export const createAlert = (content: string, scheduledTime: number, severity: AlertSeverity): AlertMessage => {
  return {
    id: generateId(),
    content,
    scheduledTime,
    createdAt: Date.now(),
    severity,
    isSent: false
  };
};

export const deleteAlert = async (id: string): Promise<void> => {
  const current = await getAlerts();
  const updated = current.filter(a => a.id !== id);
  
  if (isCloudEnabled()) {
    await apiWrite(STORAGE_KEY, updated);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }
};

// --- Recurring Alerts ---

export const getRecurringAlerts = async (): Promise<RecurringAlert[]> => {
  if (isCloudEnabled()) {
    const data = await apiFetch(RECURRING_KEY);
    return data ? (Array.isArray(data) ? data : Object.values(data)) : [];
  }
  // Local Fallback (Development Mode)
  try {
    const data = localStorage.getItem(RECURRING_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("Failed to load recurring alerts", e);
    return [];
  }
};

export const saveRecurringAlert = async (alert: RecurringAlert): Promise<void> => {
  const current = await getRecurringAlerts();
  const updated = [...current, alert];
  
  if (isCloudEnabled()) {
    await apiWrite(RECURRING_KEY, updated);
  } else {
    localStorage.setItem(RECURRING_KEY, JSON.stringify(updated));
  }
};

export const createRecurringAlert = (content: string, timeString: string, severity: AlertSeverity): RecurringAlert => {
  return {
    id: generateId(),
    content,
    scheduledTime: timeString,
    severity,
    isActive: true, // Default to active on create
    createdAt: Date.now()
  };
};

export const toggleRecurringAlert = async (id: string): Promise<void> => {
  const current = await getRecurringAlerts();
  const updated = current.map(alert => 
    alert.id === id ? { ...alert, isActive: !alert.isActive } : alert
  );
  
  if (isCloudEnabled()) {
    await apiWrite(RECURRING_KEY, updated);
  } else {
    localStorage.setItem(RECURRING_KEY, JSON.stringify(updated));
  }
};

export const deleteRecurringAlert = async (id: string): Promise<void> => {
  const current = await getRecurringAlerts();
  const updated = current.filter(a => a.id !== id);
  
  if (isCloudEnabled()) {
    await apiWrite(RECURRING_KEY, updated);
  } else {
    localStorage.setItem(RECURRING_KEY, JSON.stringify(updated));
  }
};

// --- Combined Logic ---

export const getScheduledAlerts = async (): Promise<AlertMessage[]> => {
  const now = Date.now();
  const alerts = await getAlerts();
  return alerts
    .filter(a => a.scheduledTime > now)
    .sort((a, b) => a.scheduledTime - b.scheduledTime);
};

export const getNextEvent = async (): Promise<{ time: number, content: string, type: 'MANUAL' | 'RECURRING' } | null> => {
    // 1. Manual
    const manual = await getScheduledAlerts();
    const nextManual = manual.length > 0 ? manual[0] : null;

    // 2. Recurring (Next occurrence)
    const recurring = await getRecurringAlerts();
    let nextRecurring: { time: number, content: string } | null = null;
    
    const now = new Date();
    
    recurring.filter(r => r.isActive).forEach(r => {
        const [h, m] = r.scheduledTime.split(':').map(Number);
        const rDate = new Date(now);
        rDate.setHours(h, m, 0, 0);
        
        // If passed today, add 1 day
        if (rDate.getTime() <= now.getTime()) {
            rDate.setDate(rDate.getDate() + 1);
        }
        
        if (!nextRecurring || rDate.getTime() < nextRecurring.time) {
            nextRecurring = { time: rDate.getTime(), content: r.content };
        }
    });

    // Compare Manual vs Recurring to find the absolute next event
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
  const now = new Date();
  const currentTimestamp = now.getTime();
  const todayDateString = now.toDateString(); 
  
  // LIFESPAN: 15 Minutes (in milliseconds)
  // Alerts older than this will be filtered out from the view
  const ALERT_LIFESPAN_MS = 15 * 60 * 1000;

  // 1. Standard Alerts
  const allAlerts = await getAlerts();
  const standardAlerts = allAlerts.filter(a => {
      const age = currentTimestamp - a.scheduledTime;
      // Must be in the past (scheduledTime <= now) AND not older than 15 mins
      return a.scheduledTime <= currentTimestamp && age < ALERT_LIFESPAN_MS;
  });

  // 2. Recurring Alerts
  const allRecurring = await getRecurringAlerts();
  const recurring = allRecurring.filter(r => r.isActive);
  const syntheticAlerts: AlertMessage[] = [];

  recurring.forEach(r => {
    try {
      const [hours, minutes] = r.scheduledTime.split(':').map(Number);
      const alertTime = new Date(now);
      alertTime.setHours(hours, minutes, 0, 0);
      
      const age = currentTimestamp - alertTime.getTime();
      
      // If the time has passed today AND it is within the 15 minute window
      if (age >= 0 && age < ALERT_LIFESPAN_MS) {
        syntheticAlerts.push({
          id: `recurring-${r.id}-${todayDateString}`, 
          content: `[DAILY REPEAT] ${r.content}`,
          scheduledTime: alertTime.getTime(),
          createdAt: r.createdAt,
          severity: r.severity,
          isSent: true
        });
      }
    } catch (e) {
      console.error("Error parsing recurring time", e);
    }
  });

  return [...standardAlerts, ...syntheticAlerts]
    .sort((a, b) => b.scheduledTime - a.scheduledTime); 
};
