class RandomChatApp {
    constructor() {
        this.socket = null;
        this.currentPartner = null;
        this.isConnected = false;
        this.typingTimer = null;
        this.messageSound = document.getElementById('message-sound');
        
        this.init();
    }

    init() {
        this.connectSocket();
        this.bindEvents();
        this.showScreen('welcome-screen');
    }

    connectSocket() {
        this.socket = io();
        
        // حالة الاتصال
        this.socket.on('connect', () => {
            console.log('متصل بالخادم');
            this.isConnected = true;
            this.updateConnectionStatus(true);
        });

        this.socket.on('disconnect', () => {
            console.log('انقطع الاتصال مع الخادم');
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.showSystemMessage('انقطع الاتصال مع الخادم. جار إعادة المحاولة...');
        });

        // أحداث البحث عن شريك
        this.socket.on('waiting-for-partner', () => {
            console.log('في قائمة الانتظار');
            this.showScreen('waiting-screen');
        });

        this.socket.on('partner-found', (data) => {
            console.log('تم العثور على شريك:', data.partnerId);
            this.currentPartner = data.partnerId;
            this.showScreen('chat-screen');
            this.clearMessages();
            this.showSystemMessage('تم العثور على شريك! يمكنك الآن بدء المحادثة');
        });

        this.socket.on('partner-disconnected', () => {
            console.log('الشريك قطع الاتصال');
            this.currentPartner = null;
            this.showSystemMessage('الشريك قطع الاتصال. جار البحث عن شريك جديد...');
            this.hideTypingIndicator();
            
            // العودة للبحث تلقائياً
            setTimeout(() => {
                this.findPartner();
            }, 2000);
        });

        // أحداث الرسائل
        this.socket.on('receive-message', (data) => {
            this.displayMessage(data.message, 'received', data.timestamp);
            this.playMessageSound();
            this.hideTypingIndicator();
        });

        // حالة الكتابة
        this.socket.on('partner-typing-start', () => {
            this.showTypingIndicator();
        });

        this.socket.on('partner-typing-stop', () => {
            this.hideTypingIndicator();
        });

        // أحداث مكالمات الفيديو
        this.socket.on('incoming-video-call', (data) => {
            this.showVideoCallModal();
        });

        this.socket.on('video-call-accepted', () => {
            this.startVideoCall(false); // false = ليس المتصل
        });

        this.socket.on('video-call-rejected', () => {
            this.showSystemMessage('تم رفض مكالمة الفيديو');
        });

        // WebRTC Signaling
        this.socket.on('webrtc-offer', (data) => {
            window.webRTCManager.handleOffer(data);
        });

        this.socket.on('webrtc-answer', (data) => {
            window.webRTCManager.handleAnswer(data);
        });

        this.socket.on('webrtc-ice-candidate', (data) => {
            window.webRTCManager.handleIceCandidate(data);
        });
    }

    bindEvents() {
        // أزرار التنقل الرئيسية
        document.getElementById('start-chat-btn').addEventListener('click', () => {
            this.findPartner();
        });

        document.getElementById('cancel-search-btn').addEventListener('click', () => {
            this.cancelSearch();
        });

        document.getElementById('new-chat-btn').addEventListener('click', () => {
            this.findPartner();
        });

        document.getElementById('end-chat-btn').addEventListener('click', () => {
            this.endChat();
        });

        // إرسال الرسائل
        const messageInput = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');

        sendBtn.addEventListener('click', () => {
            this.sendMessage();
        });

        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // حالة الكتابة
        messageInput.addEventListener('input', () => {
            this.handleTyping();
        });

        messageInput.addEventListener('blur', () => {
            this.stopTyping();
        });

        // مكالمات الفيديو
        document.getElementById('video-call-btn').addEventListener('click', () => {
            this.initiateVideoCall();
        });

        document.getElementById('accept-video-btn').addEventListener('click', () => {
            this.acceptVideoCall();
        });

        document.getElementById('reject-video-btn').addEventListener('click', () => {
            this.rejectVideoCall();
        });

        document.getElementById('end-video-btn').addEventListener('click', () => {
            this.endVideoCall();
        });

        document.getElementById('toggle-video-btn').addEventListener('click', () => {
            window.webRTCManager.toggleVideo();
        });

        document.getElementById('toggle-audio-btn').addEventListener('click', () => {
            window.webRTCManager.toggleAudio();
        });
    }

    showScreen(screenId) {
        // إخفاء جميع الشاشات
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        // إظهار الشاشة المطلوبة
        document.getElementById(screenId).classList.add('active');
    }

