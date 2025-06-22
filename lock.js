// Konfigurasi
const IP_CONFIG = {
    allowedIPs: ['192.168.195.97', '123.123.123.123'],
    apiEndpoints: [
        'https://api.ipify.org?format=json',
        'https://ipinfo.io/json',
        'https://ipapi.co/json'
    ],
    accessDeniedMessage: 'Akses terbatas: Fitur ini hanya tersedia untuk perangkat tertentu',
    debugMode: true // Set ke false untuk production
};

// Utility Functions
async function getClientIP(apiUrl) {
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        
        // Handle berbagai format response API
        const ip = data.ip || data.ipAddress;
        if (IP_CONFIG.debugMode) console.log(`API: ${apiUrl}, IP: ${ip}`);
        return ip;
    } catch (error) {
        if (IP_CONFIG.debugMode) console.error(`Error fetching IP from ${apiUrl}:`, error);
        throw error;
    }
}

async function checkIPAccess() {
    if (IP_CONFIG.debugMode) console.log('Memeriksa akses IP...');
    
    // Coba semua endpoint sampai berhasil
    for (const endpoint of IP_CONFIG.apiEndpoints) {
        try {
            const ip = await getClientIP(endpoint);
            if (IP_CONFIG.debugMode) console.log('IP terdeteksi:', ip);
            
            // Periksa apakah IP termasuk dalam yang diizinkan
            const isAllowed = IP_CONFIG.allowedIPs.some(allowedIP => {
                // Bandingkan dengan atau tanpa prefix
                return ip === allowedIP || ip.endsWith(allowedIP);
            });
            
            if (isAllowed) {
                if (IP_CONFIG.debugMode) console.log('IP diizinkan');
                return true;
            }
        } catch (error) {
            continue;
        }
    }
    
    if (IP_CONFIG.debugMode) console.log('IP tidak diizinkan atau gagal deteksi');
    return false;
}

function disableElement(element) {
    if (element.classList.contains('restricted-access')) return;
    
    const newElement = element.cloneNode(true);
    element.parentNode.replaceChild(newElement, element);
    
    newElement.classList.add('restricted-access');
    newElement.style.pointerEvents = 'none';
    
    newElement.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        alert(IP_CONFIG.accessDeniedMessage);
        return false;
    }, true);
}

function restrictAccess() {
    if (IP_CONFIG.debugMode) console.log('Membatasi akses...');
    
    const uploadBtn = document.querySelector('a[href="uploadsensuspokok.html"]');
    if (uploadBtn) disableElement(uploadBtn);

    document.querySelectorAll('.btn-delete').forEach(btn => {
        disableElement(btn);
    });
}

// Initialize
(async function init() {
    try {
        const hasAccess = await checkIPAccess();
        
        // Debug info
        if (IP_CONFIG.debugMode) {
            console.log('Hasil pemeriksaan akses:', hasAccess);
            console.log('IP yang diizinkan:', IP_CONFIG.allowedIPs);
        }
        
        if (!hasAccess) {
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
            `;
            document.head.appendChild(style);
            
            restrictAccess();
        } else {
            if (IP_CONFIG.debugMode) console.log('Akses diizinkan');
        }
    } catch (error) {
        console.error('Error:', error);
        if (IP_CONFIG.debugMode) {
            alert('Mode Debug: Terjadi error saat memeriksa akses. Lihat console untuk detail.');
        }
    }
})();
