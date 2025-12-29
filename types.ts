export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL'
}

export interface AlertMessage {
  id: string;
  content: string;
  scheduledTime: number; // Unix timestamp
  createdAt: number;
  severity: AlertSeverity;
  isSent: boolean; // Derived logic will often use scheduledTime <= Date.now()
}

export interface RecurringAlert {
  id: string;
  content: string;
  scheduledTime: string; // HH:MM (24h format)
  severity: AlertSeverity;
  isActive: boolean;
  createdAt: number;
}

export interface User {
  username: string;
  role: 'ADMIN' | 'USER';
}

export const ADMIN_CREDENTIALS = {
  username: 'admin',
  password: 'yogiji'
};