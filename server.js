// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Simple profanity filter for young audience
const badWords = ['fuck', 'shit', 'damn', 'cunt', 'bitch', 'asshole', 'nigga', 'dick', 'porn', 'sex'];
function filterMessage(text) {
    let filtered = text;
    badWords.forEach(word => {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        filtered = filtered.replace(regex, '***');
    });
    return filtered;
}

// Data structures for managing chat pairs and waiting queue
let waitingSockets = new Set(); // Store socket IDs of users waiting for a partner
let partners = new Map(); // socketId -> partnerSocketId
let rooms = new Map(); // socketId -> roomId

// Helper: Remove user from waiting queue if present
function removeFromWaiting(socketId) {
    if (waitingSockets.has(socketId)) {
        waitingSockets.delete(socketId);
    }
}

// Helper: Clean up user's pairing data
function cleanupUser(socketId) {
    const partnerId = partners.get(socketId);
    const roomId = rooms.get(socketId);

    // If user is in a room, notify partner and leave room
    if (partnerId && roomId) {
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
            partnerSocket.emit('partner-left', { message: 'Your partner has disconnected. Click "Start Chat" to find a new partner.' });
            // Clean up partner's data too
            partners.delete(partnerId);
            rooms.delete(partnerId);
            partnerSocket.leave(roomId);
        }
        io.sockets.sockets.get(socketId)?.leave(roomId);
    }

    // Remove from all mappings
    partners.delete(socketId);
    rooms.delete(socketId);
    removeFromWaiting(socketId);
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // User requests to find a chat partner
    socket.on('find', () => {
        // If already in a chat, leave it first
        if (partners.has(socket.id)) {
            socket.emit('error', { message: 'You are already in a chat. Please stop current chat first.' });
            return;
        }

        // If already waiting, do nothing
        if (waitingSockets.has(socket.id)) {
            socket.emit('status', { message: 'Already searching for a partner...' });
            return;
        }

        // Add to waiting queue
        waitingSockets.add(socket.id);
        socket.emit('status', { message: 'Searching for a random partner...' });

        // Check if there is another waiting user to pair with
        if (waitingSockets.size >= 2) {
            // Get two waiting sockets (pair the current one with the oldest waiting)
            const waitingArray = Array.from(waitingSockets);
            // To avoid pairing with self, ensure we get another socket
            let partnerId = null;
            for (let id of waitingArray) {
                if (id !== socket.id) {
                    partnerId = id;
                    break;
                }
            }

            if (partnerId) {
                const partnerSocket = io.sockets.sockets.get(partnerId);
                if (partnerSocket) {
                    // Remove both from waiting queue
                    waitingSockets.delete(socket.id);
                    waitingSockets.delete(partnerId);

                    // Create a unique room ID
                    const roomId = `room_${socket.id}_${partnerId}`;
                    
                    // Join both sockets to the room
                    socket.join(roomId);
                    partnerSocket.join(roomId);
                    
                    // Store pairing data
                    partners.set(socket.id, partnerId);
                    partners.set(partnerId, socket.id);
                    rooms.set(socket.id, roomId);
                    rooms.set(partnerId, roomId);
                    
                    // Notify both users of successful pairing
                    socket.emit('paired', { partnerId: partnerId, message: 'Connected to a stranger! Say hello!' });
                    partnerSocket.emit('paired', { partnerId: socket.id, message: 'Connected to a stranger! Say hello!' });
                } else {
                    // Partner socket not found (disconnected), remove from waiting and retry later
                    waitingSockets.delete(partnerId);
                    socket.emit('status', { message: 'Error finding partner, trying again...' });
                    setTimeout(() => socket.emit('find'), 100);
                }
            }
        }
    });

    // User sends a chat message
    socket.on('send-message', (data) => {
        const partnerId = partners.get(socket.id);
        if (!partnerId) {
            socket.emit('error', { message: 'You are not connected to anyone.' });
            return;
        }
        
        let filteredText = filterMessage(data.message);
        if (filteredText.trim() === '') return;
        
        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (partnerSocket) {
            partnerSocket.emit('message', { text: filteredText, sender: 'stranger' });
            socket.emit('message', { text: filteredText, sender: 'you' });
        } else {
            // Partner disconnected
            cleanupUser(socket.id);
            socket.emit('partner-left', { message: 'Your partner disconnected. Click "Start Chat" to find a new partner.' });
        }
    });

    // Typing indicator
    socket.on('typing', (isTyping) => {
        const partnerId = partners.get(socket.id);
        if (partnerId) {
            const partnerSocket = io.sockets.sockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.emit('partner-typing', isTyping);
            }
        }
    });

    // User stops current chat
    socket.on('stop-chat', () => {
        if (partners.has(socket.id)) {
            const partnerId = partners.get(socket.id);
            const roomId = rooms.get(socket.id);
            
            if (partnerId && roomId) {
                const partnerSocket = io.sockets.sockets.get(partnerId);
                if (partnerSocket) {
                    partnerSocket.emit('partner-left', { message: 'Your partner left the chat. Click "Start Chat" to find a new partner.' });
                    partners.delete(partnerId);
                    rooms.delete(partnerId);
                    partnerSocket.leave(roomId);
                }
                socket.leave(roomId);
            }
            partners.delete(socket.id);
            rooms.delete(socket.id);
            socket.emit('chat-stopped', { message: 'You have left the chat.' });
        } else if (waitingSockets.has(socket.id)) {
            // Remove from waiting queue
            waitingSockets.delete(socket.id);
            socket.emit('chat-stopped', { message: 'Search cancelled.' });
        } else {
            socket.emit('chat-stopped', { message: 'No active chat to stop.' });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        cleanupUser(socket.id);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`FreeTalks.online server running on http://localhost:${PORT}`);
});