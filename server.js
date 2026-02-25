const express = require('express'); // Node.js 런타임 환경에서 구동되는 웹 프레임워크
const path = require('path');
const fs = require('fs'); //파일을 만들거나 읽는 도구
const multer = require('multer'); // 사용자가 보낸 이미지 파일을 해석해서 저장
const { v4: uuidv4 } = require('uuid'); //랜덤한 고유 이름 만드는 도구 

const app = express(); //서버 객체
const PORT = process.env.PORT || 3000;

// [저장소 준비]
// 로컬 파일 시스템
// 이 경로를 S3 / 클라우드 스토리지로 교체.
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// [multer 설정]
// 파일명 = UUID.png 
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, _file, cb) => cb(null, uuidv4() + '.png'),
});
const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'image/png') cb(null, true);
        else cb(new Error('PNG 파일만 허용됩니다'));
    },
});

// ── 카메라 권한 헤더 미들웨어 ───────────────────────────────
function setPermissionHeaders(res) {
    res.setHeader('Permissions-Policy', 'camera=*, microphone=*, gyroscope=*, accelerometer=*');
    res.setHeader('Access-Control-Allow-Origin', '*');
}

// ── API: 이미지 업로드 ───────────────────────────────────────
// POST /api/upload  multipart/form-data { image: File }
// → { id, url }
//
// [납품 교체 포인트]
//   - 현재: 로컬 파일시스템에 저장
//   - 교체: S3.upload() / DB INSERT 후 presigned URL 반환
app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '이미지가 없습니다' });
    }
    const id = path.basename(req.file.filename, '.png');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
        id,
        url: `${baseUrl}/ar.html?id=${id}`,
    });
});

// ── API: 이미지 조회 ─────────────────────────────────────────
// GET /api/image/:id
//
// [납품 교체 포인트]
//   - 현재: 로컬 파일 전송
//   - 교체: S3 presigned URL redirect 또는 DB 조회 후 스트림 전송
app.get('/api/image/:id', (req, res) => {
    // UUID 형식만 허용 (보안: path traversal 방지)
    const raw = req.params.id;
    if (!/^[0-9a-f-]{36}$/.test(raw)) {
        return res.status(400).json({ error: '잘못된 ID 형식입니다' });
    }
    const filePath = path.join(UPLOADS_DIR, raw + '.png');
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '이미지를 찾을 수 없습니다' });
    }
    setPermissionHeaders(res);
    res.sendFile(filePath);
});

// ── 정적 파일 (public/) ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => setPermissionHeaders(res),
}));

// ── SPA 폴백 ─────────────────────────────────────────────────
app.get('{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`AR Vision server running on http://localhost:${PORT}`);
});
