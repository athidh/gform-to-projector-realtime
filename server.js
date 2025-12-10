const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 🔍 DEBUGGING SECTION 🔍 ---
console.log("------------------------------------------------");
console.log(" [STARTUP] Checking for Credentials...");

let creds;

try {
  // 1. Check if Render Environment Variable exists
  if (process.env.GOOGLE_CREDS) {
    console.log(" [DEBUG] Found GOOGLE_CREDS variable. Length:", process.env.GOOGLE_CREDS.length);
    creds = JSON.parse(process.env.GOOGLE_CREDS);
    console.log(" [SUCCESS] Credentials parsed successfully from Environment!");
  }
  // 2. Fallback to Local File (for your laptop)
  else {
    console.log(" [DEBUG] GOOGLE_CREDS not found. Looking for local file...");
    creds = require('./credentials.json');
    console.log(" [SUCCESS] Credentials loaded from local file.");
  }
} catch (error) {
  console.error(" [CRITICAL ERROR] Could not load credentials!");
  console.error(" Reason:", error.message);
  console.error(" FIX: Go to Render Dashboard -> Environment -> Add 'GOOGLE_CREDS' again.");
  process.exit(1); // Stop server intentionally if keys are missing
}
console.log("------------------------------------------------");


// --- YOUR CONFIG ---
const SPREADSHEET_ID = '1OScVjosJawwaMzfs20Ic8giS-WI_2SqeDMMij1XSOqs';
const SHEET_POLL_INTERVAL = 5000;

app.use(express.static('public'));

let localQuestions = [];

// --- CONNECT TO GOOGLE ---
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