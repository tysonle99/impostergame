const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let gameState = {
    players: [],
    host: null,
    imposterId: null,
    realQuestion: "",
    fakeQuestion: "",
    phase: 'lobby', 
    answersReceived: 0
};

io.on('connection', (socket) => {
    // FIX 1: Immediately send the current game state so late-joiners know a Host exists
    socket.emit('update_game', gameState);

    socket.on('join_game', (data) => {
        if (gameState.host && gameState.host.id === socket.id) return;
        if (gameState.players.find(p => p.id === socket.id)) return;

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
                voteTarget: null
            });
            socket.emit('role_assigned', 'player');
        }
        io.emit('update_game', gameState);
    });

    socket.on('start_input_phase', () => {
        gameState.phase = 'input';
        io.emit('phase_changed', 'input');
    });

    socket.on('send_questions', (data) => {
        gameState.realQuestion = data.real;
        gameState.fakeQuestion = data.fake;
        gameState.answersReceived = 0;
        
        const imposterIndex = Math.floor(Math.random() * gameState.players.length);
        gameState.imposterId = gameState.players[imposterIndex].id;

        gameState.players.forEach(p => {
            p.answer = "";
            p.voteTarget = null;
            const q = (p.id === gameState.imposterId) ? data.fake : data.real;
            io.to(p.id).emit('receive_question', q);
        });
        gameState.phase = 'answering';
        io.emit('phase_changed', 'answering');
    });

    socket.on('submit_answer', (answer) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player && !player.answer) {
            player.answer = answer;
            gameState.answersReceived++;
            // Automatically jump straight to voting phase when all answers are in
            if (gameState.answersReceived === gameState.players.length) {
                gameState.phase = 'voting';
                io.emit('reveal_answers', { question: gameState.realQuestion, players: gameState.players });
                io.emit('phase_changed', 'voting');
            }
        }
    });

    socket.on('update_vote', (targetId) => {
        const player = gameState.players.find(p => p.id === socket.id);
        if (player) {
            player.voteTarget = targetId;
            io.emit('update_game', gameState);
        }
    });

    socket.on('end_voting_phase', () => {
        const tallies = {};
        gameState.players.forEach(p => {
            if (p.voteTarget) tallies[p.voteTarget] = (tallies[p.voteTarget] || 0) + 1;
        });

        let votedOutId = null;
        let maxVotes = 0;
        for (const [id, count] of Object.entries(tallies)) {
            if (count > maxVotes) {
                maxVotes = count;
                votedOutId = id;
            } else if (count === maxVotes) {
                votedOutId = null; // A tie means nobody is definitively voted out
            }
        }

        if (votedOutId === gameState.imposterId) {
            gameState.players.forEach(p => { if(p.id !== gameState.imposterId) p.points++; });
        } else {
            const imposter = gameState.players.find(p => p.id === gameState.imposterId);
            if (imposter) imposter.points++;
        }

        gameState.phase = 'results';
        io.emit('results', { 
            votedOutId: votedOutId,
            imposterId: gameState.imposterId, 
            fakeQuestion: gameState.fakeQuestion, 
            players: gameState.players
        });
    });

    socket.on('next_round', () => {
        gameState.phase = 'input';
        io.emit('phase_changed', 'input');
    });

    socket.on('end_game', () => {
        gameState.phase = 'final_scoreboard';
        io.emit('phase_changed', 'final_scoreboard');
    });

    socket.on('reset_lobby', () => {
        // Keeps players but resets scores and goes to lobby
        gameState.players.forEach(p => {
            p.points = 0;
            p.answer = "";
            p.voteTarget = null;
        });
        gameState.phase = 'lobby';
        io.emit('update_game', gameState);
        io.emit('phase_changed', 'lobby');
    });

    socket.on('disconnect', () => {
        if (gameState.host && gameState.host.id === socket.id) gameState.host = null;
        gameState.players = gameState.players.filter(p => p.id !== socket.id);
        io.emit('update_game', gameState);
    });
});

server.listen(process.env.PORT || 3000);
