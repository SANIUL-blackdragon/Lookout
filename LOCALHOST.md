# How Localhost Works (The "Server" Magic)

You asked: *"How is `localhost` acting like a server?"*

Here is the breakdown of how we transformed your computer into a web server using **Node.js**.

## 1. The Script (`server.js`)
This script uses Node.js's built-in `http` module to listen for requests.

```javascript
const http = require('http');
// ... other imports

const server = http.createServer((req, res) => {
    // 1. LISTEN: When a request comes in (from your browser)
    // 2. PARSE: Check the URL (req.url) and Method (GET vs POST)
    // 3. RESPOND: Send back HTML (res.write)
});

server.listen(3000, () => {
    console.log('Server running at http://localhost:3000');
});
```

*   **`createServer`**: Creates the software that "waits" for connections.
*   **`listen(3000)`**: Tells your computer, "Reserve Port 3000 for me via TCP."

## 2. The Address (`localhost`)
*   **`localhost`** is a special hostname that means "this computer".
*   It maps to the IP address **`127.0.0.1`** (loopback address).
*   When you type `http://localhost:3000` in Chrome:
    1.  Browser asks OS: "Who is localhost?" -> OS says: "It's me (127.0.0.1)".
    2.  Browser sends TCP packet to port 3000.
    3.  Node.js (listening on port 3000) catches it and runs the callback function in `server.js`.

## 3. The Flow
1.  **You** (Command Line): Run `node server.js`. The process starts and hangs (waits).
2.  **You** (Browser): Visit `localhost:3000`.
3.  **Browser**: Sends `GET / HTTP/1.1`.
4.  **Node.js**:
    *   Sees `GET /`.
    *   Reads `index.html` from disk.
    *   Sends the file content back as the response body.
5.  **Browser**: Displays the page.

## 4. Handling POST vs GET
Because we wrote logic inside `createServer`:
*   `if (req.method === 'POST')`: We attach listeners to the data stream (`req.on('data')`) to collect the body chunks.
*   `if (req.method === 'GET')`: We just look at the URL query string.

We manually built a tiny web server from scratch!
