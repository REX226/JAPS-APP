import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { ADMIN_CREDENTIALS } from '../types';

interface AdminLoginProps {
  onLogin: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLogin }) => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
      onLogin(); // Update parent state
      navigate('/dashboard'); // Navigate to dashboard
    } else {
      setError('Invalid credentials');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-800 p-8 rounded-lg shadow-2xl border border-slate-700">
        <div className="text-center mb-8">
           <i className="fas fa-shield-alt text-4xl text-blue-500 mb-4"></i>
           <h2 className="text-2xl font-bold text-white font-oswald">Admin Access</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && <div className="bg-red-500/20 text-red-400 p-3 rounded text-sm text-center border border-red-500/50">{error}</div>}
          
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Password</label>
            <input 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <Button type="submit" fullWidth>Login</Button>
          
          <div className="text-center pt-2">
            <button type="button" onClick={() => navigate('/')} className="text-sm text-slate-500 hover:text-slate-300">
              &larr; Back to Public Broadcast
            </button>
          </div>
        </form>       