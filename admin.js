document.addEventListener('DOMContentLoaded', () => {

    // --- MQTT Configuration ---
    const mqttHost = "d81c3cd5abb4432bb5b7729e27766fa9.s1.eu.hivemq.cloud";
    const mqttPort = 8884; // WebSocket Secure
    const mqttTopic = "esp32/control";
    const clientId = "admin-" + Math.random().toString(16).substr(2, 8); // Unique ID

    const mqttUser = "ESP32_MQTT_test";
    const mqttPass = "ESP@mqtt123";

    let client = null;
    let isConnected = false;

    // Backend API URL
    const BACKEND_URL = 'http://localhost:3000'; // Make sure this matches your backend PORT


    // UI Elements
    const statusBadge = document.getElementById('status-badge');
    const statusText = document.getElementById('status-text');
    const btnDispense = document.getElementById('btn-manual-dispense');
    const btnStop = document.getElementById('btn-manual-stop');
    const liveWeightDisplay = document.getElementById('live-weight');
    const statRevenue = document.getElementById('stat-revenue');
    const statSold = document.getElementById('stat-sold');
    const transactionsBody = document.getElementById('transactions-body');

    function updateStatusUI(connected) {
        if (connected) {
            statusBadge.classList.add('online');
            statusText.textContent = "Online";
        } else {
            statusBadge.classList.remove('online');
            statusText.textContent = "Disconnected";
        }
    }

    // Initialize MQTT
    function initMQTT() {
        console.log("Initializing MQTT for Admin...");
        try {
            client = new Paho.MQTT.Client(mqttHost, mqttPort, clientId);

            client.onConnectionLost = onConnectionLost;
            client.onMessageArrived = onMessageArrived;

            const options = {
                useSSL: true,
                userName: mqttUser,
                password: mqttPass,
                onSuccess: onConnect,
                onFailure: onFailure
            };

            client.connect(options);
        } catch (e) {
            console.error("MQTT Error:", e);
        }
    }

    function onConnect() {
        console.log("Admin MQTT Connected!");
        isConnected = true;
        // Subscribe to Device Status and Weight
        client.subscribe("esp32/status");
        client.subscribe("esp32/weight");
        console.log("Subscribed to esp32/status and esp32/weight");
    }

    function onFailure(message) {
        console.error("MQTT Connection Failed: " + message.errorMessage);
        // Don't change UI here, rely on status message
    }

    function onConnectionLost(responseObject) {
        if (responseObject.errorCode !== 0) {
            console.log("MQTT Connection Lost: " + responseObject.errorMessage);
        }
        isConnected = false;
    }

    let heartbeatTimer = null;

    function onMessageArrived(message) {
        const topic = message.destinationName;
        const payload = message.payloadString;

        if (topic === "esp32/status") {
            // Heartbeat Logic
            if (payload === "PING" || payload === "ONLINE") {
                // 1. Mark Online
                updateStatusUI(true);

                // 2. Clear existing timer
                if (heartbeatTimer) clearTimeout(heartbeatTimer);

                // 3. Set new timer: If no PING for 10s, mark Offline
                heartbeatTimer = setTimeout(() => {
                    console.warn("Heartbeat lost! Marking Offline.");
                    updateStatusUI(false);
                }, 10000); // 10 seconds timeout
            }
            else if (payload === "OFFLINE") {
                updateStatusUI(false);
            }
        }

        // Update Live Weight Display
        if (topic === "esp32/weight") {
            liveWeightDisplay.textContent = payload + "g";
        }
    }

    function sendMqttMessage(msg) {
        if (client && isConnected) {
            const message = new Paho.MQTT.Message(msg);
            message.destinationName = mqttTopic;
            client.send(message);

            // Show toast
            const Toast = Swal.mixin({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000,
                timerProgressBar: true
            });
            Toast.fire({
                icon: 'success',
                title: `Sent: ${msg}`
            });
        } else {
            Swal.fire("Error", "System Not Connected", "error");
        }
    }

    initMQTT();

    // --- Backend API Integration ---
    async function loadStats() {
        try {
            const response = await fetch(`${BACKEND_URL}/api/stats`);
            const data = await response.json();

            if (statRevenue) statRevenue.textContent = `₹${data.totalRevenue}`;
            if (statSold) statSold.textContent = data.transactionCount;

            console.log('Stats loaded:', data);
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }

    async function loadTransactions() {
        try {
            const response = await fetch(`${BACKEND_URL}/api/transactions`);
            const transactions = await response.json();

            if (!transactionsBody) return;

            if (transactions.length === 0) {
                transactionsBody.innerHTML = `
                    <tr>
                        <td colspan="5" style="padding: 20px; text-align: center; color: var(--text-light);">No transactions yet.</td>
                    </tr>
                `;
                return;
            }

            // Render list (limit to 10 newest)
            transactionsBody.innerHTML = transactions.slice(0, 10).map(t => `
                <tr style="border-bottom: 1px solid #F3F4F6;">
                    <td style="padding: 12px;">${new Date(t.createdAt).toLocaleTimeString()}</td>
                    <td style="padding: 12px; font-family: monospace; font-size: 0.8rem;">${t.orderId}</td>
                    <td style="padding: 12px; font-weight: 600;">₹${t.amount}</td>
                    <td style="padding: 12px;">${t.grams}g</td>
                    <td style="padding: 12px;">
                        <span style="background: ${getStatusColor(t.status)}; color: white; padding: 4px 10px; border-radius: 999px; font-size: 0.75rem;">${t.status.toUpperCase()}</span>
                    </td>
                </tr>
            `).join('');

        } catch (error) {
            console.error('Error loading transactions:', error);
        }
    }

    function getStatusColor(status) {
        switch (status) {
            case 'dispensed': return '#10B981';
            case 'paid': return '#3B82F6';
            case 'created': return '#F59E0B';
            case 'failed': return '#EF4444';
            default: return '#9CA3AF';
        }
    }

    // Export to CSV Function
    window.exportTransactions = async () => {
        try {
            const response = await fetch(`${BACKEND_URL}/api/transactions`);
            const data = await response.json();

            if (data.length === 0) {
                Swal.fire('No Data', 'No transactions to export', 'info');
                return;
            }

            const headers = ['Date', 'Time', 'OrderID', 'Amount', 'Grams', 'Status'];
            const rows = data.map(t => [
                new Date(t.createdAt).toLocaleDateString(),
                new Date(t.createdAt).toLocaleTimeString(),
                t.orderId,
                t.amount,
                t.grams,
                t.status
            ]);

            let csvContent = "data:text/csv;charset=utf-8,"
                + headers.join(",") + "\n"
                + rows.map(r => r.join(",")).join("\n");

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `treatmate_report_${new Date().toLocaleDateString()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (e) {
            console.error('Export failed:', e);
        }
    };

    // Initial Load
    loadStats();
    loadTransactions();

    // Auto Refresh every 5 seconds
    setInterval(() => {
        loadStats();
        loadTransactions();
    }, 5000);

    // Device Controls
    if (btnDispense) {
        btnDispense.addEventListener('click', () => {
            sendMqttMessage("MOTOR_ON");
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', () => {
            sendMqttMessage("MOTOR_OFF");
        });
    }


    // Logout Logic
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            Swal.fire({
                title: 'Logging Out',
                text: 'See you soon!',
                icon: 'success',
                timer: 1000,
                showConfirmButton: false
            }).then(() => {
                if (client && isConnected) {
                    try { client.disconnect(); } catch (e) { }
                }
                window.location.href = 'index.html';
            });
        });
    }

    // --- Chart 1: Weekly Sales (Line Chart) ---
    const ctxSales = document.getElementById('salesChart').getContext('2d');
    new Chart(ctxSales, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Sales ($)',
                data: [120, 190, 150, 250, 220, 300, 280],
                borderColor: '#10B981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 3,
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#FFFFFF',
                pointBorderColor: '#10B981',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: '#F3F4F6'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });

    // --- Chart 2: Popular Treats (Doughnut Chart) ---
    const ctxTreats = document.getElementById('treatsChart').getContext('2d');
    new Chart(ctxTreats, {
        type: 'doughnut',
        data: {
            labels: ['Premium Bone', 'Beef Jerky', 'Veggie Biscuit'],
            datasets: [{
                data: [45, 30, 25],
                backgroundColor: [
                    '#10B981', // Green
                    '#F59E0B', // Orange
                    '#3B82F6'  // Blue
                ],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 20
                    }
                }
            },
            cutout: '70%'
        }
    });
});
