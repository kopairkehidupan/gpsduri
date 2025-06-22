// Konfigurasi
const IP_CONFIG = {
    allowedIPs: ['192.168.195.97', '123.123.123.123'],
    apiEndpoints: [
        'https://api.ipify.org?format=json',
        'https://api64.ipify.org?format=json'
    ],
    accessDeniedMessage: 'Akses terbatas: Fitur ini hanya tersedia untuk perangkat tertentu'
};

// Utility Functions
async function getClientIP(apiUrl) {
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Network response was not ok');
        return await response.json();
    } catch (error) {
        console.error(`Error fetching IP from ${apiUrl}:`, error);
        throw error;
    }
}

async function checkIPAccess() {
    for (const endpoint of IP_CONFIG.apiEndpoints) {
        try {
            const { ip } = await getClientIP(endpoint);
            if (IP_CONFIG.allowedIPs.includes(ip)) return true;
        } catch {
            continue;
        }
    }
    return false;
}

function restrictAccess() {
    // Disable Upload Button
    const uploadBtn = document.querySelector('a[href="uploadsensuspokok.html"]');
    if (uploadBtn) {
        uploadBtn.classList.add('restricted-access');
        uploadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            alert(IP_CONFIG.accessDeniedMessage);
        });
    }

    // Disable Delete Buttons
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.classList.add('restricted-access');
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            alert(IP_CONFIG.accessDeniedMessage);
        });
    });
}

// Initialize
(async function init() {
    try {
        const hasAccess = await checkIPAccess();
        if (!hasAccess) {
            restrictAccess();
            
            // Add restricted style
            const style = document.createElement('style');
            style.textContent = `
                .restricted-access {
                    opacity: 0.6;
                    cursor: not-allowed;
                    position: relative;
                }
                .restricted-access::after {
                    content: "🔒";
                    position: absolute;
                    right: 5px;
                    top: 50%;
                    transform: translateY(-50%);
                }
            `;
            document.head.appendChild(style);
        }
    } catch (error) {
        console.error('Access control initialization failed:', error);
        // Default to restricted access if check fails
        restrictAccess();
    }
})();
