const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    players: [], // Only non-hosts
    host: null,
    imposterId: null,
    realQuestion: "",
    fakeQuestion: "",
    phase: 'lobby', 
    answersReceived: 0
};

io.on('connection', (socket) => {
    socket.on('join_game', (data) => {
        if (!gameState.host) {
            gameState.host = { id: socket.id, name: data.name, isHost: true };
            socket.emit('role_assigned', 'host');
        } else {
            gameState.players.push({ 
                id: socket.id, 
                name: data.name, 
                avatar: data.avatar,
                points: 0, 
                answer: "", 
                voted: false 
            });
            socket.emit('role_assigned', 'player');
        }
        io.emit('update_game', gameState);
    });

    socket.on('send_questions', (data) => {
        gameState.realQuestion = data.real;
        gameState.fakeQuestion = data.fake;
        gameState.answersReceived = 0;
        
        const imposterIndex = Math.floor(Math.random() * gameState.players.length);
        gameState.imposterId = gameState.players[imposterIndex].id;

        gameState.players.forEach(p => {
            const q = (p.id === gameState.imposterId) ? data.fake : data.real;
            io.to(p.id).emit('receive_question', q);
        });
        gameState.phase = 'answering';
        io.emit('phase_changed', 'answering');
    });

    socket.on('submit_answer', (answer) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
            player.answer = answer;
            gameState.answersReceived++;
            if (gameState.answersReceived === gameState.players.length) {
                gameState.phase = 'discussion';
                io.emit('reveal_answers', { question: gameState.realQuestion, players: gameState.players });
            }
        }
    });

    socket.on('start_voting', () => {
        gameState.phase = 'voting';
        io.emit('phase_changed', 'voting');
    });

    socket.on('end_round', (votedOutId) => {
        if (votedOutId === gameState.imposterId) {
            gameState.players.forEach(p => { if(p.id !== gameState.imposterId) p.points++; });
        } else {
            const imposter = gameState.players.find(p => p.id === gameState.imposterId);
            if (imposter) imposter.points++;
        }
        gameState.phase = 'results';
        io.emit('results', { imposterId: gameState.imposterId, fakeQuestion: gameState.fakeQuestion, players: gameState.players });
    });

    socket.on('next_round', () => {
        gameState.players.forEach(p => p.answer = "");
        gameState.phase = 'input';
        io.emit('phase_changed', 'input');
    });

    socket.on('disconnect', () => {
        if (gameState.host && gameState.host.id === socket.id) gameState.host = null;
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        io.emit('update_game', gameState);
    });
});

server.listen(process.env.PORT || 3000);