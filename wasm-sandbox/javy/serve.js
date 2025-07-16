const express = require('express');
const path = require('path');

const app = express();
const PORT = 8000;

// Set the required headers for cross-origin isolation
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

// Serve static files from the current directory
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('With cross-origin isolation headers!');
});
