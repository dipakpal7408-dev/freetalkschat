// public/client.js
const socket = io();

// DOM Elements
const startBtn = document.getElementById('start-chat-btn');
const stopBtn = document.getElementById('stop-chat-btn');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const messagesContainer = document.getElementById('messages-container');
const connectionStatus = document.getElementById('connection-status');
const typingIndicator = document.getElementById('typing-indicator');

// State variables
let isPaired = false;
let isWaiting = false;
let currentPartnerId = null;
let typingTimeout = null;

// Helper: Add message to chat UI
function addMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', sender);
    messageDiv.textContent = text;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Helper: Add system message
function addSystemMessage(text) {
    const sysDiv = document.createElement('div');
    sysDiv.classList.add('system-message');
    sysDiv.textContent = text;
    messagesContainer.appendChild(sysDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Helper: Clear chat messages (except first system welcome)
function clearMessages() {
    messagesContainer.innerHTML = '';
    addSystemMessage('Chat cleared. Start a new conversation!');
}

// Helper: Update UI based on connection state
function setConnectedState(paired) {
    isPaired = paired;
    isWaiting = false;
    if (paired) {
        connectionStatus.innerHTML = '<i class="fas fa-circle"></i> Connected to stranger';
        connectionStatus.className = 'status connected';
        messageInput.disabled = false;
        sendBtn.disabled = false;
        stopBtn.disabled = false;
        startBtn.disabled = true;
    } else {
        connectionStatus.innerHTML = '<i class="fas fa-circle"></i> Not connected';
        connectionStatus.className = 'status disconnected';
        messageInput.disabled = true;
        sendBtn.disabled = true;
        stopBtn.disabled = true;
        startBtn.disabled = false;
        typingIndicator.textContent = '';
    }
}

function setWaitingState(waiting) {
    isWaiting = waiting;
    if (waiting) {
        connectionStatus.innerHTML = '<i class="fas fa-circle"></i> Searching for partner...';
        connectionStatus.className = 'status waiting';
        messageInput.disabled = true;
        sendBtn.disabled = true;
        stopBtn.disabled = false;
        startBtn.disabled = true;
    } else if (!isPaired) {
        setConnectedState(false);
    }
}

// Socket event handlers
socket.on('status', (data) => {
    addSystemMessage(data.message);
    if (data.message.includes('Searching')) {
        setWaitingState(true);
    }
});

socket.on('paired', (data) => {
    addSystemMessage(data.message);
    setConnectedState(true);
    currentPartnerId = data.partnerId;
    isWaiting = false;
    typingIndicator.textContent = '';
});

socket.on('message', (data) => {
    addMessage(data.text, data.sender);
});

socket.on('partner-left', (data) => {
    addSystemMessage(data.message);
    setConnectedState(false);
    currentPartnerId = null;
    isPaired = false;
    isWaiting = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
});

socket.on('chat-stopped', (data) => {
    addSystemMessage(data.message);
    setConnectedState(false);
    currentPartnerId = null;
    isPaired = false;
    isWaiting = false;
});

socket.on('partner-typing', (isTyping) => {
    if (isTyping) {
        typingIndicator.textContent = 'Stranger is typing...';
    } else {
        typingIndicator.textContent = '';
    }
});

socket.on('error', (data) => {
    addSystemMessage(`⚠️ Error: ${data.message}`);
});

// Send typing indicator with debounce
function emitTyping(isTyping) {
    if (isPaired) {
        socket.emit('typing', isTyping);
    }
}

messageInput.addEventListener('input', () => {
    if (isPaired) {
        emitTyping(true);
        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            emitTyping(false);
        }, 1000);
    }
});

// Send message
function sendMessage() {
    if (!isPaired) {
        addSystemMessage('You are not connected to anyone. Start a chat first.');
        return;
    }
    const msg = messageInput.value.trim();
    if (msg === '') return;
    socket.emit('send-message', { message: msg });
    messageInput.value = '';
    // Clear own typing indicator
    if (typingTimeout) clearTimeout(typingTimeout);
    emitTyping(false);
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// Start chat (find partner)
startBtn.addEventListener('click', () => {
    if (isPaired || isWaiting) {
        addSystemMessage('Already in a chat or searching. Stop current chat first.');
        return;
    }
    // Trigger Adsterra Popunder (monetization)
    if (typeof window.triggerAdsterraPopunder === 'function') {
        window.triggerAdsterraPopunder();
    }
    clearMessages();
    socket.emit('find');
    setWaitingState(true);
});

// Stop chat / leave
stopBtn.addEventListener('click', () => {
    if (!isPaired && !isWaiting) {
        addSystemMessage('No active chat to stop.');
        return;
    }
    socket.emit('stop-chat');
    setConnectedState(false);
    currentPartnerId = null;
    typingIndicator.textContent = '';
    addSystemMessage('You left the chat.');
});

// Handle page unload gracefully
window.addEventListener('beforeunload', () => {
    if (isPaired || isWaiting) {
        socket.emit('stop-chat');
    }
});
