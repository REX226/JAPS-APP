
import React from 'react';
import { AlertMessage, AlertSeverity } from '../types';

interface AlertCardProps {
  alert: AlertMessage;
  isAdmin?: boolean;
  onDelete?: (id: string) => void;
}

export const AlertCard: React.FC<AlertCardProps> = ({ alert, isAdmin, onDelete }) => {
  const severityColors = {
    [AlertSeverity.INFO]: 'border-l-blue-500 bg-blue-900/20 text-blue-100',
    [AlertSeverity.WARNING]: 'border-l-yellow-500 bg-yellow-900/20 text-yellow-100',
    [AlertSeverity.CRITICAL]: 'border-l-red-500 bg-red-900/20 text-red-100 animate-pulse-fast',
  };

  const severityIcons = {
    [AlertSeverity.INFO]: 'fa-info-circle',
    [AlertSeverity.WARNING]: 'fa-exclamation-triangle',
    [AlertSeverity.CRITICAL]: 'fa-radiation',
  };

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    const now = new Date();
    
    // Check if it's the same day
    const isToday = date.getDate() === now.getDate() && 
                    date.getMonth() === now.getMonth() && 
                    date.getFullYear() === now.getFullYear();

    // Format time in 12-hour format with AM/PM
    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

    // If today, return only time. If not, return Date + Time
    if (isToday) {
      return timeStr;
    } else {
      return `${date.toLocaleDateString()} ${timeStr}`;
    }
  };

  return (
    <div className={`p-3 md:p-4 rounded-r-lg border-l-4 mb-3 relative flex items-start gap-3 md:gap-4 shadow-lg backdrop-blur-sm ${severityColors[alert.severity]}`}>
      <div className="text-xl md:text-2xl pt-1">
        <i className={`fas ${severityIcons[alert.severity]}`}></i>
      </div>
      <div className="flex-1">
        <div className="flex justify-between items-start">
          <h3 className="font-bold text-base md:text-lg uppercase tracking-wider">{alert.severity} ALERT</h3>
          <span className="text-[10px] md:text-xs opacity-70 font-mono bg-black/30 px-2 py-1 rounded whitespace-nowrap ml-2">
            {formatTime(alert.scheduledTime)}
          </span>
        </div>
        <p className="mt-1 md:mt-2 text-base md:text-lg font-medium leading-relaxed">{alert.content}</p>
        
        {isAdmin && (
          <div className="mt-3 flex justify-end">
             <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete && onDelete(alert.id);
                }}
                className="text-xs text-red-400 hover:text-red-300 underline p-2"
             >
               Recall/Delete
             </button>
          </div>
        )}
      </div>
    </div>
  );
};
