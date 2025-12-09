const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Check if running on Cloud (Render) or Local
let creds;
if (process.env.GOOGLE_CREDS) {
    creds = JSON.parse(process.env.GOOGLE_CREDS);
} else {
    creds = require('./credentials.json');
}

// Config
const SPREADSHEET_ID = '1OScVjosJawwaMzfs20Ic8giS-WI_2SqeDMMij1XSOqs'; 
const SHEET_POLL_INTERVAL = 5000; 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let localQuestions = []; 

const serviceAccountAuth = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

async function checkSheet() {
  try {
    await doc.loadInfo(); 
    const sheet = doc.sheetsByIndex[0]; 
    const rows = await sheet.getRows(); 
    
    // Check for NEW rows only
    if (rows.length > localQuestions.length) {
        const newCount = rows.length - localQuestions.length;
        console.log(`Found ${newCount} new questions.`);

        // Add only the new rows to our local memory
        for (let i = localQuestions.length; i < rows.length; i++) {
            localQuestions.push({
                id: i, 
                name: rows[i].get('Name'), 
                question: rows[i].get('Question'),
                status: 'Pending' 
            });
        }
        broadcastLists();
    }
  } catch (error) {
    console.error("Sheet Error:", error.message);
  }
}

function broadcastLists() {
    const pending = localQuestions.filter(q => q.status === 'Pending');
    const approved = localQuestions.filter(q => q.status === 'Approved');
    io.emit('refresh_data', { pending, approved });
}

setInterval(checkSheet, SHEET_POLL_INTERVAL);

io.on('connection', (socket) => {
  broadcastLists();

  socket.on('admin_approve', (id) => {
    const q = localQuestions.find(x => x.id === id);
    if (q) {
        q.status = 'Approved';
        broadcastLists();
    }
  });

  socket.on('admin_decline', (id) => {
    const q = localQuestions.find(x => x.id === id);
    if (q) {
        q.status = 'Rejected'; 
        broadcastLists();      
    }
  });

  socket.on('admin_project', (id) => {
    const q = localQuestions.find(x => x.id === id);
    if (q) {
        console.log(`Projecting: ${q.question}`);
        io.emit('project_live', q); 
        
        q.status = 'Projected';
        broadcastLists();       
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});