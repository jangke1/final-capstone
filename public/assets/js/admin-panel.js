let users = [];

let currentUser = null;
let units = [];
let logs = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function updateAdminStats() {
  const userTotal = document.querySelector('[data-admin-stat="users-total"]');
  const unitTotal = document.querySelector('[data-admin-stat="units-total"]');
  const unitActive = document.querySelector('[data-admin-stat="units-active"]');
  const logTotal = document.querySelector('[data-admin-stat="logs-total"]');

  if (userTotal) userTotal.textContent = String(users.length);
  if (unitTotal) unitTotal.textContent = String(units.length);
  if (unitActive) unitActive.textContent = `${units.filter((unit) => unit.status === 'Active').length} active`;
  if (logTotal) {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const recentLogs = logs.filter((log) => new Date(log.timestamp).getTime() >= since).length;
    logTotal.textContent = String(recentLogs);
  }
}

async function loadLogsData() {
  try {
    const response = await fetch('/api/logs');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load system logs');
    logs = Array.isArray(data) ? data : [];
    populateLogsTable();
  } catch (error) {
    console.error('Error loading system logs:', error);
    logs = [];
    populateLogsTable('Could not load system logs. Refresh the page to try again.');
  }
}

async function loadCurrentUser() {
  try {
    const response = await fetch('/api/auth/status');
    const data = await response.json();
    if (data.loggedIn) {
      currentUser = { id: data.id, username: data.username, email: data.email, role: data.role };
      const accountName = document.querySelector('.account-name');
      const accountRole = document.querySelector('.account-role');
      if (accountName) accountName.textContent = data.username || data.email || 'User';
      if (accountRole) accountRole.textContent = data.role === 'admin' ? 'Administrator' : 'Staff';
    }
  } catch (error) {
    console.error('Error loading current user:', error);
  }
}

async function loadUsersData() {
  try {
    const response = await fetch('/api/users');
    users = await response.json();
    if (!Array.isArray(users)) users = [];
  } catch (error) {
    console.error('Error loading users:', error);
    users = [];
  } finally {
    populateAssignedUserOptions();
    populateUsersTable();
    updateAdminStats();
  }
}

const pinIcon = `<svg class="icon pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
const eyeIcon = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const editIcon = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path></svg>`;
const trashIcon = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`;
const caretIcon = `<svg class="icon caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

const roleClassMap = { admin: 'role-admin', Administrator: 'role-admin', staff: 'role-staff', Staff: 'role-staff' };
const roleLabelMap = { admin: 'Administrator', staff: 'Staff' };
const statusClassMap = { Active: 'status-active', Inactive: 'status-inactive' };

const getRoleClass = (role) => roleClassMap[role] || '';
const getRoleLabel = (role) => roleLabelMap[role] || role;
const getStatusClass = (status) => statusClassMap[status] || '';

