const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000", // Your React app's URL
        methods: ["GET", "POST"],
    },
});

let teacherSocketId = null;
let users = {};
let currentPoll = {
    isActive: false,
    question: "",
    options: [],
    votes: {},
    timer: 60,
};
let pollHistory = [];
let pollTimer;

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    // ROLE SELECTION
    socket.on('select_role', (role) => {
        if (role === 'teacher' && !teacherSocketId) {
            teacherSocketId = socket.id;
            users[socket.id] = { name: 'Teacher', role: 'teacher' };
            socket.emit('role_confirmed', 'teacher');
            io.emit('update_participants', Object.values(users));
        } else if (role === 'teacher' && teacherSocketId) {
            socket.emit('teacher_exists');
        } else {
             socket.emit('role_confirmed', 'student');
        }
    });

    // STUDENT JOIN
    socket.on('join_student', (name) => {
        users[socket.id] = { name, role: 'student' };
        io.emit('update_participants', Object.values(users));
        if (currentPoll.isActive) {
            socket.emit('poll_started', currentPoll);
        }
    });
    
    // ASK A NEW QUESTION
    socket.on('ask_question', (pollData) => {
        if (socket.id === teacherSocketId) {
            currentPoll = {
                ...pollData,
                isActive: true,
                votes: {},
                responses: {}, // Track who has voted
            };
            pollData.options.forEach(option => {
                currentPoll.votes[option.text] = 0;
            });

            io.emit('poll_started', currentPoll);
            
            // Start timer
            let timeLeft = pollData.timeLimit;
            clearInterval(pollTimer);
            pollTimer = setInterval(() => {
                io.emit('timer_update', timeLeft);
                if (timeLeft <= 0) {
                    clearInterval(pollTimer);
                    endPoll();
                }
                timeLeft--;
            }, 1000);
        }
    });

    // SUBMIT ANSWER
    socket.on('submit_answer', (answer) => {
        if (currentPoll.isActive && !currentPoll.responses[socket.id]) {
            currentPoll.votes[answer]++;
            currentPoll.responses[socket.id] = answer;
            io.emit('update_results', calculateResults());
        }
    });

    // KICK STUDENT
    socket.on('kick_student', (studentName) => {
        if (socket.id === teacherSocketId) {
            const studentSocketId = Object.keys(users).find(id => users[id].name === studentName);
            if (studentSocketId) {
                io.to(studentSocketId).emit('kicked');
                io.sockets.sockets.get(studentSocketId)?.disconnect(true);
            }
        }
    });

    // CHAT MESSAGE
    socket.on('send_message', (messageData) => {
        io.emit('receive_message', messageData);
    });

    // GET POLL HISTORY
    socket.on('get_poll_history', () => {
        if (socket.id === teacherSocketId) {
            socket.emit('poll_history', pollHistory);
        }
    });
    
    // DISCONNECT
    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${socket.id}`);
        if (socket.id === teacherSocketId) {
            teacherSocketId = null;
        }
        delete users[socket.id];
        io.emit('update_participants', Object.values(users));
    });
});

// Helper functions
const calculateResults = () => {
    const totalVotes = Object.values(currentPoll.votes).reduce((acc, count) => acc + count, 0);
    const results = {};
    for (const option in currentPoll.votes) {
        results[option] = totalVotes === 0 ? 0 : Math.round((currentPoll.votes[option] / totalVotes) * 100);
    }
    return { question: currentPoll.question, options: currentPoll.options, results };
};

const endPoll = () => {
    if (currentPoll.isActive) {
        currentPoll.isActive = false;
        const finalResults = calculateResults();
        io.emit('poll_ended', finalResults);
        pollHistory.push(finalResults);
    }
};


server.listen(3001, () => {
    console.log('SERVER IS RUNNING ON PORT 3001');
});