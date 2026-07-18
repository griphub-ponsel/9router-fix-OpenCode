import { createServer } from './index.js';

const port = Number(process.env.PORT || 20128);
const hostname = process.env.HOSTNAME || '127.0.0.1';

createServer().listen(port, hostname, () => {
  console.log(`9Router server listening on ${port}`);
});