function populateUsersTable() {
  const tbody = document.getElementById('users-tbody');

  tbody.innerHTML = users.map((user) => `
    <tr data-user-id="${user.id}">
      <td>${user.username || ''}</td>
      <td>${user.email}</td>
      <td>${escapeHtml(user.phoneNumber || 'Not assigned')}</td>
      <td>
        <span class="badge role-badge ${getRoleClass(user.role)}">${getRoleLabel(user.role)}</span>
      </td>
      <td>${user.created}</td>
      <td>${user.lastLogin}</td>
      <td>
        <div class="action-buttons">
          <button class="action-btn view-btn" aria-label="Edit user" title="Edit">${editIcon}</button>
          <button class="action-btn delete-btn" aria-label="Delete user" title="Delete">${trashIcon}</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function populateUnitsTable() {
  const tbody = document.getElementById('units-tbody');
  if (!tbody) return;

  tbody.innerHTML = units.map((unit) => `
    <tr data-unit-id="${unit.id}">
      <td>${escapeHtml(unit.unitId)}</td>
      <td>${escapeHtml(unit.name)}</td>
      <td>
        <div class="location-cell">${pinIcon}${escapeHtml(unit.location)}</div>
      </td>
      <td>${escapeHtml(unit.assignedUserName || 'Unassigned')}</td>
      <td>
        <div class="status-cell">
          <span class="status-badge">${escapeHtml(unit.status)}</span>
          ${caretIcon}
        </div>
      </td>
      <td class="install-date">${escapeHtml(unit.installDate)}</td>
      <td>
        <div class="action-buttons">
          <button class="action-btn unit-edit-btn" type="button" aria-label="Edit ${escapeHtml(unit.unitId)}" title="Edit">${editIcon}</button>
          <button class="action-btn unit-delete-btn" type="button" aria-label="Delete ${escapeHtml(unit.unitId)}" title="Delete">${trashIcon}</button>
        </div>
      </td>
    </tr>
  `).join('');
  updateAdminStats();
}

function populateAssignedUserOptions() {
  const selects = [
    document.getElementById('add-unit-assigned-user'),
    document.getElementById('edit-unit-assigned-user'),
  ];

  for (const select of selects) {
    if (!select) continue;
    const selectedValue = select.value;
    select.innerHTML = '<option value="">No user assigned</option>' +
      users.filter((user) => user.phoneNumber).map((user) => {
        const label = `${user.username || user.email} (${user.phoneNumber})`;
        return `<option value="${user.id}">${escapeHtml(label)}</option>`;
      }).join('');
    if (selectedValue && users.some((user) => String(user.id) === selectedValue)) {
      select.value = selectedValue;
    }
  }
}

async function loadUnitsData() {
  const tbody = document.getElementById('units-tbody');

  try {
    const response = await fetch('/api/units');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load units');
    }

    units = Array.isArray(data) ? data : [];
    populateUnitsTable();
  } catch (error) {
    console.error('Error loading units:', error);
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7">Could not load units. Refresh the page to try again.</td></tr>';
    }
  }
}

function populateLogsTable(errorMessage = '') {
  const tbody = document.getElementById('logs-tbody');
  if (!tbody) return;

  if (errorMessage) {
    tbody.innerHTML = `<tr><td colspan="5">${escapeHtml(errorMessage)}</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map((log) => `
    <tr>
      <td>${escapeHtml(log.timestamp)}</td>
      <td>${escapeHtml(log.type)}</td>
      <td>${escapeHtml(log.user)}</td>
      <td>${escapeHtml(log.description)}</td>
      <td><span class="badge status-badge ${log.status === 'Success' ? 'status-active' : 'status-inactive'}">${escapeHtml(log.status)}</span></td>
    </tr>
  `).join('');
  updateAdminStats();
}

function initTabSwitching() {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      document.getElementById(tab.dataset.tab + '-panel')?.classList.add('active');
    });
  });
}

function initAddUserModal() {
  const overlay = document.getElementById('add-user-overlay');
  const openBtn = document.querySelector('#users-panel .add-btn');
  const closeBtn = document.getElementById('add-user-close');
  const cancelBtn = document.getElementById('add-user-cancel');
  const form = document.getElementById('add-user-form');
  const errorEl = document.getElementById('add-user-error');

  const openModal = () => {
    errorEl.style.display = 'none';
    populateAssignedUserOptions();
    overlay.classList.add('open');
  };

  const closeModal = () => {
    overlay.classList.remove('open');
    form.reset();
    errorEl.style.display = 'none';
  };

  openBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const newUser = Object.fromEntries(formData.entries());

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to add user');
      }

      closeModal();
      await loadUsersData();
      await loadLogsData();
    } catch (error) {
      console.error('Error adding user:', error);
      errorEl.textContent = error.message;
      errorEl.style.display = 'block';
    }
  });
}

function initAddUnitModal() {
  const overlay = document.getElementById('add-unit-overlay');
  const openBtn = document.querySelector('#units-panel .add-btn');
  const closeBtn = document.getElementById('add-unit-close');
  const cancelBtn = document.getElementById('add-unit-cancel');
  const form = document.getElementById('add-unit-form');
  const errorEl = document.getElementById('add-unit-error');

  const openModal = () => {
    errorEl.style.display = 'none';
    overlay.classList.add('open');
    document.getElementById('add-unit-id')?.focus();
  };

  const closeModal = () => {
    overlay.classList.remove('open');
    form.reset();
    errorEl.style.display = 'none';
  };

  openBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.style.display = 'none';

    const payload = Object.fromEntries(new FormData(form).entries());

    try {
      const response = await fetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to add unit');
      }

      closeModal();
      await loadUnitsData();
      await loadLogsData();
    } catch (error) {
      console.error('Error adding unit:', error);
      errorEl.textContent = error.message;
      errorEl.style.display = 'block';
    }
  });
}

