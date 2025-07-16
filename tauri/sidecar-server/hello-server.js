const express = require('express');
const app = express();
const port = process.env.PORT || 3000;
const cors = require('cors');

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

app.listen(port, () => console.log(`Server running on port ${port}`));
