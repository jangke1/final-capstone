let isLoggedIn = false;

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const rememberCheckbox = document.querySelector('input[name="remember"]');
    const errorDisplay = document.getElementById('errorDisplay');

    checkInitialAuthStatus();

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            if (errorDisplay) errorDisplay.textContent = '';

            const email = emailInput.value.trim();
            const password = passwordInput.value.trim();
            const rememberMe = rememberCheckbox ? rememberCheckbox.checked : false;

            if (!email || !password) {
                if (errorDisplay) errorDisplay.textContent = 'Please enter both email and password.';
                return;
            }

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ email, password, remember: rememberMe })
                });

                const data = await response.json();

                if (response.ok) {
                    isLoggedIn = true;
                    window.location.href = data.redirect || '/admin/dashboard';
                } else {
                    isLoggedIn = false;
                    if (errorDisplay) errorDisplay.textContent = data.error || 'Login failed. Please try again.';
                }
            } catch (error) {
                console.error('Error during login request:', error);
                isLoggedIn = false;
                if (errorDisplay) errorDisplay.textContent = 'A network error occurred. Please try again.';
            }
        });
    }

    async function checkInitialAuthStatus() {
        try {
            const response = await fetch('/api/auth/status', {
                method: 'GET',
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                isLoggedIn = data.loggedIn;
                if (isLoggedIn && data.redirect && window.location.pathname.includes('login')) {
                    window.location.href = data.redirect;
                }
            } else {
                isLoggedIn = false;
            }
        } catch (error) {
            console.error('Error checking authentication status:', error);
            isLoggedIn = false;
        }
    }
});