function initEditUnitModal() {
  const overlay = document.getElementById('edit-unit-overlay');
  const closeBtn = document.getElementById('edit-unit-close');
  const cancelBtn = document.getElementById('edit-unit-cancel');
  const form = document.getElementById('edit-unit-form');
  const errorEl = document.getElementById('edit-unit-error');

  const closeModal = () => {
    overlay.classList.remove('open');
    form.reset();
    errorEl.style.display = 'none';
  };

  const openModal = (unit) => {
    form.reset();
    errorEl.style.display = 'none';
    document.getElementById('edit-unit-db-id').value = unit.id;
    document.getElementById('edit-unit-id').value = unit.unitId;
    document.getElementById('edit-unit-name').value = unit.name;
    document.getElementById('edit-unit-location').value = unit.location;
    populateAssignedUserOptions();
    document.getElementById('edit-unit-assigned-user').value = unit.assignedUserId || '';
    document.getElementById('edit-unit-status').value = unit.status;
    overlay.classList.add('open');
  };

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) closeModal();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.style.display = 'none';
    const payload = Object.fromEntries(new FormData(form).entries());
    const id = payload.id;
    delete payload.id;

    try {
      const response = await fetch(`/api/units/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update unit');

      closeModal();
      await loadUnitsData();
      await loadLogsData();
    } catch (error) {
      errorEl.textContent = error.message;
      errorEl.style.display = 'block';
    }
  });

  document.getElementById('units-tbody')?.addEventListener('click', (event) => {
    const button = event.target.closest('.unit-edit-btn');
    if (!button) return;
    const id = Number(button.closest('tr').dataset.unitId);
    const unit = units.find((item) => item.id === id);
    if (unit) openModal(unit);
  });
}

function initDeleteUnitAction() {
  document.getElementById('units-tbody')?.addEventListener('click', async (event) => {
    const button = event.target.closest('.unit-delete-btn');
    if (!button) return;

    const row = button.closest('tr');
    const unit = units.find((item) => item.id === Number(row.dataset.unitId));
    if (!unit || !window.confirm(`Delete ${unit.unitId} (${unit.name})? This cannot be undone.`)) return;
    const currentPassword = await window.requestCurrentPassword();
    if (!currentPassword) return;

    try {
      const response = await fetch(`/api/units/${unit.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to delete unit');
      await loadUnitsData();
      await loadLogsData();
    } catch (error) {
      window.alert(error.message);
    }
  });
}

async function loadSmsToggleState() {
  const btn = document.getElementById('sms-toggle-btn');
  const thresholdInput = document.getElementById('alert-threshold');
  if (!btn && !thresholdInput) return;

  try {
    const response = await fetch('/api/settings');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to load settings');
    if (btn) {
      const enabled = Boolean(data.smsEnabled);
      btn.dataset.enabled = String(enabled);
      btn.setAttribute('aria-pressed', String(enabled));
      btn.textContent = enabled ? 'Enabled' : 'Disabled';
    }
    if (thresholdInput && Number.isInteger(data.alertThreshold)) {
      thresholdInput.value = String(data.alertThreshold);
    }
  } catch (error) {
    console.error('Error loading alert settings:', error);
  }
}

function initAlertThreshold() {
  const input = document.getElementById('alert-threshold');
  const button = document.getElementById('save-alert-threshold');
  const status = document.getElementById('alert-threshold-status');
  if (!input || !button || !status) return;

  button.addEventListener('click', async () => {
    status.textContent = '';
    if (!input.reportValidity()) return;

    const currentPassword = await window.requestCurrentPassword();
    if (!currentPassword) return;

    button.disabled = true;
    button.textContent = 'Saving...';
    try {
      const response = await fetch('/api/settings/alert-threshold', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertThreshold: input.valueAsNumber, currentPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save alert threshold');

      input.value = String(data.alertThreshold);
      status.textContent = 'Alert threshold saved.';
      await loadLogsData();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Save Threshold';
    }
  });
}

function initSmsToggle() {
  const btn = document.getElementById('sms-toggle-btn');

  btn?.addEventListener('click', async () => {
    const isEnabled = btn.dataset.enabled === 'true';
    const next = !isEnabled;
    const currentPassword = await window.requestCurrentPassword();
    if (!currentPassword) return;

    try {
      const response = await fetch('/api/settings/sms', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next, currentPassword }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update SMS preference');
      }

      btn.dataset.enabled = String(Boolean(data.enabled));
      btn.setAttribute('aria-pressed', String(Boolean(data.enabled)));
      btn.textContent = Boolean(data.enabled) ? 'Enabled' : 'Disabled';
      await loadLogsData();
    } catch (error) {
      console.error('Error updating SMS toggle:', error);
      alert(error.message || 'Could not update SMS settings. Please try again.');
    }
  });

  loadSmsToggleState();
}

