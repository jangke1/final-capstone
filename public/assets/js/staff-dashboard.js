document.addEventListener('DOMContentLoaded', () => {
  const generateReportButton = document.getElementById('generate-report-btn');
  const reportOverlay = document.getElementById('report-overlay');
  const reportCloseButton = document.getElementById('report-close');
  const reportPrintButton = document.getElementById('report-print');
  const notificationButton = document.getElementById('notification-btn');
  const notificationOverlay = document.getElementById('notification-overlay');
  const notificationCloseButton = document.getElementById('notification-close');
  const notificationClearButton = document.getElementById('notification-clear-btn');
  const notificationList = document.getElementById('notification-list');
  const notificationBadge = document.getElementById('notification-badge');
  const notificationSummary = document.getElementById('notification-summary');

  let notifications = [];

  function formatNotificationTime(value) {
    if (!value) {
      return 'Just now';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function renderNotifications() {
    if (!notificationBadge || !notificationSummary || !notificationList) {
      return;
    }

    notificationBadge.textContent = String(notifications.length);
    notificationBadge.setAttribute('aria-label', `${notifications.length} new notifications`);
    notificationSummary.textContent = notifications.length === 1
      ? '1 compartment requires attention'
      : `${notifications.length} compartments require attention`;

    if (notifications.length === 0) {
      notificationList.classList.add('is-empty');
      notificationList.innerHTML = '<div class="notification-empty">No notifications right now.</div>';
      return;
    }

    notificationList.classList.remove('is-empty');
    notificationList.innerHTML = notifications
      .map((notification, index) => {
        const fullness = Number(notification.fullness ?? notification.fullness_percent ?? 0);
        const label = notification.label || (fullness >= 90 ? 'FULL' : 'ALERT');
        const title = notification.title || 'Segregation Unit';
        const material = notification.material || 'General Waste';
        const timeText = formatNotificationTime(notification.time || notification.created_at);

        return `
          <article class="notification-item">
            <div class="notification-item-main">
              <div class="notification-item-row">
                <h3 class="notification-item-title">${title}</h3>
                <span class="notification-pill">${label}</span>
              </div>
              <p class="notification-item-meta">Location: ${notification.location || 'Unknown location'}</p>
              <p class="notification-item-meta">Unit ID: ${notification.unit || 'N/A'}</p>
              <div class="notification-item-row" style="margin-top: 10px; margin-bottom: 0;">
                <span class="pill pill-filling" style="padding: 4px 10px; font-size: 0.75rem;">${material}</span>
              </div>
              <div class="notification-item-time">${timeText} • ${Number.isFinite(fullness) ? fullness.toFixed(1) : '0.0'}% Full</div>
            </div>
            <button class="notification-item-status" type="button" data-notification-index="${index}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M5 13l4 4L19 7"/>
              </svg>
              Mark as Emptied
            </button>
          </article>
        `;
      })
      .join('');
  }

  async function loadNotifications() {
    try {
      const response = await fetch('/api/notifications');
      if (!response.ok) {
        throw new Error('Failed to load notifications');
      }
      notifications = await response.json();
      renderNotifications();
    } catch (error) {
      console.error('[Dashboard] Failed to load notifications:', error);
      notifications = [];
      renderNotifications();
    }
  }

  function formatReportDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? String(value ?? '')
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  async function loadCurrentAccount() {
    try {
      const response = await fetch('/api/auth/status');
      const data = await response.json();
      if (!response.ok || !data.loggedIn) {
        window.location.assign('/login');
        return;
      }

      const accountName = document.querySelector('.account-name');
      const accountRole = document.querySelector('.account-role');
      if (accountName) accountName.textContent = data.username || data.email || 'User';
      if (accountRole) accountRole.textContent = data.role === 'admin' ? 'Administrator' : 'Staff';
    } catch (error) {
      console.error('[Dashboard] Failed to load current account:', error);
    }
  }

  async function loadReport() {
    const reportGenerated = document.querySelector('.report-generated');
    const reportPanelTitle = document.querySelector('.report-panel-title');
    const metricValues = document.querySelectorAll('.metric-card h3');
    const metricLabels = document.querySelectorAll('.metric-card p');
    const reportChart = document.querySelector('.report-chart svg');

    try {
      const response = await fetch('/api/reports');
      if (!response.ok) {
        throw new Error('Failed to load report');
      }

      const data = await response.json();
      const summary = data.summary || {};
      const timeline = Array.isArray(data.timeline) ? data.timeline : [];
      const generatedDate = data.generatedAt ? new Date(data.generatedAt) : new Date();

      if (reportGenerated) {
        reportGenerated.textContent = `Generated: ${generatedDate.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
      }

      if (reportPanelTitle) {
        reportPanelTitle.textContent = timeline.length
          ? `Waste Summary (${formatReportDate(timeline[0].date)} - ${formatReportDate(timeline[timeline.length - 1].date)})`
          : 'Waste Summary';
      }

      if (metricValues.length >= 4) {
        metricValues[0].textContent = `${summary.plasticBottles ?? 0}`;
        metricValues[1].textContent = `${summary.plastics ?? 0}`;
        metricValues[2].textContent = `${summary.papers ?? 0}`;
        metricValues[3].textContent = `${summary.compartmentsEmptied ?? 0}`;
      }

      if (metricLabels.length >= 4) {
        metricLabels[0].textContent = 'Plastic Bottles';
        metricLabels[1].textContent = 'Plastics';
        metricLabels[2].textContent = 'Papers';
        metricLabels[3].textContent = 'Compartments Emptied';
      }

      window.renderWasteReportChart(reportChart, timeline);
    } catch (error) {
      console.error('[Dashboard] Failed to load report:', error);
      window.renderWasteReportChart(reportChart, []);
    }
  }

  async function recordReportAction(type, description) {
    try {
      const response = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, description }),
      });
      if (!response.ok) throw new Error('Failed to record report activity');
    } catch (error) {
      console.error('[Dashboard] Failed to record report activity:', error);
    }
  }

  function openNotificationOverlay() {
    loadNotifications();
    notificationOverlay?.classList.add('open');
    notificationOverlay?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeNotificationOverlay() {
    notificationOverlay?.classList.remove('open');
    notificationOverlay?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function addNotification(notification) {
    notifications = [notification, ...notifications];
    renderNotifications();
  }

  function clearNotifications() {
    notifications = [];
    renderNotifications();
  }

  function openReportOverlay() {
    loadReport();
    reportOverlay?.classList.add('open');
    reportOverlay?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeReportOverlay() {
    reportOverlay?.classList.remove('open');
    reportOverlay?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  generateReportButton?.addEventListener('click', () => {
    openReportOverlay();
    recordReportAction('Report Generated', 'Generated a waste summary report');
  });
  reportPrintButton?.addEventListener('click', async () => {
    await recordReportAction('Report Printed', 'Printed a waste summary report');
    window.print();
  });
  notificationButton?.addEventListener('click', openNotificationOverlay);
  reportCloseButton?.addEventListener('click', closeReportOverlay);
  notificationCloseButton?.addEventListener('click', closeNotificationOverlay);
  notificationClearButton?.addEventListener('click', async () => {
    for (const notification of notifications) {
      if (!notification.id) continue;
      const response = await fetch(`/api/notifications/${notification.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json();
        window.alert(data.error || 'Could not clear notifications.');
        return;
      }
    }
    await loadNotifications();
  });

  reportOverlay?.addEventListener('click', (event) => {
    if (event.target === reportOverlay) {
      closeReportOverlay();
    }
  });

  notificationOverlay?.addEventListener('click', (event) => {
    if (event.target === notificationOverlay) {
      closeNotificationOverlay();
    }
  });

  notificationList?.addEventListener('click', async (event) => {
    const emptiedButton = event.target.closest('[data-notification-index]');

    if (!emptiedButton) {
      return;
    }

    const notificationIndex = Number(emptiedButton.getAttribute('data-notification-index'));
    const selectedNotification = notifications[notificationIndex];

    if (!selectedNotification || !selectedNotification.id) {
      return;
    }

    const response = await fetch(`/api/notifications/${selectedNotification.id}`, {
      method: 'DELETE',
    });
    if (response.ok) {
      notifications.splice(notificationIndex, 1);
      renderNotifications();
    } else {
      const data = await response.json();
      window.alert(data.error || 'Could not clear notification.');
    }
  });

  window.addEventListener('bin-readings-updated', loadNotifications);

  const signOutBtn = document.querySelector('#sign-out-btn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      window.location.assign('/logout');
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && reportOverlay?.classList.contains('open')) {
      closeReportOverlay();
    }

    if (event.key === 'Escape' && notificationOverlay?.classList.contains('open')) {
      closeNotificationOverlay();
    }
  });

  window.addNotification = addNotification;
  window.clearNotifications = clearNotifications;

  loadCurrentAccount();
  loadNotifications();
  loadReport();
});