    findPartner() {
        if (!this.isConnected) {
            this.showSystemMessage('لا يوجد اتصال بالخادم');
            return;
        }
        
        console.log('البحث عن شريك...');
        this.socket.emit('find-partner');
    }

    cancelSearch() {
        this.showScreen('welcome-screen');
    }

    endChat() {
        if (this.currentPartner) {
            this.socket.emit('end-chat');
            this.currentPartner = null;
        }
        this.endVideoCall();
        this.showScreen('welcome-screen');
    }

    sendMessage() {
        const messageInput = document.getElementById('message-input');
        const message = messageInput.value.trim();
        
        if (!message || !this.currentPartner) return;
        
        this.socket.emit('send-message', { message });
        this.displayMessage(message, 'sent');
        messageInput.value = '';
        this.stopTyping();
    }

    displayMessage(message, type, timestamp = new Date()) {
        const messagesArea = document.getElementById('messages-area');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type} new`;
        
        const timeString = new Date(timestamp).toLocaleTimeString('ar-SA', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        messageDiv.innerHTML = `
            <div class="message-content">${this.escapeHtml(message)}</div>
            <div class="message-time">${timeString}</div>
        `;
        
        messagesArea.appendChild(messageDiv);
        messagesArea.scrollTop = messagesArea.scrollHeight;
        
        // إزالة كلاس التمييز بعد فترة
        setTimeout(() => {
            messageDiv.classList.remove('new');
        }, 2000);
    }

    showSystemMessage(message) {
        const messagesArea = document.getElementById('messages-area');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'system-message';
        messageDiv.innerHTML = `<i class="fas fa-info-circle"></i> ${message}`;
        messagesArea.appendChild(messageDiv);
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    clearMessages() {
        const messagesArea = document.getElementById('messages-area');
        messagesArea.innerHTML = '';
    }

    handleTyping() {
        if (!this.currentPartner) return;
        
        // إرسال إشارة البدء في الكتابة
        this.socket.emit('typing-start');
        
        // إلغاء المؤقت السابق
        clearTimeout(this.typingTimer);
        
        // إعداد مؤقت جديد لإيقاف الكتابة
        this.typingTimer = setTimeout(() => {
            this.stopTyping();
        }, 1000);
    }

    stopTyping() {
        if (this.currentPartner) {
            this.socket.emit('typing-stop');
        }
        clearTimeout(this.typingTimer);
    }

    showTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.add('active');
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        indicator.classList.remove('active');
    }

    // مكالمات الفيديو
    initiateVideoCall() {
        if (!this.currentPartner) {
            this.showSystemMessage('لا يوجد شريك متصل');
            return;
        }
        
        this.socket.emit('start-video-call');
        this.showSystemMessage('جار إرسال دعوة مكالمة فيديو...');
    }

    showVideoCallModal() {
        document.getElementById('video-call-modal').classList.remove('hidden');
    }

    hideVideoCallModal() {
        document.getElementById('video-call-modal').classList.add('hidden');
    }

    acceptVideoCall() {
        this.hideVideoCallModal();
        this.socket.emit('accept-video-call');
        this.startVideoCall(true); // true = المتلقي
    }

    rejectVideoCall() {
        this.hideVideoCallModal();
        this.socket.emit('reject-video-call');
    }

    startVideoCall(isReceiver) {
        const videoArea = document.getElementById('video-area');
        videoArea.classList.remove('hidden');
        
        // بدء WebRTC
        window.webRTCManager.startCall(isReceiver, this.socket);
        
        this.showSystemMessage('بدأت مكالمة الفيديو');
    }

    endVideoCall() {
        const videoArea = document.getElementById('video-area');
        videoArea.classList.add('hidden');
        
        // إنهاء WebRTC
        if (window.webRTCManager) {
            window.webRTCManager.endCall();
        }
    }

    playMessageSound() {
        if (this.messageSound) {
            this.messageSound.currentTime = 0;
            this.messageSound.play().catch(e => {
                console.log('لا يمكن تشغيل الصوت:', e);
            });
        }
    }

    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connection-status');
        const statusText = statusElement.querySelector('span');
        const statusIcon = statusElement.querySelector('i');
        
        if (connected) {
            statusElement.classList.remove('disconnected');
            statusText.textContent = 'متصل';
            statusIcon.className = 'fas fa-wifi';
        } else {
            statusElement.classList.add('disconnected');
            statusText.textContent = 'غير متصل';
            statusIcon.className = 'fas fa-wifi-slash';
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// تهيئة التطبيق عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new RandomChatApp();
});

// التعامل مع إغلاق الصفحة
window.addEventListener('beforeunload', () => {
    if (window.chatApp && window.chatApp.socket) {
        window.chatApp.socket.disconnect();
    }
});