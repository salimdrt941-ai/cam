const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  // إعدادات تحسين الاتصال
  pingTimeout: 60000, // 60 ثانية قبل timeout
  pingInterval: 25000, // فحص الاتصال كل 25 ثانية
  upgradeTimeout: 30000, // 30 ثانية لترقية الاتصال
  allowEIO3: true, // دعم الإصدارات القديمة
  transports: ['polling', 'websocket'], // تفعيل جميع وسائل النقل
  allowUpgrades: true,
  cookie: false
});

// خدمة الملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));

// قائمة المستخدمين المتاحين للربط
let waitingUsers = [];
let activeChats = new Map();
let connectedUsers = new Map();

// وظائف مساعدة
function findRandomPartner(currentUserId) {
  const availableUsers = waitingUsers.filter(userId => userId !== currentUserId);
  if (availableUsers.length === 0) return null;
  
  const randomIndex = Math.floor(Math.random() * availableUsers.length);
  return availableUsers[randomIndex];
}

function removeFromWaiting(userId) {
  waitingUsers = waitingUsers.filter(id => id !== userId);
}

function addToWaiting(userId) {
  if (!waitingUsers.includes(userId)) {
    waitingUsers.push(userId);
  }
}

function endActiveChat(userId) {
  if (activeChats.has(userId)) {
    const partnerId = activeChats.get(userId);
    activeChats.delete(userId);
    activeChats.delete(partnerId);
    return partnerId;
  }
  return null;
}

io.on('connection', (socket) => {
  console.log(`مستخدم جديد متصل: ${socket.id}`);
  
  // تسجيل المستخدم الجديد
  connectedUsers.set(socket.id, {
    id: socket.id,
    joinTime: new Date()
  });

  // البحث عن شريك عشوائي
  socket.on('find-partner', () => {
    console.log(`${socket.id} يبحث عن شريك`);
    
    // إنهاء أي دردشة نشطة أولاً
    const currentPartner = endActiveChat(socket.id);
    if (currentPartner) {
      io.to(currentPartner).emit('partner-disconnected');
      addToWaiting(currentPartner);
    }
    
    // البحث عن شريك جديد
    const partner = findRandomPartner(socket.id);
    
    if (partner) {
      // تم العثور على شريك
      removeFromWaiting(partner);
      removeFromWaiting(socket.id);
      
      // إنشاء غرفة دردشة جديدة
      const roomId = uuidv4();
      
      // ربط الشريكين
      activeChats.set(socket.id, partner);
      activeChats.set(partner, socket.id);
      
      // إضافة كلا المستخدمين إلى نفس الغرفة
      socket.join(roomId);
      io.sockets.sockets.get(partner)?.join(roomId);
      
      // إشعار كلا الطرفين
      socket.emit('partner-found', { partnerId: partner, roomId });
      io.to(partner).emit('partner-found', { partnerId: socket.id, roomId });
      
      console.log(`تم ربط ${socket.id} مع ${partner} في الغرفة ${roomId}`);
    } else {
      // لم يتم العثور على شريك، إضافة إلى قائمة الانتظار
      addToWaiting(socket.id);
      socket.emit('waiting-for-partner');
      console.log(`${socket.id} في قائمة الانتظار`);
    }
  });

  // إرسال رسالة نصية
  socket.on('send-message', (data) => {
    const partner = activeChats.get(socket.id);
    if (partner) {
      io.to(partner).emit('receive-message', {
        message: data.message,
        timestamp: new Date(),
        senderId: socket.id
      });
      console.log(`رسالة من ${socket.id} إلى ${partner}: ${data.message}`);
    }
  });

  // بدء مكالمة فيديو
  socket.on('start-video-call', () => {
    const partner = activeChats.get(socket.id);
    if (partner) {
      io.to(partner).emit('incoming-video-call', { callerId: socket.id });
    }
  });

  // قبول مكالمة فيديو
  socket.on('accept-video-call', (data) => {
    const partner = activeChats.get(socket.id);
    if (partner) {
      io.to(partner).emit('video-call-accepted', { accepterId: socket.id });
    }
  });

  // رفض مكالمة فيديو
  socket.on('reject-video-call', () => {
    const partner = activeChats.get(socket.id);
    if (partner) {
      io.to(partner).emit('video-call-rejected');
    }
  });

  // WebRTC Signaling
  socket.on('webrtc-offer', (data) => {
    const partner = activeChats.get(socket.id);
    if (partner) {
      io.to(partner).emit('webrtc-offer', data);
    }
  });

  socket.on('webrtc-answer', (data) => {
    const partner = activeChats.get(socket.id);
    if (partner) {
      io.to(partner).emit('webrtc-answer', data);
    }
  });

  socket.on('webrtc-ice-candidate', (data) => {
    const partner = activeChats.get(socket.id);
    if (partner) {
      io.to(partner).emit('webrtc-ice-candidate', data);
    }
  });

  // إنهاء الدردشة
  socket.on('end-chat', () => {
    const partner = endActiveChat(socket.id);
    if (partner) {
      io.to(partner).emit('partner-disconnected');
      addToWaiting(partner);
    }
    removeFromWaiting(socket.id);
    console.log(`${socket.id} أنهى الدردشة`);
  });

  // قطع الاتصال
  socket.on('disconnect', (reason) => {
    console.log(`المستخدم ${socket.id} قطع الاتصال - السبب: ${reason}`);
    
    // إنهاء أي دردشة نشطة
    const partner = endActiveChat(socket.id);
    if (partner) {
      io.to(partner).emit('partner-disconnected');
      addToWaiting(partner);
    }
    
    // إزالة من قائمة الانتظار
    removeFromWaiting(socket.id);
    
    // إزالة من المستخدمين المتصلين
    connectedUsers.delete(socket.id);
  });

  // معالجة أخطاء الاتصال
  socket.on('error', (error) => {
    console.log(`خطأ في الاتصال للمستخدم ${socket.id}:`, error);
  });

  // معالجة إعادة الاتصال
  socket.on('reconnect', () => {
    console.log(`المستخدم ${socket.id} أعاد الاتصال`);
    socket.emit('reconnected');
  });

  // معالجة heartbeat
  socket.on('ping', () => {
    socket.emit('pong');
  });

  // إرسال إشارة "يكتب"
  socket.on('typing-start', () => {
    const partner = activeChats.get(socket.id);
    if (partner) {
      io.to(partner).emit('partner-typing-start');
    }
  });

  socket.on('typing-stop', () => {
    const partner = activeChats.get(socket.id);
    if (partner) {
      io.to(partner).emit('partner-typing-stop');
    }
  });
});

// إحصائيات المنصة
setInterval(() => {
  console.log(`\n=== إحصائيات المنصة ===`);
  console.log(`المستخدمين المتصلين: ${connectedUsers.size}`);
  console.log(`في قائمة الانتظار: ${waitingUsers.length}`);
  console.log(`الدردشات النشطة: ${activeChats.size / 2}`);
  console.log(`========================\n`);
}, 30000); // كل 30 ثانية

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 خادم الدردشة العشوائية يعمل على المنفذ ${PORT}`);
  console.log(`🌐 قم بزيارة: http://localhost:${PORT}`);
});