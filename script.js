document.addEventListener('DOMContentLoaded', () => {
    // --- MQTT Configuration ---
    const mqttHost = "d81c3cd5abb4432bb5b7729e27766fa9.s1.eu.hivemq.cloud";
    const mqttPort = 8884; // WebSocket Secure
    const mqttTopic = "esp32/control";
    const clientId = "client-" + Math.random().toString(16).substr(2, 8); // Random Client ID

    // Credentials from INO file
    const mqttUser = "ESP32_MQTT_test";
    const mqttPass = "ESP@mqtt123";

    let client = null;
    let isConnected = false;
    let deviceHeartbeatTimer = null;

    // Backend API URL (auto-detect based on current domain)
    const BACKEND_URL = window.location.hostname === 'localhost' 
      ? 'http://localhost:3000'
      : 'https://mqtt-backend-blond.vercel.app'; // Your deployed Vercel URL
    let currentOrderId = null;
    let paymentPollInterval = null;

    // Initialize MQTT
    function initMQTT() {
        console.log("Initializing MQTT...");
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
        console.log("MQTT Connected!");
        isConnected = true;

        // Subscribe to dispense confirmation and status
        client.subscribe("esp32/dispense/confirm");
        client.subscribe("esp32/status");
        console.log("Subscribed to esp32 Topics");
        
        // Show device as online immediately when MQTT connects
        updateDeviceStatus(true);
    }

    function onFailure(message) {
        console.error("MQTT Connection Failed: " + message.errorMessage);
        // Retry logic could go here
    }

    function onConnectionLost(responseObject) {
        if (responseObject.errorCode !== 0) {
            console.log("MQTT Connection Lost: " + responseObject.errorMessage);
            isConnected = false;
        }
    }

    function onMessageArrived(message) {
        console.log("📥 MQTT Message Arrived on topic:", message.destinationName);
        console.log("📦 Payload:", message.payloadString);

        // Handle dispense confirmation from ESP32
        if (message.destinationName === "esp32/dispense/confirm") {
            console.log("✅ Dispense confirmation received!");
            
            // Close any open modals first
            const modal = document.getElementById('paymentModal');
            if (modal) {
                modal.classList.remove('show');
            }
            
            // Show success popup
            Swal.fire({
                title: '✅ Dispensed Successfully!',
                text: `Actual weight: ${message.payloadString}`,
                icon: 'success',
                timer: 5000,
                showConfirmButton: true,
                confirmButtonText: 'Great!',
                confirmButtonColor: '#10B981'
            });
        }

        // Handle Heartbeat (PING)
        if (message.destinationName === "esp32/status" && message.payloadString === "PING") {
            updateDeviceStatus(true);
        }
    }

    function updateDeviceStatus(online) {
        const dot = document.getElementById('status-dot');
        const text = document.getElementById('status-text');

        if (online) {
            if (dot) dot.style.background = '#10B981'; // Green
            if (text) text.textContent = 'Machine Online';

            // Reset timeout
            if (deviceHeartbeatTimer) clearTimeout(deviceHeartbeatTimer);
            deviceHeartbeatTimer = setTimeout(() => updateDeviceStatus(false), 12000); // 12s timeout
        } else {
            if (dot) dot.style.background = '#EF4444'; // Red
            if (text) text.textContent = 'Machine Offline';
        }
    }

    function sendMqttMessage(msg) {
        if (client && isConnected) {
            const message = new Paho.MQTT.Message(msg);
            message.destinationName = mqttTopic;
            client.send(message);
            console.log(`Sent MQTT Message: ${msg} to ${mqttTopic}`);
        } else {
            console.warn("Cannot send message: MQTT not connected");
            Swal.fire("Connection Error", "MQTT Not Connected. Try refreshing.", "error");
        }
    }

    // Start Connection
    initMQTT();

    /* ===== PAYMENT NOTIFICATION SYSTEM ===== */
    // Toast notification function
    function showToast(message, type = 'info') {
      const toast = document.createElement('div');
      toast.className = `payment-toast toast-${type}`;
      toast.innerHTML = message;
      toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#3B82F6'};
        color: white;
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 9999;
        font-weight: 600;
        font-size: 14px;
        max-width: 400px;
        word-wrap: break-word;
        animation: slideIn 0.3s ease-out;
      `;
      document.body.appendChild(toast);
      
      // Add animation
      const style = document.createElement('style');
      if (!document.querySelector('style[data-toast-animation]')) {
        style.setAttribute('data-toast-animation', 'true');
        style.textContent = `
          @keyframes slideIn {
            from {
              transform: translateX(400px);
              opacity: 0;
            }
            to {
              transform: translateX(0);
              opacity: 1;
            }
          }
          @keyframes slideOut {
            from {
              transform: translateX(0);
              opacity: 1;
            }
            to {
              transform: translateX(400px);
              opacity: 0;
            }
          }
          .payment-toast.removing {
            animation: slideOut 0.3s ease-out forwards;
          }
        `;
        document.head.appendChild(style);
      }
      
      // Auto remove after 5 seconds
      setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
      }, 5000);
    }

    // Connect to payment notifications via SSE
    function connectToPaymentEvents() {
      try {
        const eventSource = new EventSource(`${BACKEND_URL}/events`);
        
        eventSource.onmessage = (event) => {
          try {
            const payment = JSON.parse(event.data);
            console.log('💳 Payment Notification Received:', payment);
            
            // Show success notification
            showToast(
              `💳 Payment of ₹${payment.amount} received!<br>⚙️ Machine dispensing ${payment.amount}g...`,
              'success'
            );

            // Update dashboard if admin is watching
            if (window.location.pathname.includes('admin')) {
              updateAdminDashboard(payment);
            }
          } catch (e) {
            console.error('Error parsing payment data:', e);
          }
        };
        
        eventSource.onerror = (error) => {
          console.warn('SSE Connection Lost, reconnecting...');
          eventSource.close();
          // Retry after 5 seconds
          setTimeout(connectToPaymentEvents, 5000);
        };

        console.log('✅ Connected to payment notifications');
      } catch (e) {
        console.error('Failed to connect to payment events:', e);
      }
    }

    // Call on page load
    connectToPaymentEvents();

    // Helper function to update admin dashboard
    function updateAdminDashboard(payment) {
      const paymentsList = document.getElementById('payments-list');
      if (paymentsList) {
        const entry = document.createElement('div');
        entry.className = 'payment-entry';
        entry.innerHTML = `
          <div style="display: flex; justify-content: space-between; padding: 12px; background: #F0FDF4; border-left: 4px solid #10B981; margin: 8px 0; border-radius: 4px;">
            <div>
              <p style="margin: 0; font-weight: 600; color: #10B981;">₹${payment.amount}</p>
              <p style="margin: 5px 0 0 0; font-size: 0.85rem; color: #666;">${new Date().toLocaleTimeString()}</p>
            </div>
            <div style="text-align: right;">
              <p style="margin: 0; font-size: 0.9rem; color: #10B981;">✅ ${payment.status}</p>
            </div>
          </div>
        `;
        paymentsList.insertBefore(entry, paymentsList.firstChild);
      }
    }

    // --- Real Razorpay Payment Functions ---

    async function createRazorpayOrder(amount) {
        try {
            const response = await fetch(`${BACKEND_URL}/api/create-order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount: Number(amount) })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Server error');
            }

            return await response.json();
        } catch (error) {
            console.error('Order Error:', error);
            Swal.fire('Payment Initialization Failed', error.message, 'error');
            return null;
        }
    }

    function openRazorpayCheckout(orderData) {
        const options = {
            "key": orderData.keyId,
            "amount": orderData.amount * 100, // paise
            "currency": "INR",
            "name": "TREATMATE",
            "description": `Dispense ${orderData.amount}g Treat`,
            "order_id": orderData.orderId,
            "handler": function (response) {
                console.log("Razorpay Success:", response);
                // After successful payment, the modal will stay open and polling will detect the status
                // The backend webhook will trigger the dispense.
                const statusText = document.getElementById('payment-status-text');
                if (statusText) statusText.textContent = '✅ Payment Successful! Machine is Dispensing...';
            },
            "modal": {
                "ondismiss": function () {
                    console.log("Checkout closed by user");
                    // We don't close the modal yet, let the poll check if pay was actually successful
                }
            },
            "prefill": {
                "name": "User",
                "email": "user@example.com",
                "contact": "9999999999"
            },
            "theme": { "color": "#3B82F6" }
        };

        const rzp = new Razorpay(options);
        rzp.open();
    }

    async function checkPaymentStatus(orderId) {
        try {
            const response = await fetch(`${BACKEND_URL}/api/payment-status/${orderId}`);
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Payment Status Error:', error);
            return null;
        }
    }

    function startPaymentPolling(orderId) {
        // Clear any existing polling
        if (paymentPollInterval) {
            clearInterval(paymentPollInterval);
        }

        const qrStatus = document.getElementById('qr-status');
        qrStatus.textContent = '⏳ Waiting for payment...';
        qrStatus.style.color = '#10B981';

        paymentPollInterval = setInterval(async () => {
            const status = await checkPaymentStatus(orderId);

            if (status && status.status === 'paid') {
                // Payment successful!
                clearInterval(paymentPollInterval);
                qrStatus.textContent = '✅ Payment received! Dispensing...';
                qrStatus.style.color = '#10B981';

                // Close modal after a moment
                setTimeout(() => {
                    closeModal();
                    Swal.fire({
                        title: 'Payment Successful!',
                        text: `Dispensing ${status.grams}g...`,
                        icon: 'success',
                        timer: 4000,
                        showConfirmButton: false
                    });
                }, 1500);
            }
        }, 2000); // Poll every 2 seconds
    }

    async function simulatePayment(orderId) {
        try {
            const response = await fetch(`${BACKEND_URL}/api/simulate-payment/${orderId}`, {
                method: 'POST'
            });

            const data = await response.json();

            if (data.success) {
                console.log('Payment simulated successfully');
                // The polling will detect the status change
            }
        } catch (error) {
            console.error('Simulate Payment Error:', error);
            Swal.fire('Error', 'Failed to simulate payment', 'error');
        }
    }


    // --- UI Logic ---
    const mobileToggle = document.querySelector('.mobile-toggle');
    const navLinks = document.querySelector('.nav-links');
    const paymentModal = document.getElementById('paymentModal');
    const btnSimulatePay = document.getElementById('btn-simulate-pay');
    const btnCancelPay = document.getElementById('btn-cancel-pay');
    const btnGetStarted = document.getElementById('btn-get-started');

    if (btnGetStarted) {
        btnGetStarted.addEventListener('click', () => {
            paymentModal.classList.add('show');
            // Reset selection and UI
            selectedAmount = null;
            document.querySelectorAll('.amount-btn').forEach(b => b.classList.remove('selected'));
            btnSimulatePay.style.display = 'none';
            document.getElementById('qrCodeContainer').style.display = 'none';
        });
    }

    // Mobile Menu
    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            mobileToggle.textContent = navLinks.classList.contains('active') ? '✕' : '☰';
        });
    }

    // Modal Functions
    const closeModal = () => paymentModal.classList.remove('show');

    if (btnCancelPay) btnCancelPay.addEventListener('click', closeModal);

    // Amount Selection (Professional Razorpay Flow)
    let selectedAmount = null;
    const amountButtons = document.querySelectorAll('.amount-btn');
    amountButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            // Remove previous selection
            amountButtons.forEach(b => b.classList.remove('selected'));

            // Mark as selected
            btn.classList.add('selected');
            selectedAmount = parseInt(btn.dataset.amount);

            // Update Loading UI
            const statusContainer = document.getElementById('payment-status-container');
            const statusText = document.getElementById('payment-status-text');
            if (statusContainer) statusContainer.style.display = 'block';

            // 1. Create order in Backend
            const orderData = await createRazorpayOrder(selectedAmount);

            if (orderData) {
                currentOrderId = orderData.orderId;

                // 2. Open Razorpay Popup
                openRazorpayCheckout(orderData);

                // 3. Start polling for payment success (from backend database)
                startPaymentPolling(orderData.orderId);

                if (statusText) statusText.textContent = '⏳ Waiting for payment confirmation...';
            } else {
                if (statusContainer) statusContainer.style.display = 'none';
            }
        });
    });

    // Verify Payment & Trigger Dispense
    if (btnSimulatePay) {
        btnSimulatePay.addEventListener('click', async () => {
            if (!selectedAmount) {
                Swal.fire('Select Amount', 'Please select an amount first', 'warning');
                return;
            }

            // REMOVED: Frontend no longer triggers MQTT directly
            // Backend webhook will handle the MQTT trigger automatically
            // This prevents double dispensing
            
            // 1. Trigger Dispense via Frontend MQTT (DISABLED to prevent double dispense)
            // sendMqttMessage(`DISPENSE:${selectedAmount}`);

            // 2. Log to Backend (For Stats and Dashboard)
            // Even though we aren't polling, we tell the backend this "simulated" payment happened
            if (currentOrderId && currentOrderId.startsWith('LOCAL_')) {
                // We show a loading state for the data sync
                Swal.fire({
                    title: 'Verifying Receipt...',
                    text: 'Syncing with dashboard...',
                    allowOutsideClick: false,
                    didOpen: () => Swal.showLoading()
                });

                try {
                    // We can reuse simulate-payment just to log it in the backend
                    await fetch(`${BACKEND_URL}/api/simulate-payment/${currentOrderId}`, { method: 'POST' });
                } catch (e) {
                    console.error('Data sync failed:', e);
                }
            }

            // 3. UI Success
            closeModal();
            Swal.fire({
                title: 'Payment Verified!',
                text: `Dispensing ${selectedAmount}g... Check common dashboard for updates.`,
                icon: 'success',
                timer: 4000,
                showConfirmButton: false
            });
        });
    }

    // Clean up on modal close
    if (btnCancelPay) {
        btnCancelPay.addEventListener('click', () => {
            if (paymentPollInterval) {
                clearInterval(paymentPollInterval);
            }
            closeModal();
        });
    }

    // Admin Login Logic
    const adminBtn = document.getElementById('admin-login-btn');
    if (adminBtn) {
        adminBtn.addEventListener('click', async () => {
            if (typeof Swal !== 'undefined') {
                const { value: formValues } = await Swal.fire({
                    title: 'Admin Login',
                    html:
                        '<input id="swal-input1" class="swal2-input" placeholder="Username">' +
                        '<input id="swal-input2" class="swal2-input" placeholder="Password" type="password">',
                    focusConfirm: false,
                    showCancelButton: true,
                    confirmButtonText: 'Login',
                    confirmButtonColor: '#10B981',
                    preConfirm: () => {
                        return [
                            document.getElementById('swal-input1').value,
                            document.getElementById('swal-input2').value
                        ]
                    }
                });

                if (formValues) {
                    const [username, password] = formValues;
                    if (username === 'admin' && password === 'admin123') {
                        Swal.fire({
                            title: 'Welcome Back!',
                            text: 'Accessing Admin Dashboard...',
                            icon: 'success',
                            timer: 1500,
                            showConfirmButton: false
                        }).then(() => {
                            window.location.href = 'admin-dashboard.html';
                        });
                    } else {
                        Swal.fire('Access Denied', 'Invalid credentials', 'error');
                    }
                }
            }
        });
    }
});