function initEditUserModal() {
  const overlay = document.getElementById('edit-user-overlay');
  const closeBtn = document.getElementById('edit-user-close');
  const cancelBtn = document.getElementById('edit-user-cancel');
  const form = document.getElementById('edit-user-form');
  const errorEl = document.getElementById('edit-user-error');

  const openModal = (user) => {
    form.reset();
    errorEl.style.display = 'none';
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-username').value = user.username || '';
    document.getElementById('edit-user-email').value = user.email;
    document.getElementById('edit-user-phone').value = user.phoneNumber || '';
    document.getElementById('edit-user-role').value = user.role;
    overlay.classList.add('open');
  };

  const closeModal = () => {
    overlay.classList.remove('open');
    form.reset();
    errorEl.style.display = 'none';
  };

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());

    const id = payload.id;
    delete payload.id;

    if (!payload.password) delete payload.password;

    try {
      const response = await fetch(`/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update user');
      }

      closeModal();
      await loadUsersData();
      await loadCurrentUser();
      await loadLogsData();
    } catch (error) {
      console.error(error);
      errorEl.textContent = error.message;
      errorEl.style.display = 'block';
    }
  });

  document.getElementById('users-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-btn');
    if (!btn) return;

    const row = btn.closest('tr');
    const id = Number(row.dataset.userId);
    const user = users.find((u) => u.id === id);

    if (user) openModal(user);
  });
}

function initDeleteUserModal() {
  const overlay = document.getElementById('delete-user-overlay');
  const closeBtn = document.getElementById('delete-user-close');
  const cancelBtn = document.getElementById('delete-user-cancel');
  const confirmBtn = document.getElementById('delete-user-confirm');
  const nameEl = document.getElementById('delete-user-name');
  const errorEl = document.getElementById('delete-user-error');
  const passwordInput = document.getElementById('delete-user-admin-password');

  let pendingUser = null;

  const openModal = (user) => {
    pendingUser = user;
    passwordInput.value = '';
    errorEl.style.display = 'none';
    nameEl.textContent = user.username || user.email;
    overlay.classList.add('open');
  };

  const closeModal = () => {
    overlay.classList.remove('open');
    errorEl.style.display = 'none';
    passwordInput.value = '';
    pendingUser = null;
  };

  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);

  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  confirmBtn?.addEventListener('click', async () => {
    if (!pendingUser) return;

    if (currentUser && Number(currentUser.id) === Number(pendingUser.id)) {
      errorEl.textContent = 'You cannot delete your own account.';
      errorEl.style.display = 'block';
      return;
    }

    const currentPassword = passwordInput.value;
    if (!currentPassword) {
      errorEl.textContent = 'Enter your password to continue.';
      errorEl.style.display = 'block';
      passwordInput.focus();
      return;
    }

    try {
      const response = await fetch(`/api/users/${pendingUser.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete user');
      }

      closeModal();
      await loadUsersData();
      await loadLogsData();
    } catch (error) {
      console.error(error);
      errorEl.textContent = error.message;
      errorEl.style.display = 'block';
    }
  });

  document.getElementById('users-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.delete-btn');
    if (!btn) return;

    const row = btn.closest('tr');
    const id = Number(row.dataset.userId);
    const user = users.find((u) => u.id === id);

    if (user) openModal(user);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentUser();
  await loadUsersData();

  await loadUnitsData();
  await loadLogsData();

  initTabSwitching();
  initAddUserModal();
  initAddUnitModal();
  initEditUnitModal();
  initDeleteUnitAction();
  initEditUserModal();
  initDeleteUserModal();
  initSmsToggle();
  initAlertThreshold();

  document.getElementById('sign-out-btn')?.addEventListener('click', () => {
    window.location.assign('/logout');
  });
});