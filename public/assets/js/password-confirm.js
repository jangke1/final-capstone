(() => {
  window.requestCurrentPassword = () => new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="password-confirm-title">
        <form>
          <div class="modal-header">
            <div><h3 id="password-confirm-title">Confirm this change</h3></div>
          </div>
          <div class="modal-body">
            <div class="form-group" style="margin-bottom: 0">
              <label class="form-label" for="password-confirm-input">Your Password</label>
              <input class="form-input" type="password" id="password-confirm-input" autocomplete="current-password" required />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" data-password-cancel>Cancel</button>
            <button type="submit" class="btn btn-primary">Confirm</button>
          </div>
        </form>
      </div>
    `;

    document.body.append(overlay);
    const form = overlay.querySelector('form');
    const input = overlay.querySelector('#password-confirm-input');
    let settled = false;

    const finish = (password = null) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', handleKeydown);
      overlay.remove();
      resolve(password);
    };

    const handleKeydown = (event) => {
      if (event.key === 'Escape') finish();
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (input.value) finish(input.value);
    });
    overlay.querySelector('[data-password-cancel]').addEventListener('click', () => finish());
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish();
    });
    document.addEventListener('keydown', handleKeydown);
    input.focus();
  });
})();