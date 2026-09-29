import { useState, useEffect } from 'react';
import {
  fetchAdminUsers,
  fetchAdminStats,
  updateUserStatus,
  updateUserRole,
  sendCredentials,
  inviteUser,
  editUser,
  deleteUser,
} from '../lib/auth.js';
import { BANK_RATES } from '../lib/constants.js';

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

  // Invite modal
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', firstName: '', lastName: '', accountType: 'individual', companyName: '', role: 'user' });
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');

  // Edit modal
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deletingEmail, setDeletingEmail] = useState(null);
  const [deleting, setDeleting] = useState(false);

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
      setActionMsg(`${email} has been ${newStatus === 'active' ? 'activated' : 'suspended'}.`);
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

  async function handleInvite(e) {
    e.preventDefault();
    setError('');
    if (!inviteForm.email) { setError('Email is required.'); return; }
    setInviting(true);
    const result = await inviteUser(inviteForm);
    setInviting(false);
    if (result.success) {
      setActionMsg(result.message);
      if (result.inviteUrl) setInviteUrl(result.inviteUrl);
      setShowInvite(false);
      setInviteForm({ email: '', firstName: '', lastName: '', accountType: 'individual', companyName: '', role: 'user' });
      loadData();
    } else {
      setError(result.error);
    }
    setTimeout(() => setActionMsg(''), 5000);
  }

  async function handleEdit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const result = await editUser(editingUser, editForm);
    setSaving(false);
    if (result.success) {
      setActionMsg(`${editingUser} updated.`);
      setEditingUser(null);
      loadData();
    } else {
      setError(result.error);
    }
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleDelete() {
    setError('');
    setDeleting(true);
    const result = await deleteUser(deletingEmail);
    setDeleting(false);
    if (result.success) {
      setActionMsg(`${deletingEmail} has been deleted.`);
      setDeletingEmail(null);
      setUsers((prev) => prev.filter((u) => u.email !== deletingEmail));
    } else {
      setError(result.error);
    }
    setTimeout(() => setActionMsg(''), 3000);
  }

  function openEdit(u) {
    setEditingUser(u.email);
    setEditForm({
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      role: u.role || 'user',
      plan: u.plan || 'free',
      accountType: u.accountType || 'individual',
      companyName: u.companyName || '',
    });
    setError('');
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
              <option value="disabled">Suspended</option>
              <option value="invited">Invited</option>
            </select>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setShowInvite(true); setError(''); setInviteUrl(''); }}
              style={{ padding: '8px 16px', whiteSpace: 'nowrap' }}
            >
              + Invite User
            </button>
          </div>

          {/* Invite Modal */}
          {showInvite && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div className="glass-card" style={{ width: '100%', maxWidth: '480px', padding: '32px', margin: '16px' }}>
                <h2 style={{ margin: '0 0 16px' }}>Invite New User</h2>
                <form onSubmit={handleInvite}>
                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label className="form-label">Email *</label>
                    <input className="form-input" type="email" required value={inviteForm.email}
                      onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })} />
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">First Name</label>
                      <input className="form-input" value={inviteForm.firstName}
                        onChange={e => setInviteForm({ ...inviteForm, firstName: e.target.value })} />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Last Name</label>
                      <input className="form-input" value={inviteForm.lastName}
                        onChange={e => setInviteForm({ ...inviteForm, lastName: e.target.value })} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Account Type</label>
                      <select className="form-input" value={inviteForm.accountType}
                        onChange={e => setInviteForm({ ...inviteForm, accountType: e.target.value })}>
                        <option value="individual">Individual</option>
                        <option value="corporate">Corporate</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Role</label>
                      <select className="form-input" value={inviteForm.role}
                        onChange={e => setInviteForm({ ...inviteForm, role: e.target.value })}>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>
                  {inviteForm.accountType === 'corporate' && (
                    <div className="form-group" style={{ marginBottom: '12px' }}>
                      <label className="form-label">Company Name</label>
                      <input className="form-input" value={inviteForm.companyName}
                        onChange={e => setInviteForm({ ...inviteForm, companyName: e.target.value })} />
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                    <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={inviting}>
                      {inviting ? 'Sending...' : 'Send Invitation'}
                    </button>
                    <button type="button" className="btn btn-outline" style={{ flex: 1 }}
                      onClick={() => setShowInvite(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Invite URL fallback display */}
          {inviteUrl && (
            <div className="alert" style={{ background: 'rgba(132, 88, 163, 0.08)', border: '1px solid rgba(132, 88, 163, 0.2)', marginBottom: '16px' }}>
              <strong>Email may not have been delivered (SES sandbox).</strong> Share this invite link manually:
              <div style={{ marginTop: '8px', padding: '8px', background: 'var(--color-bg)', borderRadius: '4px', fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                {inviteUrl}
              </div>
              <button className="btn btn-sm btn-outline" style={{ marginTop: '8px' }}
                onClick={() => { navigator.clipboard.writeText(inviteUrl); setActionMsg('Link copied.'); setTimeout(() => setActionMsg(''), 2000); }}>
                Copy Link
              </button>
            </div>
          )}

          {/* Edit Modal */}
          {editingUser && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div className="glass-card" style={{ width: '100%', maxWidth: '480px', padding: '32px', margin: '16px' }}>
                <h2 style={{ margin: '0 0 4px' }}>Edit User</h2>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)', margin: '0 0 16px' }}>{editingUser}</p>
                <form onSubmit={handleEdit}>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">First Name</label>
                      <input className="form-input" value={editForm.firstName}
                        onChange={e => setEditForm({ ...editForm, firstName: e.target.value })} />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Last Name</label>
                      <input className="form-input" value={editForm.lastName}
                        onChange={e => setEditForm({ ...editForm, lastName: e.target.value })} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Account Type</label>
                      <select className="form-input" value={editForm.accountType}
                        onChange={e => setEditForm({ ...editForm, accountType: e.target.value })}>
                        <option value="individual">Individual</option>
                        <option value="corporate">Corporate</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                      <label className="form-label">Role</label>
                      <select className="form-input" value={editForm.role}
                        onChange={e => setEditForm({ ...editForm, role: e.target.value })}>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label className="form-label">Plan</label>
                    <select className="form-input" value={editForm.plan}
                      onChange={e => setEditForm({ ...editForm, plan: e.target.value })}>
                      <option value="free">Free</option>
                      <option value="basic">Basic</option>
                      <option value="pro">Pro</option>
                    </select>
                  </div>
                  {editForm.accountType === 'corporate' && (
                    <div className="form-group" style={{ marginBottom: '12px' }}>
                      <label className="form-label">Company Name</label>
                      <input className="form-input" value={editForm.companyName}
                        onChange={e => setEditForm({ ...editForm, companyName: e.target.value })} />
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                    <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button type="button" className="btn btn-outline" style={{ flex: 1 }}
                      onClick={() => setEditingUser(null)}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          {deletingEmail && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div className="glass-card" style={{ width: '100%', maxWidth: '400px', padding: '32px', margin: '16px', textAlign: 'center' }}>
                <h2 style={{ margin: '0 0 12px', color: 'var(--color-danger)' }}>Delete User</h2>
                <p>Are you sure you want to permanently delete <strong>{deletingEmail}</strong>?</p>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>This action cannot be undone.</p>
                <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                  <button className="btn" style={{ flex: 1, background: 'var(--color-danger)', color: '#fff' }} disabled={deleting}
                    onClick={handleDelete}>
                    {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                  <button className="btn btn-outline" style={{ flex: 1 }}
                    onClick={() => setDeletingEmail(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          <div className="glass-card" style={{ padding: '4px' }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Plan</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
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
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                            background: (u.role || 'user') === 'admin' ? 'rgba(132, 88, 163, 0.12)' : 'rgba(136, 136, 136, 0.12)',
                            color: (u.role || 'user') === 'admin' ? 'var(--color-primary)' : 'var(--color-text-muted)',
                          }}>
                            {u.role || 'user'}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              color: (u.status || 'active') === 'active' ? 'var(--color-success)'
                                : u.status === 'invited' ? 'var(--color-primary)'
                                : 'var(--color-danger)',
                              fontWeight: 700,
                              fontSize: '0.8rem',
                            }}
                          >
                            {u.status === 'invited' ? 'Invited' : u.status === 'disabled' ? 'Suspended' : u.status || 'active'}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem' }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => openEdit(u)}
                              style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => handleStatusToggle(u.email, u.status || 'active')}
                              style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                            >
                              {(u.status || 'active') === 'active' ? 'Suspend' : 'Activate'}
                            </button>
                            <button
                              className="btn btn-sm"
                              onClick={() => { setDeletingEmail(u.email); setError(''); }}
                              style={{ padding: '3px 8px', fontSize: '0.7rem', background: 'var(--color-danger)', color: '#fff' }}
                            >
                              Delete
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

          <h3 style={{ marginTop: '32px', marginBottom: '16px' }}>Bank Overdraft Rates</h3>
          <div className="glass-card" style={{ padding: '4px' }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Bank</th>
                    <th>Country</th>
                    <th>Currency</th>
                    <th>OD APR</th>
                  </tr>
                </thead>
                <tbody>
                  {BANK_RATES.map((bank) => (
                    <tr key={bank.id}>
                      <td>{bank.name}</td>
                      <td>{bank.country}</td>
                      <td>{bank.currency}</td>
                      <td style={{ fontWeight: 700 }}>{bank.odAPR}%</td>
                    </tr>
                  ))}
                  {BANK_RATES.length === 0 && (
                    <tr>
                      <td colSpan="4" style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
                        No bank rates configured.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p style={{ marginTop: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            These rates are used for auto-detection when a bank statement is uploaded.
          </p>
        </div>
      )}
    </div>
  );
}
