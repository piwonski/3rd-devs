

const http = require('http');
const fs = require('fs');
const path = require('path');

// Configurable port
const PORT = process.env.AZYL_PORT;

// Directory to serve static files from
const STATIC_DIR = path.join(__dirname, 'static');

const server = http.createServer((req, res) => {
    // Normalize and construct file path
    let filePath = path.join(STATIC_DIR, decodeURIComponent(req.url));
    if (req.url === '/') {
        filePath = path.join(STATIC_DIR, 'index.html'); // default file
    }

    // Check if file exists and serve it
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('404 Not Found');
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = getContentType(ext);

        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    });
});

// Basic content-type mapping
function getContentType(ext) {
    switch (ext) {
        case '.html': return 'text/html';
        case '.js': return 'application/javascript';
        case '.css': return 'text/css';
        case '.json': return 'application/json';
        case '.png': return 'image/png';
        case '.jpg': case '.jpeg': return 'image/jpeg';
        case '.gif': return 'image/gif';
        default: return 'application/octet-stream';
    }
}

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});