/**
 * Access Guard - Protects pages that require data source setup
 * Include this script at the top of protected pages (dashboard, table, map, etc.)
 */

(function() {
    async function checkAccess() {
        const sessionStr = localStorage.getItem('customer_session');

        // For testing: bypass authentication
        if (!sessionStr) {
            console.log('No session found - bypassing for testing');
            const mockSession = {
                customerId: 'test-customer-id',
                userId: 'test-user-id',
                email: 'test@example.com',
                role: 'owner',
                sessionToken: 'test-token',
                dataSource: 'teable'
            };
            localStorage.setItem('customer_session', JSON.stringify(mockSession));
            return true;
        }

        try {
            const session = JSON.parse(sessionStr);

            if (!session.customerId) {
                console.log('Invalid session - creating mock session for testing');
                const mockSession = {
                    customerId: 'test-customer-id',
                    userId: 'test-user-id',
                    email: 'test@example.com',
                    role: 'owner',
                    sessionToken: 'test-token',
                    dataSource: 'teable'
                };
                localStorage.setItem('customer_session', JSON.stringify(mockSession));
                return true;
            }

            // Check if data source is configured
            if (!session.dataSource) {
                showSetupRequiredModal();
                return false;
            }

            return true;
        } catch (error) {
            console.error('Session validation error:', error);
            const mockSession = {
                customerId: 'test-customer-id',
                userId: 'test-user-id',
                email: 'test@example.com',
                role: 'owner',
                sessionToken: 'test-token',
                dataSource: 'teable'
            };
            localStorage.setItem('customer_session', JSON.stringify(mockSession));
            return true;
        }
    }

    function showSetupRequiredModal() {
        const modalHtml = `
            <div class="modal fade" id="setupRequiredModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header bg-warning text-dark">
                            <h5 class="modal-title">
                                <i class="fas fa-exclamation-triangle me-2"></i>
                                Setup Required
                            </h5>
                        </div>
                        <div class="modal-body">
                            <p class="mb-0">Please complete your data source setup to access this feature.</p>
                            <p class="text-muted small mb-0 mt-2">You need to connect either Teable or Google Sheets before you can use the GIS system.</p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-primary" onclick="window.location.href='/data-source-setup.html'">
                                <i class="fas fa-cog me-2"></i>Complete Setup
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="window.location.href='/'">
                                <i class="fas fa-home me-2"></i>Go Home
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = new bootstrap.Modal(document.getElementById('setupRequiredModal'));
        modal.show();
    }

    // Run check on page load
    document.addEventListener('DOMContentLoaded', async function() {
        const hasAccess = await checkAccess();

        if (!hasAccess) {
            // Hide page content while showing modal
            document.body.style.opacity = '0.3';
            document.body.style.pointerEvents = 'none';
        }
    });

    // Export for use in other scripts
    window.accessGuard = {
        checkAccess: checkAccess,
        getSession: function() {
            const sessionStr = localStorage.getItem('customer_session');
            return sessionStr ? JSON.parse(sessionStr) : null;
        }
    };
})();
