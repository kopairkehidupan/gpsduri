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

function disableDeleteFunctionality() {
    // Hapus semua event listener yang ada pada tombol hapus
    document.querySelectorAll('.btn-delete').forEach(btn => {
        // Clone tombol untuk menghapus event listener yang ada
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        // Tambahkan class restricted
        newBtn.classList.add('restricted-access');
        
        // Nonaktifkan sepenuhnya
        newBtn.onclick = null;
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            alert(IP_CONFIG.accessDeniedMessage);
            return false;
        });
        
        // Nonaktifkan juga event listener dari parent jika ada
        if (newBtn.closest('td')) {
            newBtn.closest('td').onclick = null;
        }
    });
    
    // Nonaktifkan confirmAlert jika ada
    const confirmAlert = document.getElementById('confirmAlert');
    if (confirmAlert) {
        confirmAlert.style.display = 'none';
    }
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

    // Disable Delete Buttons secara lebih agresif
    disableDeleteFunctionality();
}

// Initialize
(async function init() {
    try {
        const hasAccess = await checkIPAccess();
        if (!hasAccess) {
            // Tambahkan style terlebih dahulu
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
            
            // Kemudian restrict akses
            restrictAccess();
            
            // Nonaktifkan setupDeleteButtons
            if (window.setupDeleteButtons) {
                window.setupDeleteButtons = function() {};
            }
        }
    } catch (error) {
        console.error('Access control initialization failed:', error);
        // Default to restricted access if check fails
        restrictAccess();
    }
})();
