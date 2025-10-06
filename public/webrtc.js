class WebRTCManager {
    constructor() {
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.socket = null;
        this.isInitiator = false;
        this.isVideoEnabled = true;
        this.isAudioEnabled = true;
        
        // إعدادات WebRTC
        this.configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };
        
        this.init();
    }

    init() {
        this.setupVideoElements();
    }

    setupVideoElements() {
        this.localVideo = document.getElementById('local-video');
        this.remoteVideo = document.getElementById('remote-video');
    }

    async startCall(isInitiator, socket) {
        this.isInitiator = isInitiator;
        this.socket = socket;
        
        try {
            // الحصول على تدفق الوسائط المحلي
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            // عرض الفيديو المحلي
            this.localVideo.srcObject = this.localStream;
            
            // إنشاء اتصال نظير
            this.createPeerConnection();
            
            // إضافة التدفقات المحلية
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
            
            if (this.isInitiator) {
                // إنشاء عرض
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                
                // إرسال العرض عبر السوكت
                this.socket.emit('webrtc-offer', {
                    sdp: offer
                });
            }
            
        } catch (error) {
            console.error('خطأ في بدء المكالمة:', error);
            this.handleError('لا يمكن الوصول إلى الكاميرا أو الميكروفون');
        }
    }

    createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.configuration);
        
        // استقبال التدفقات البعيدة
        this.peerConnection.ontrack = (event) => {
            console.log('تم استقبال تدفق بعيد');
            this.remoteStream = event.streams[0];
            this.remoteVideo.srcObject = this.remoteStream;
        };
        
        // إرسال ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('webrtc-ice-candidate', {
                    candidate: event.candidate
                });
            }
        };
        
        // مراقبة حالة الاتصال
        this.peerConnection.onconnectionstatechange = () => {
            console.log('حالة الاتصال:', this.peerConnection.connectionState);
            
            if (this.peerConnection.connectionState === 'connected') {
                console.log('تم تأسيس اتصال الفيديو بنجاح');
            } else if (this.peerConnection.connectionState === 'disconnected' || 
                       this.peerConnection.connectionState === 'failed') {
                this.handleConnectionFailure();
            }
        };
    }

    async handleOffer(data) {
        try {
            if (!this.peerConnection) {
                this.createPeerConnection();
            }
            
            await this.peerConnection.setRemoteDescription(data.sdp);
            
            // إنشاء إجابة
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            // إرسال الإجابة
            this.socket.emit('webrtc-answer', {
                sdp: answer
            });
            
        } catch (error) {
            console.error('خطأ في معالجة العرض:', error);
            this.handleError('خطأ في إنشاء اتصال الفيديو');
        }
    }

    async handleAnswer(data) {
        try {
            await this.peerConnection.setRemoteDescription(data.sdp);
        } catch (error) {
            console.error('خطأ في معالجة الإجابة:', error);
            this.handleError('خطأ في إنشاء اتصال الفيديو');
        }
    }

    async handleIceCandidate(data) {
        try {
            if (this.peerConnection && this.peerConnection.remoteDescription) {
                await this.peerConnection.addIceCandidate(data.candidate);
            }
        } catch (error) {
            console.error('خطأ في إضافة ICE candidate:', error);
        }
    }

    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                this.isVideoEnabled = !this.isVideoEnabled;
                videoTrack.enabled = this.isVideoEnabled;
                
                const videoBtn = document.getElementById('toggle-video-btn');
                const icon = videoBtn.querySelector('i');
                
                if (this.isVideoEnabled) {
                    icon.className = 'fas fa-video';
                    videoBtn.classList.remove('btn-danger');
                } else {
                    icon.className = 'fas fa-video-slash';
                    videoBtn.classList.add('btn-danger');
                }
            }
        }
    }

    toggleAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                this.isAudioEnabled = !this.isAudioEnabled;
                audioTrack.enabled = this.isAudioEnabled;
                
                const audioBtn = document.getElementById('toggle-audio-btn');
                const icon = audioBtn.querySelector('i');
                
                if (this.isAudioEnabled) {
                    icon.className = 'fas fa-microphone';
                    audioBtn.classList.remove('btn-danger');
                } else {
                    icon.className = 'fas fa-microphone-slash';
                    audioBtn.classList.add('btn-danger');
                }
            }
        }
    }

    endCall() {
        // إيقاف التدفقات المحلية
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
            });
            this.localStream = null;
        }
        
        // إغلاق اتصال النظير
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // تنظيف عناصر الفيديو
        if (this.localVideo) {
            this.localVideo.srcObject = null;
        }
        
        if (this.remoteVideo) {
            this.remoteVideo.srcObject = null;
        }
        
        // إعادة تعيين الحالة
        this.isVideoEnabled = true;
        this.isAudioEnabled = true;
        this.isInitiator = false;
        this.socket = null;
        
        // إعادة تعيين أزرار التحكم
        this.resetControlButtons();
        
        console.log('تم إنهاء مكالمة الفيديو');
    }

    resetControlButtons() {
        const videoBtn = document.getElementById('toggle-video-btn');
        const audioBtn = document.getElementById('toggle-audio-btn');
        
        if (videoBtn) {
            videoBtn.querySelector('i').className = 'fas fa-video';
            videoBtn.classList.remove('btn-danger');
        }
        
        if (audioBtn) {
            audioBtn.querySelector('i').className = 'fas fa-microphone';
            audioBtn.classList.remove('btn-danger');
        }
    }

    handleConnectionFailure() {
        console.log('فشل في اتصال الفيديو');
        if (window.chatApp) {
            window.chatApp.showSystemMessage('انقطع اتصال الفيديو');
            window.chatApp.endVideoCall();
        }
    }

    handleError(message) {
        console.error('خطأ WebRTC:', message);
        if (window.chatApp) {
            window.chatApp.showSystemMessage(message);
            window.chatApp.endVideoCall();
        }
    }

    // فحص دعم المتصفح
    static checkSupport() {
        const isSupported = !!(navigator.mediaDevices && 
                             navigator.mediaDevices.getUserMedia && 
                             window.RTCPeerConnection);
        
        if (!isSupported) {
            console.warn('المتصفح لا يدعم WebRTC');
        }
        
        return isSupported;
    }

    // طلب الأذونات مسبقاً
    static async requestPermissions() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            // إيقاف التدفق فوراً بعد التأكد من الأذونات
            stream.getTracks().forEach(track => track.stop());
            
            return true;
        } catch (error) {
            console.error('لا يمكن الحصول على أذونات الوسائط:', error);
            return false;
        }
    }
}

// إنشاء instance عام
window.webRTCManager = new WebRTCManager();

// التحقق من دعم المتصفح عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    if (!WebRTCManager.checkSupport()) {
        console.warn('مكالمات الفيديو غير مدعومة في هذا المتصفح');
        
        // إخفاء أزرار الفيديو
        const videoButtons = document.querySelectorAll('#video-call-btn, .video-controls');
        videoButtons.forEach(btn => {
            if (btn) btn.style.display = 'none';
        });
    }
});