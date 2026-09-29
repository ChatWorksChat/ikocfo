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
  fetchBankRates,
  addBankRate,
  updateBankRate,
  deleteBankRate,
} from '../lib/auth.js';
import { PLANS, STRIPE, KENYA_BANKS } from '../lib/constants.js';
import { isStripeConfigured } from '../lib/stripe.js';

const TABS = ['Overview', 'Users', 'Payments', 'Integrations', 'System'];

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

  // Bank rates state
  const [bankRates, setBankRates] = useState([]);
  const [showBankForm, setShowBankForm] = useState(false);
  const [bankForm, setBankForm] = useState({ name: '', odAPR: '', currency: 'KES', country: 'Kenya', aliases: '', type: 'commercial' });
  const [editingRate, setEditingRate] = useState(null);
  const [savingRate, setSavingRate] = useState(false);
  const [deletingRateId, setDeletingRateId] = useState(null);

  async function loadData() {
    setLoading(true);
    setError('');
    const [usersRes, statsRes, ratesRes] = await Promise.all([
      fetchAdminUsers(),
      fetchAdminStats(),
      fetchBankRates(),
    ]);
    if (usersRes.success) setUsers(usersRes.users);
    else setError(usersRes.error);
    if (statsRes.success) setStats(statsRes.stats);
    if (ratesRes.success) setBankRates(ratesRes.rates);
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

      {/* Payments tab */}
      {tab === 'Payments' && (
        <div>
          {/* Subscription stats */}
          <h3 style={{ marginBottom: '16px' }}>Subscription Overview</h3>
          <div className="admin-stats-grid">
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{stats?.planBreakdown?.free || 0}</div>
              <div className="admin-stat-label">Free Users</div>
            </div>
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value" style={{ color: 'var(--color-primary)' }}>{stats?.planBreakdown?.basic || 0}</div>
              <div className="admin-stat-label">Basic ($9/mo)</div>
            </div>
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value" style={{ color: 'var(--color-success)' }}>{stats?.planBreakdown?.pro || 0}</div>
              <div className="admin-stat-label">Pro ($29/mo)</div>
            </div>
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value" style={{ color: 'var(--color-primary)' }}>
                ${((stats?.planBreakdown?.basic || 0) * 9) + ((stats?.planBreakdown?.pro || 0) * 29)}
              </div>
              <div className="admin-stat-label">Est. MRR</div>
            </div>
          </div>

          {/* Payment provider status */}
          <h3 style={{ marginTop: '32px', marginBottom: '16px' }}>Payment Providers</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Stripe Card Payments */}
            <div className="glass-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <strong style={{ fontSize: '1rem' }}>Stripe — Card Payments</strong>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                    Visa, Mastercard, Amex, international cards
                  </div>
                </div>
                <span style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: 'var(--font-size-xs)', fontWeight: 700,
                  background: isStripeConfigured() ? 'rgba(46, 204, 113, 0.12)' : 'rgba(243, 156, 18, 0.12)',
                  color: isStripeConfigured() ? 'var(--color-success)' : '#b7791f',
                }}>
                  {isStripeConfigured() ? 'Active' : 'Not Configured'}
                </span>
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span>Publishable Key</span>
                  <span style={{ fontFamily: 'monospace', color: STRIPE.publishableKey ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {STRIPE.publishableKey ? `${STRIPE.publishableKey.slice(0, 12)}...` : 'Not set'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span>Basic Price ID</span>
                  <span style={{ fontFamily: 'monospace', color: STRIPE.prices.basic ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {STRIPE.prices.basic ? `${STRIPE.prices.basic.slice(0, 16)}...` : 'Not set'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span>Pro Price ID</span>
                  <span style={{ fontFamily: 'monospace', color: STRIPE.prices.pro ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {STRIPE.prices.pro ? `${STRIPE.prices.pro.slice(0, 16)}...` : 'Not set'}
                  </span>
                </div>
              </div>
              {!isStripeConfigured() && (
                <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(243, 156, 18, 0.06)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-xs)', color: '#b7791f' }}>
                  Set VITE_STRIPE_PK, VITE_STRIPE_PRICE_BASIC, and VITE_STRIPE_PRICE_PRO in Amplify environment variables to enable card payments.
                </div>
              )}
            </div>

            {/* M-Pesa Mobile Payments */}
            <div className="glass-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <strong style={{ fontSize: '1rem' }}>M-Pesa — Mobile Payments</strong>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                    Safaricom M-Pesa STK Push (Kenya)
                  </div>
                </div>
                <span style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: 'var(--font-size-xs)', fontWeight: 700,
                  background: 'rgba(136, 136, 136, 0.12)',
                  color: 'var(--color-text-muted)',
                }}>
                  Coming Soon
                </span>
              </div>
              <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span>Consumer Key</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--color-danger)' }}>Not set</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                  <span>Consumer Secret</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--color-danger)' }}>Not set</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span>Shortcode</span>
                  <span style={{ fontFamily: 'monospace', color: 'var(--color-danger)' }}>Not set</span>
                </div>
              </div>
              <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(136, 136, 136, 0.06)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                M-Pesa integration requires a Safaricom Daraja API account. Configure MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, and MPESA_SHORTCODE.
              </div>
            </div>
          </div>

          {/* Subscriber table */}
          <h3 style={{ marginTop: '32px', marginBottom: '16px' }}>Paid Subscribers</h3>
          <div className="glass-card" style={{ padding: '4px' }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Plan</th>
                    <th>Status</th>
                    <th>Payment Method</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {users.filter(u => u.plan && u.plan !== 'free').length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
                        No paid subscribers yet.
                      </td>
                    </tr>
                  ) : (
                    users.filter(u => u.plan && u.plan !== 'free').map(u => (
                      <tr key={u.email}>
                        <td>{u.email}</td>
                        <td>{`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.companyName || '-'}</td>
                        <td>
                          <span style={{
                            padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                            background: u.plan === 'pro' ? 'rgba(46, 204, 113, 0.12)' : 'rgba(132, 88, 163, 0.12)',
                            color: u.plan === 'pro' ? 'var(--color-success)' : 'var(--color-primary)',
                          }}>
                            {PLANS[u.plan]?.name || u.plan}
                          </span>
                        </td>
                        <td>
                          <span style={{ color: u.status === 'active' ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700, fontSize: '0.8rem' }}>
                            {u.status || 'active'}
                          </span>
                        </td>
                        <td style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                          {isStripeConfigured() ? 'Stripe' : 'Manual'}
                        </td>
                        <td style={{ fontSize: '0.8rem' }}>{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Integrations tab */}
      {tab === 'Integrations' && (
        <div>
          <h3 style={{ marginBottom: '16px' }}>Service Integrations</h3>
          <div style={{ display: 'grid', gap: '16px' }}>

            {/* Stripe */}
            <div className="glass-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '8px',
                    background: 'linear-gradient(135deg, #635BFF, #7C3AED)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: '0.9rem',
                  }}>S</div>
                  <div>
                    <strong>Stripe</strong>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Card payments, subscriptions, billing</div>
                  </div>
                </div>
                <span style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: 'var(--font-size-xs)', fontWeight: 700,
                  background: isStripeConfigured() ? 'rgba(46, 204, 113, 0.12)' : 'rgba(243, 156, 18, 0.12)',
                  color: isStripeConfigured() ? 'var(--color-success)' : '#b7791f',
                }}>
                  {isStripeConfigured() ? 'Connected' : 'Not Configured'}
                </span>
              </div>
              <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: 'var(--font-size-sm)' }}>
                <div style={{ padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginBottom: '4px' }}>Webhook URL</div>
                  <code style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>
                    {window.location.origin.replace('main.', '').replace('.amplifyapp.com', '')}/api/stripe/webhook
                  </code>
                </div>
                <div style={{ padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginBottom: '4px' }}>Success Redirect</div>
                  <code style={{ fontSize: '0.7rem' }}>/dashboard?session_id=...</code>
                </div>
              </div>
              {!isStripeConfigured() && (
                <div style={{ marginTop: '12px', padding: '14px', background: 'rgba(243, 156, 18, 0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(243, 156, 18, 0.15)' }}>
                  <strong style={{ fontSize: 'var(--font-size-sm)' }}>Setup Instructions:</strong>
                  <ol style={{ margin: '8px 0 0', paddingLeft: '20px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                    <li>Create a Stripe account at <strong>stripe.com</strong></li>
                    <li>Create products for Basic ($9/mo) and Pro ($29/mo) plans</li>
                    <li>Copy the publishable key and price IDs</li>
                    <li>Add to Amplify environment variables: VITE_STRIPE_PK, VITE_STRIPE_PRICE_BASIC, VITE_STRIPE_PRICE_PRO</li>
                    <li>Redeploy the application</li>
                  </ol>
                </div>
              )}
            </div>

            {/* M-Pesa */}
            <div className="glass-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '8px',
                    background: 'linear-gradient(135deg, #4CAF50, #2E7D32)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: '0.9rem',
                  }}>M</div>
                  <div>
                    <strong>M-Pesa (Safaricom Daraja)</strong>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Mobile money payments via STK Push (Kenya)</div>
                  </div>
                </div>
                <span style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: 'var(--font-size-xs)', fontWeight: 700,
                  background: 'rgba(136, 136, 136, 0.12)',
                  color: 'var(--color-text-muted)',
                }}>
                  Coming Soon
                </span>
              </div>
              <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: 'var(--font-size-sm)' }}>
                <div style={{ padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginBottom: '4px' }}>API Environment</div>
                  <span style={{ fontSize: '0.8rem' }}>Sandbox (not configured)</span>
                </div>
                <div style={{ padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginBottom: '4px' }}>Callback URL</div>
                  <code style={{ fontSize: '0.7rem' }}>/api/mpesa/callback</code>
                </div>
              </div>
              <div style={{ marginTop: '12px', padding: '14px', background: 'rgba(136, 136, 136, 0.04)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                <strong style={{ fontSize: 'var(--font-size-sm)' }}>Setup Instructions:</strong>
                <ol style={{ margin: '8px 0 0', paddingLeft: '20px', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                  <li>Register on the Safaricom Daraja portal at <strong>developer.safaricom.co.ke</strong></li>
                  <li>Create an app and get Consumer Key and Consumer Secret</li>
                  <li>Apply for an M-Pesa Shortcode (Paybill or Till)</li>
                  <li>Add to Lambda environment: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY</li>
                  <li>Deploy the M-Pesa Lambda handler and API Gateway route</li>
                </ol>
              </div>
            </div>

            {/* AWS SES */}
            <div className="glass-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '8px',
                    background: 'linear-gradient(135deg, #FF9900, #E8850C)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: '0.8rem',
                  }}>SES</div>
                  <div>
                    <strong>AWS SES — Email Service</strong>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Transactional emails (verification, invites, credentials)</div>
                  </div>
                </div>
                <span style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: 'var(--font-size-xs)', fontWeight: 700,
                  background: 'rgba(243, 156, 18, 0.12)',
                  color: '#b7791f',
                }}>
                  {stats?.sesStatus || 'Sandbox'}
                </span>
              </div>
              <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: 'var(--font-size-sm)' }}>
                <div style={{ padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginBottom: '4px' }}>Sender Address</div>
                  <span style={{ fontSize: '0.8rem' }}>administrator@forwardsflow.com</span>
                </div>
                <div style={{ padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginBottom: '4px' }}>Region</div>
                  <span style={{ fontSize: '0.8rem' }}>eu-west-1</span>
                </div>
              </div>
            </div>

            {/* WebAuthn / FIDO2 */}
            <div className="glass-card" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '8px',
                    background: 'linear-gradient(135deg, #8458a3, #6A3D8F)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: '0.7rem',
                  }}>2FA</div>
                  <div>
                    <strong>WebAuthn / FIDO2 — Biometric Auth</strong>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Fingerprint, Windows Hello, Touch ID, TOTP</div>
                  </div>
                </div>
                <span style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: 'var(--font-size-xs)', fontWeight: 700,
                  background: 'rgba(46, 204, 113, 0.12)',
                  color: 'var(--color-success)',
                }}>
                  Active
                </span>
              </div>
              <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: 'var(--font-size-sm)' }}>
                <div style={{ padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginBottom: '4px' }}>MFA-Enabled Users</div>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>
                    {users.filter(u => u.mfaEnabled).length} of {users.length}
                  </span>
                </div>
                <div style={{ padding: '10px 14px', background: 'var(--color-bg)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-xs)', marginBottom: '4px' }}>RP ID</div>
                  <code style={{ fontSize: '0.7rem' }}>d3e8omyd97oi7s.amplifyapp.com</code>
                </div>
              </div>
            </div>
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
            <div className="glass-card admin-stat-card">
              <div className="admin-stat-value">{bankRates.length}</div>
              <div className="admin-stat-label">Banks Configured</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '32px', marginBottom: '16px' }}>
            <h3 style={{ margin: 0 }}>Bank Overdraft Rates</h3>
            <button
              className="btn btn-primary"
              onClick={() => {
                setEditingRate(null);
                setBankForm({ name: '', odAPR: '', currency: 'KES', country: 'Kenya', aliases: '', type: 'commercial' });
                setShowBankForm(true);
              }}
              style={{ padding: '6px 16px', fontSize: '0.85rem' }}
            >
              + Add Bank
            </button>
          </div>

          {/* Add/Edit bank form */}
          {showBankForm && (
            <div className="glass-card" style={{ padding: '24px', marginBottom: '16px', border: '1px solid var(--color-primary)' }}>
              <h4 style={{ marginBottom: '16px' }}>{editingRate ? 'Edit Bank Rate' : 'Add Bank Rate'}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Bank Name</label>
                  {editingRate ? (
                    <input
                      className="form-input"
                      value={bankForm.name}
                      onChange={e => setBankForm(f => ({ ...f, name: e.target.value }))}
                    />
                  ) : (
                    <>
                      <select
                        className="form-input"
                        value={bankForm.name}
                        onChange={e => {
                          const bank = KENYA_BANKS.find(b => b.name === e.target.value);
                          setBankForm(f => ({
                            ...f,
                            name: e.target.value,
                            type: bank ? bank.type : f.type,
                          }));
                        }}
                      >
                        <option value="">— Select a bank —</option>
                        <optgroup label="Commercial Banks">
                          {KENYA_BANKS.filter(b => b.type === 'commercial').map(b => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Microfinance Banks">
                          {KENYA_BANKS.filter(b => b.type === 'microfinance').map(b => (
                            <option key={b.name} value={b.name}>{b.name}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Other">
                          <option value="__custom">Enter custom name...</option>
                        </optgroup>
                      </select>
                      {bankForm.name === '__custom' && (
                        <input
                          className="form-input"
                          style={{ marginTop: '8px' }}
                          placeholder="Enter bank name"
                          value=""
                          onChange={e => setBankForm(f => ({ ...f, name: e.target.value }))}
                        />
                      )}
                    </>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">OD Interest Rate (% p.a.)</label>
                  <input
                    className="form-input"
                    type="number"
                    step="0.01"
                    placeholder="e.g. 14.5"
                    value={bankForm.odAPR}
                    onChange={e => setBankForm(f => ({ ...f, odAPR: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select
                    className="form-input"
                    value={bankForm.currency}
                    onChange={e => setBankForm(f => ({ ...f, currency: e.target.value }))}
                  >
                    <option value="KES">KES — Kenyan Shilling</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="EUR">EUR — Euro</option>
                    <option value="GBP">GBP — British Pound</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Country</label>
                  <input
                    className="form-input"
                    value={bankForm.country}
                    onChange={e => setBankForm(f => ({ ...f, country: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Aliases (comma-separated, used for auto-detection)</label>
                  <input
                    className="form-input"
                    placeholder="e.g. VCB, Victoria Commercial"
                    value={bankForm.aliases}
                    onChange={e => setBankForm(f => ({ ...f, aliases: e.target.value }))}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button
                  className="btn btn-primary"
                  disabled={savingRate || !bankForm.name || bankForm.name === '__custom' || !bankForm.odAPR}
                  onClick={async () => {
                    setSavingRate(true);
                    setError('');
                    const aliasArr = bankForm.aliases
                      ? bankForm.aliases.split(',').map(a => a.trim()).filter(Boolean)
                      : [];
                    if (editingRate) {
                      const res = await updateBankRate(editingRate.id, {
                        name: bankForm.name,
                        odAPR: parseFloat(bankForm.odAPR),
                        currency: bankForm.currency,
                        country: bankForm.country,
                        aliases: aliasArr.length > 0 ? aliasArr : [bankForm.name],
                        type: bankForm.type,
                      });
                      if (res.success) {
                        setActionMsg(`${bankForm.name} rate updated.`);
                        setShowBankForm(false);
                        const ratesRes = await fetchBankRates();
                        if (ratesRes.success) setBankRates(ratesRes.rates);
                      } else setError(res.error);
                    } else {
                      const res = await addBankRate({
                        name: bankForm.name,
                        odAPR: parseFloat(bankForm.odAPR),
                        currency: bankForm.currency,
                        country: bankForm.country,
                        aliases: aliasArr.length > 0 ? aliasArr : [bankForm.name],
                        type: bankForm.type,
                      });
                      if (res.success) {
                        setActionMsg(`${bankForm.name} added.`);
                        setShowBankForm(false);
                        const ratesRes = await fetchBankRates();
                        if (ratesRes.success) setBankRates(ratesRes.rates);
                      } else setError(res.error);
                    }
                    setSavingRate(false);
                  }}
                >
                  {savingRate ? 'Saving...' : editingRate ? 'Update' : 'Add Bank'}
                </button>
                <button
                  className="btn btn-outline"
                  onClick={() => setShowBankForm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="glass-card" style={{ padding: '4px' }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Bank</th>
                    <th>Type</th>
                    <th>Country</th>
                    <th>Currency</th>
                    <th>OD APR</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bankRates.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
                        No bank rates configured. Click "+ Add Bank" to add one.
                      </td>
                    </tr>
                  ) : (
                    bankRates.map((bank) => (
                      <tr key={bank.id}>
                        <td style={{ fontWeight: 600 }}>{bank.name}</td>
                        <td>
                          <span style={{
                            padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 700,
                            background: bank.type === 'commercial' ? 'rgba(132, 88, 163, 0.12)' : 'rgba(46, 204, 113, 0.12)',
                            color: bank.type === 'commercial' ? 'var(--color-primary)' : 'var(--color-success)',
                          }}>
                            {bank.type || 'commercial'}
                          </span>
                        </td>
                        <td>{bank.country}</td>
                        <td>{bank.currency}</td>
                        <td style={{ fontWeight: 700 }}>{bank.odAPR}%</td>
                        <td>
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => {
                                setEditingRate(bank);
                                setBankForm({
                                  name: bank.name,
                                  odAPR: String(bank.odAPR),
                                  currency: bank.currency,
                                  country: bank.country,
                                  aliases: (bank.aliases || []).join(', '),
                                  type: bank.type || 'commercial',
                                });
                                setShowBankForm(true);
                              }}
                              style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                            >
                              Edit
                            </button>
                            {deletingRateId === bank.id ? (
                              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <button
                                  className="btn btn-sm"
                                  style={{ padding: '3px 8px', fontSize: '0.7rem', background: 'var(--color-danger)', color: '#fff' }}
                                  onClick={async () => {
                                    const res = await deleteBankRate(bank.id);
                                    if (res.success) {
                                      setBankRates(prev => prev.filter(r => r.id !== bank.id));
                                      setActionMsg(`${bank.name} deleted.`);
                                    } else setError(res.error);
                                    setDeletingRateId(null);
                                  }}
                                >
                                  Confirm
                                </button>
                                <button
                                  className="btn btn-sm btn-outline"
                                  onClick={() => setDeletingRateId(null)}
                                  style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                className="btn btn-sm"
                                onClick={() => setDeletingRateId(bank.id)}
                                style={{ padding: '3px 8px', fontSize: '0.7rem', background: 'var(--color-danger)', color: '#fff' }}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p style={{ marginTop: '8px', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
            These rates are used for auto-detection when a bank statement is uploaded. Banks are sourced from CBK's list of licensed institutions.
          </p>
        </div>
      )}
    </div>
  );
}
