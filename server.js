const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
// 自动读取云平台PORT，腾讯云会分配80；本地运行 fallback 3000
const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server);

// 托管静态网页，public文件夹下index.html
app.use(express.static('public'));

// 房间消息存储
const rooms = {};

io.on('connection', (socket) => {
    console.log('有用户连接：', socket.id);

    // 加入房间
    socket.on('joinRoom', (roomId) => {
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = [];
        }
        socket.emit('history', rooms[roomId]);
    });

    // 收到消息，广播给同房间所有人
    socket.on('chatMsg', (data) => {
        const roomId = data.room;
        const msg = {
            name: data.name,
            text: data.text,
            time: new Date().toLocaleString()
        };
        if (!rooms[roomId]) rooms[roomId] = [];
        rooms[roomId].push(msg);
        // 只保留最近50条消息，防止内存越积越大
        if (rooms[roomId].length > 50) {
            rooms[roomId].shift();
        }
        io.to(roomId).emit('newMsg', msg);
    });

    socket.on('disconnect', () => {
        console.log('用户离开：', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`监听端口 ${PORT}`);
});
