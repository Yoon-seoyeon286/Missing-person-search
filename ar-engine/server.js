const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 정적 파일 서빙 (public 폴더)
app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders: (res, filePath) => {
        // HTTPS 카메라 접근을 위한 헤더
        res.setHeader('Permissions-Policy', 'camera=*, microphone=*, gyroscope=*, accelerometer=*');
        // CORS 허용
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
}));

// SPA 폴백
app.get('{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`AR Vision server running on port ${PORT}`);
});
