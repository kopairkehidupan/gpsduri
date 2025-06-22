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

function disableElement(element) {
    // Clone element untuk menghapus semua event listener yang ada
    const newElement = element.cloneNode(true);
    element.parentNode.replaceChild(newElement, element);
    
    // Tambahkan class dan handler baru
    newElement.classList.add('restricted-access');
    newElement.style.pointerEvents = 'none';
    
    // Tambahkan handler untuk mencegah aksi default
    newElement.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        alert(IP_CONFIG.accessDeniedMessage);
        return false;
    }, true); // Gunakan capture phase
}

function restrictAccess() {
    // Disable Upload Button
    const uploadBtn = document.querySelector('a[href="uploadsensuspokok.html"]');
    if (uploadBtn) disableElement(uploadBtn);

    // Disable Delete Buttons
    document.querySelectorAll('.btn-delete').forEach(btn => {
        disableElement(btn);
    });
}

// Initialize
(async function init() {
    try {
        const hasAccess = await checkIPAccess();
        if (!hasAccess) {
            // Add restricted style
            const style = document.createElement('style');
            style.textContent = `
                .restricted-access {
                    opacity: 0.6;
                    cursor: not-allowed !important;
                    pointer-events: none !important;
                    position: relative;
                }
                .restricted-access::after {
                    content: "🔒";
                    position: absolute;
                    right: 5px;
                    top: 50%;
                    transform: translateY(-50%);
                }
                .restricted-access:hover {
                    opacity: 0.6 !important;
                }
            `;
            document.head.appendChild(style);
            
            // Restrict access
            restrictAccess();
            
            // Observer untuk menangani elemen yang muncul kemudian
            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.addedNodes.length) {
                        restrictAccess();
                    }
                });
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    } catch (error) {
        console.error('Access control initialization failed:', error);
        // Default to restricted access if check fails
        restrictAccess();
    }
})();
