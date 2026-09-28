import { useState, useEffect } from 'react';
import {
  fetchAdminUsers,
  fetchAdminStats,
  updateUserStatus,
  updateUserRole,
  sendCredentials,
} from '../lib/auth.js';

const TABS = ['Overview', 'Users', 'System'];

export default function AdminPage() {
  const [tab, setTab] = useState('Overview');
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  async function loadData() {
    setLoading(true);
    setError('');
    const [usersRes, statsRes] = await Promise.all([
      fetchAdminUsers(),
      fetchAdminStats(),
    ]);
    if (usersRes.success) setUsers(usersRes.users);
    else setError(usersRes.error);
    if (statsRes.success) setStats(statsRes.stats);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleStatusToggle(email, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    const result = await updateUserStatus(email, newStatus);
    if (result.success) {
      setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, status: newStatus } : u)));
      setActionMsg(`${email} has been ${newStatus === 'active' ? 'activated' : 'deactivated'}.`);
    } else {
      setError(result.error);
    }
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleRoleChange(email, newRole) {
    const result = await updateUserRole(email, newRole);
    if (result.success) {
      setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, role: newRole } : u)));
      setActionMsg(`${email} role changed to ${newRole}.`);
    } else {
      setError(result.error);
    }
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleSendCredentials(email) {
    const result = await sendCredentials(email);
    if (result.success) {
      setActionMsg(`Credentials sent to ${email}.`);
    } else {
      setError(result.error);
    }
    setTimeout(() => setActionMsg(''), 3000);
  }

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      !search ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.firstName || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.lastName || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.companyName || '').toLowerCase().includes(search.toLowerCase());
    const matchesRole = filterRole === 'all' || u.role === filterRole;
    const matchesStatus = filterStatus === 'all' || u.status === filterStatus;
    return matchesSearch && matchesRole && matchesStatus;
  });

  if (loading) {
    return (
      <div className="page-container">
        <h1 className="page-title">Admin Dashboard</h1>
        <div className="spinner-overlay">
          <div className="spinner"></div>
          <div className="spinner-text">Loading admin data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container" style={{ maxWidth: '1100px' }}>
      <h1 className="page-title">Admin Dashboard</h1>
      <p className="page-subtitle">Manage users, view statistics, and monitor the system.</p>

      {error && <div className="alert alert-error">{error}</div>}
      {actionMsg && <div className="alert alert-success">{actionMsg}</div>}

      {/* Tab navigation */}
      <div className="admin-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`admin-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Overview tab */}
      {tab === 'Overview' && stats && (
        <div>
          <div className="admin-stats-grid">
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{stats.totalUsers}</div>
              <div className="admin-stat-label">Total Users</div>
            </div>
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{stats.verifiedUsers}</div>
              <div className="admin-stat-label">Verified</div>
            </div>
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{stats.unverifiedUsers}</div>
              <div className="admin-stat-label">Unverified</div>
            </div>
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{stats.adminUsers}</div>
              <div className="admin-stat-label">Admins</div>
            </div>
          </div>

          <h3 style={{ marginTop: '32px', marginBottom: '16px' }}>Plan Breakdown</h3>
          <div className="admin-stats-grid">
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{stats.planBreakdown?.free || 0}</div>
              <div className="admin-stat-label">Free</div>
            </div>
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{stats.planBreakdown?.basic || 0}</div>
              <div className="admin-stat-label">Basic</div>
            </div>
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{stats.planBreakdown?.pro || 0}</div>
              <div className="admin-stat-label">Pro</div>
            </div>
          </div>

          {stats.recentRegistrations && stats.recentRegistrations.length > 0 && (
            <>
              <h3 style={{ marginTop: '32px', marginBottom: '16px' }}>Recent Registrations</h3>
              <div className="glass-card" style={{ padding: '4px' }}>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Name</th>
                        <th>Joined</th>
                        <th>Verified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.recentRegistrations.map((u) => (
                        <tr key={u.email}>
                          <td>{u.email}</td>
                          <td>{u.firstName || u.companyName || '-'}</td>
                          <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                          <td>{u.verified ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Users tab */}
      {tab === 'Users' && (
        <div>
          <div className="admin-filters">
            <input
              className="form-input"
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: '300px' }}
            />
            <select
              className="form-input"
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              style={{ maxWidth: '150px' }}
            >
              <option value="all">All Roles</option>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <select
              className="form-input"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ maxWidth: '150px' }}
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>

          <div className="glass-card" style={{ padding: '4px' }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Plan</th>
                    <th>Verified</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan="9" style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
                        No users found.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => (
                      <tr key={u.email}>
                        <td>{u.email}</td>
                        <td>
                          {u.accountType === 'corporate'
                            ? u.companyName || '-'
                            : `${u.firstName || ''} ${u.lastName || ''}`.trim() || '-'}
                        </td>
                        <td>
                          <span className={`badge badge-${u.accountType || 'individual'}`}>
                            {u.accountType || 'individual'}
                          </span>
                        </td>
                        <td>{u.plan || 'free'}</td>
                        <td>{u.verified ? 'Yes' : 'No'}</td>
                        <td>
                          <select
                            className="form-input"
                            value={u.role || 'user'}
                            onChange={(e) => handleRoleChange(u.email, e.target.value)}
                            style={{ padding: '4px 8px', fontSize: '0.8rem', minWidth: '80px' }}
                          >
                            <option value="user">user</option>
                            <option value="admin">admin</option>
                          </select>
                        </td>
                        <td>
                          <span
                            style={{
                              color: (u.status || 'active') === 'active' ? 'var(--color-success)' : 'var(--color-danger)',
                              fontWeight: 700,
                            }}
                          >
                            {u.status || 'active'}
                          </span>
                        </td>
                        <td>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => handleStatusToggle(u.email, u.status || 'active')}
                              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                            >
                              {(u.status || 'active') === 'active' ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => handleSendCredentials(u.email)}
                              style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                            >
                              Send Creds
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ marginTop: '12px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            Showing {filteredUsers.length} of {users.length} users
          </div>
        </div>
      )}

      {/* System tab */}
      {tab === 'System' && stats && (
        <div>
          <div className="admin-stats-grid">
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{stats.totalAnalyses || 0}</div>
              <div className="admin-stat-label">Total Analyses Run</div>
            </div>
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{stats.sesStatus || 'Sandbox'}</div>
              <div className="admin-stat-label">SES Status</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
