import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { UserBroadcast } from './pages/UserBroadcast';
import { AdminLogin } from './pages/AdminLogin';
import { AdminDashboard } from './pages/AdminDashboard';
import { initializePushNotifications } from './services/firebase';
import { isCloudEnabled } from './services/config';

const App: React.FC = () => {
  // Simple session state to protect the dashboard
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Try to initialize push notifications if connected to cloud
    if (isCloudEnabled()) {
      initializePushNotifications();
    }
  }, []);

  return (
    <HashRouter>
      <div className="antialiased text-slate-200">
        <Routes>
          {/* Main User View - This is what users see when they open the app */}
          <Route path="/" element={<UserBroadcast />} />

          {/* Admin Login Page */}
          <Route 
            path="/admin" 
            element={<AdminLogin onLogin={() => setIsAuthenticated(true)} />} 
          />

          {/* Protected Dashboard Route */}
          <Route 
            path="/dashboard" 
            element={
              isAuthenticated ? (
                <AdminDashboard onLogout={() => setIsAuthenticated(false)} />
              ) : (
                <Navigate to="/admin" replace />
              )
            } 
          />
        </Routes>
      </div>
    </HashRouter>
  );
};

export default App;