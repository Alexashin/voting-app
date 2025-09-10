const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
// const QRCode = require('qrcode'); // не используется на сервере
const { networkInterfaces } = require('os');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = socketIo(server);
const adminSockets = new Set();

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "071117";
const BOOT_ID = Date.now();

// === Multer (upload) ===
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'image-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'), false);
  }
});

// === Local IP for link ===
function getLocalIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}
const LOCAL_IP = getLocalIp();
const VOTING_URL = `http://${LOCAL_IP}:${PORT}`;

console.log(`📍 Локальный адрес процесса:\thttp://localhost:${PORT}`);
console.log(`📍 Внешний адрес процесса:\t${VOTING_URL}`);
// паролей в логи не печатаем

// === Static & JSON ===
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));

// Upload endpoint
app.post('/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

// Errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File too large' });
  }
  res.status(500).json({ error: error.message });
});

function getPublicBaseUrl(req) {
  // Cloudflare может присылать cf-visitor: {"scheme":"https"}
  // но достаточно X-Forwarded-Proto/Host
  const xfProto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim();
  // const proto = xfProto || req.protocol || 'http';
  const proto = 'https';

  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString().split(',')[0].trim();
  if (!host) {
    // fallback на локалку (на всякий случай)
    return `http://localhost:${process.env.PORT || 3000}`;
  }
  return `${proto}://${host}`;
}


// === In-memory store ===
let votingData = {
  options: [
    { id: 1, text: "Вариант 1", image: "/img/opt1.svg" },
    { id: 2, text: "Вариант 2", image: "/img/opt2.svg" },
    { id: 3, text: "Вариант 3", image: "/img/opt3.svg" },
    { id: 4, text: "Вариант 4", image: "/img/opt4.svg" }
  ],
  votes: {},
  voters: {},
  history: [],
  users: {}
};

// init votes
votingData.options.forEach(option => {
  votingData.votes[option.id] = { count: 0, voters: [] };
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'voting.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'voting.html'));
});

// calc results
function calculateResults() {
  const totalVotes = Object.values(votingData.votes).reduce((sum, o) => sum + o.count, 0);
  const results = {};
  votingData.options.forEach(option => {
    const voteData = votingData.votes[option.id] || { count: 0, voters: [] };
    const percentage = totalVotes > 0 ? ((voteData.count / totalVotes) * 100).toFixed(1) : 0;
    results[option.id] = { count: voteData.count, percentage, voters: voteData.voters };
  });
  return { results, totalVotes };
}

// === Socket.IO ===
io.on('connection', (socket) => {
  console.log('Новое подключение:', socket.id);

  // admin login
  socket.on('adminLogin', (password) => {
    if (password === ADMIN_PASSWORD) {
      adminSockets.add(socket.id);
      socket.emit('adminLoginResult', { ok: true });
    } else {
      socket.emit('adminLoginResult', { ok: false, error: 'Неверный пароль' });
    }
  });
  const publicUrl = getPublicBaseUrl(socket.request);
  // init payload
  socket.emit('init', {
    options: votingData.options,
    results: calculateResults(),
    votingUrl: publicUrl,
    bootId: BOOT_ID
  });

  // vote
  socket.on('vote', ({ optionId, userId }) => {
    const user = votingData.users[userId];
    if (!user) return socket.emit('voteError', 'Пользователь не найден!');
    if (votingData.voters[userId]) return socket.emit('voteError', 'Вы уже проголосовали!');

    const voteEntry = votingData.votes[optionId];
    if (!voteEntry) return socket.emit('voteError', 'Такого варианта нет');

    voteEntry.count++;
    voteEntry.voters.push({
      userId,
      name: `${user.name} ${user.surname}`,
      timestamp: new Date().toISOString()
    });
    votingData.voters[userId] = { optionId, timestamp: new Date().toISOString() };

    io.emit('updateResults', calculateResults());
    socket.emit('voteSuccess', 'Спасибо за ваш голос!');
  });

  // new voting
  socket.on('newVoting', () => {
    if (!adminSockets.has(socket.id)) return socket.emit('voteError', 'Нет прав');

    const totalVotes = Object.values(votingData.votes).reduce((s, o) => s + o.count, 0);
    if (totalVotes > 0) {
      votingData.history.push({
        id: Date.now(),
        date: new Date().toISOString(),
        totalVotes,
        results: JSON.parse(JSON.stringify(votingData.votes)),
        options: JSON.parse(JSON.stringify(votingData.options))
      });
    }

    votingData.options.forEach(option => {
      votingData.votes[option.id] = { count: 0, voters: [] };
    });
    votingData.voters = {};

    io.emit('updateResults', calculateResults());
    io.emit('newVotingStarted');
  });

  // update options
  socket.on('updateOptions', (newOptions) => {
    if (!adminSockets.has(socket.id)) return socket.emit('voteError', 'Нет прав');

    votingData.options = newOptions;

    newOptions.forEach(option => {
      if (!votingData.votes[option.id]) votingData.votes[option.id] = { count: 0, voters: [] };
    });

    Object.keys(votingData.votes).forEach(optionId => {
      if (!newOptions.find(option => option.id == optionId)) delete votingData.votes[optionId];
    });

    io.emit('optionsUpdated', votingData.options);
    io.emit('updateResults', calculateResults());
  });

  // edit card
  socket.on('editCard', ({ cardId, title, image }) => {
    if (!adminSockets.has(socket.id)) return socket.emit('voteError', 'Нет прав');
    const idx = votingData.options.findIndex(o => o.id == cardId);
    if (idx === -1) return socket.emit('cardEdited', { success: false, message: 'Карточка не найдена!' });

    votingData.options[idx].text = title;
    votingData.options[idx].image = image;

    io.emit('optionsUpdated', votingData.options);
    socket.emit('cardEdited', { success: true, message: 'Карточка успешно обновлена!' });
  });

  // users
  socket.on('saveUser', (userData) => {
    const userId = `user_${Date.now()}`;
    votingData.users[userId] = userData;
    socket.emit('userSaved', { success: true, userId, user: userData });
  });

  socket.on('findUser', ({ name, surname }) => {
    const user = Object.values(votingData.users).find(u => u.name === name && u.surname === surname);
    if (user) {
      const userId = Object.keys(votingData.users).find(key => votingData.users[key] === user);
      socket.emit('userFound', { success: true, userId, user });
    } else {
      socket.emit('userFound', { success: false, message: 'Пользователь не найден' });
    }
  });

  // history & users dump
  socket.on('getHistory', () => socket.emit('historyData', votingData.history));
  socket.on('getUsers', () => socket.emit('usersData', votingData.users));


  socket.on('disconnect', () => {
    adminSockets.delete(socket.id);
    console.log('Клиент отключился:', socket.id);
  });
});

// start
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Процесс запущен на порту ${PORT}`);
  console.log('📱 Для подключения с телефона используйте доменное имя');
});
