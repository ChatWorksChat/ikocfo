import { Navigate } from 'react-router-dom';
import { getCurrentUser, isAuthenticated } from '../lib/auth.js';

export default function AdminRoute({ children }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  const user = getCurrentUser();
  if (user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}
