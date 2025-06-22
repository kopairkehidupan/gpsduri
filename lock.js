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
        return data.ip || data.ipAddress;
    } catch (error) {
        if (IP_CONFIG.debugMode) console.error(`Error fetching IP from ${apiUrl}:`, error);
        throw error;
    }
}

async function getLocalIPs() {
    return new Promise((resolve) => {
        const ips = [];
        const RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
        
        if (!RTCPeerConnection) {
            if (IP_CONFIG.debugMode) console.log('RTCPeerConnection not supported');
            resolve([]);
            return;
        }

        const pc = new RTCPeerConnection({ iceServers: [] });
        
        pc.createDataChannel('');
        pc.createOffer()
            .then(offer => pc.setLocalDescription(offer))
            .catch(err => {
                if (IP_CONFIG.debugMode) console.error('Error creating offer:', err);
                resolve([]);
            });

        pc.onicecandidate = (ice) => {
            if (!ice || !ice.candidate || !ice.candidate.candidate) return;
            const ip = ice.candidate.candidate.split(' ')[4];
            if (ip && ips.indexOf(ip) === -1) ips.push(ip);
        };

        setTimeout(() => {
            if (IP_CONFIG.debugMode) console.log('Local IPs detected:', ips);
            resolve(ips);
        }, 1000);
    });
}

async function checkIPAccess() {
    if (IP_CONFIG.debugMode) console.log('Memeriksa akses IP...');
    
    // Dapatkan IP lokal terlebih dahulu
    const localIPs = await getLocalIPs();
    if (IP_CONFIG.debugMode) console.log('IP Lokal:', localIPs);
    
    // Periksa IP lokal terlebih dahulu
    const localMatch = localIPs.some(ip => 
        IP_CONFIG.allowedIPs.some(allowedIP => ip === allowedIP)
    );
    
    if (localMatch) {
        if (IP_CONFIG.debugMode) console.log('IP lokal diizinkan');
        return true;
    }
    
    // Jika tidak ada match di lokal, cek IP publik
    for (const endpoint of IP_CONFIG.apiEndpoints) {
        try {
            const ip = await getClientIP(endpoint);
            if (IP_CONFIG.debugMode) console.log('IP Publik terdeteksi:', ip);
            
            const isAllowed = IP_CONFIG.allowedIPs.some(allowedIP => ip === allowedIP);
            
            if (isAllowed) {
                if (IP_CONFIG.debugMode) console.log('IP publik diizinkan');
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
