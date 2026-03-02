const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    players: [],
    imposterId: null,
    realQuestion: "",
    fakeQuestion: "",
    phase: 'lobby', // lobby, input, answering, discussion, voting, results
    answersReceived: 0
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join_game', (name) => {
        const isHost = gameState.players.length === 0;
        gameState.players.push({ id: socket.id, name, points: 0, answer: "", isHost, voted: false });
        io.emit('update_players', gameState.players);
    });

    socket.on('start_input_phase', () => {
        gameState.phase = 'input';
        io.emit('phase_changed', 'input');
    });

    socket.on('send_questions', (data) => {
        gameState.realQuestion = data.real;
        gameState.fakeQuestion = data.fake;
        gameState.answersReceived = 0;
        
        // Pick random imposter
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
                io.emit('reveal_answers', { 
                    question: gameState.realQuestion, 
                    players: gameState.players 
                });
            }
        }
    });

    socket.on('start_voting', () => {
        io.emit('phase_changed', 'voting');
    });

    socket.on('cast_vote', (targetId) => {
        io.emit('vote_cast', { voterId: socket.id, targetId });
    });

    socket.on('end_round', (votedOutId) => {
        if (votedOutId === gameState.imposterId) {
            gameState.players.forEach(p => { if(p.id !== gameState.imposterId) p.points++; });
        } else {
            const imposter = gameState.players.find(p => p.id === gameState.imposterId);
            if (imposter) imposter.points++;
        }
        io.emit('results', { imposterId: gameState.imposterId, fakeQuestion: gameState.fakeQuestion, players: gameState.players });
    });

    socket.on('disconnect', () => {
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        io.emit('update_players', gameState.players);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));