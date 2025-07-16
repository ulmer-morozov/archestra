const express = require('express');
const app = express();
const cors = require('cors');

// Accept port from command-line argument, env var, or default to 3000
const port = process.argv[2] || process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get('/', (req, res) => res.send('Hello from Jersey Shore!'));
app.post('/echo', (req, res) => {
  const { value } = req.body;
  res.send({ message: `Yo, you sent: ${value}` });
});

// Gotta save the server instance so we can close it, capisce?
const server = app.listen(port, () => console.log(`Server running on port ${port}`));

// Ayo paisan, listen up! We gotta make sure when this thing shuts down, we close up shop nice and clean, capisce?
// This is how we do it down the Shore, bella figura style.

process.on('SIGINT', () => {
  console.log('\nAight, SIGINT received. Shuttin\' down the server, don\' be a stunad...');
  server && server.close(() => {
    console.log('Port is closed, server is outta here. Arrivederci!');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\nAyo, SIGTERM in the house. Time to close up, paisan.');
  server && server.close(() => {
    console.log('Port is closed, server is out. Ciao bella!');
    process.exit(0);
  });
});
