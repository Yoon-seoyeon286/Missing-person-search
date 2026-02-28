require('dotenv').config();
const express = require('express'); // Node.js 런타임 환경에서 구동되는 웹 프레임워크
const path = require('path');
const fs = require('fs'); //파일을 만들거나 읽는 도구
const multer = require('multer'); // 사용자가 보낸 이미지 파일을 해석해서 저장
const { v4: uuidv4 } = require('uuid'); //랜덤한 이름 만들기
const OpenAI = require('openai');
const { toFile } = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// [합성용 multer - 메모리에 보관, 이미지 전체 허용]
const compositeUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('이미지 파일만 허용됩니다'));
    },
});

// [카메라 권한 설정]
function setPermissionHeaders(res) {
    res.setHeader('Permissions-Policy', 'camera=(self)');
    // Access-Control-Allow-Origin: 프론트/백이 같은 서버이므로 불필요
    // 외부 도메인에서 API 호출이 필요한 경우 납품처에서 추가
}

// [메뉴 1: 이미지 받기]
// POST /api/upload  multipart/form-data { image: File }
//
// *납품 교체 포인트
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

// [메뉴 1-2: 합성 이미지 생성]
// POST /api/composite  multipart { face: File, outfit?: File, height, weight, age, outfitText? }
const compositeFields = compositeUpload.fields([
    { name: 'face', maxCount: 1 },
    { name: 'outfit', maxCount: 1 },
]);

app.post('/api/composite', (req, res, next) => {
    console.log('[Composite] 요청 수신');
    compositeFields(req, res, (err) => {
        if (err) {
            console.error('[Composite] multer 오류:', err);
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, async (req, res) => {
    const { height, weight, age, outfitText } = req.body;
    const faceFile = req.files?.face?.[0];

    if (!faceFile) return res.status(400).json({ error: '얼굴 사진이 없습니다' });

    const bodyDesc = buildBodyDescription(height, weight, age);
    if (!bodyDesc) return res.status(400).json({ error: '신체 정보를 입력해주세요' });

    const outfit = outfitText || 'casual clothes';
    const prompt = `Full body photo of a Korean person, ${bodyDesc}, wearing ${outfit}, standing straight facing forward, plain white background, photorealistic, high quality`;
    console.log('[Composite] 프롬프트:', prompt);

    try {
        // gpt-image-1로 얼굴 기반 전신 이미지 생성
        console.log('[Composite] gpt-image-1 생성 중...');
        const imageFile = await toFile(faceFile.buffer, 'face.png', { type: faceFile.mimetype });
        let response;
        try {
            response = await openai.images.edit({
                model: 'gpt-image-1',
                image: imageFile,
                prompt,
                size: '1024x1536',
                n: 1,
            });
        } catch (e) {
            console.error('[Composite] gpt-image-1 오류:', e);
            return res.status(500).json({ error: '이미지 생성 실패: ' + (e?.message || String(e)) });
        }
        console.log('[Composite] gpt-image-1 완료');
        const imgBuffer = Buffer.from(response.data[0].b64_json, 'base64');
        const id = uuidv4();
        fs.writeFileSync(path.join(UPLOADS_DIR, id + '.png'), imgBuffer);

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        res.json({ id, url: `${baseUrl}/ar.html?id=${id}` });

    } catch (err) {
        console.error('[Composite] 예상치 못한 오류:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: '합성 실패: ' + (err?.message || String(err)) });
        }
    }
});

// [메뉴 2: 이미지 보여주기]
// GET /api/image/:id
//
// *납품 교체 포인트
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


app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => setPermissionHeaders(res),
}));


app.get('{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// height: cm, weight: kg, age: 세 → 영문 프롬프트 문자열
function buildBodyDescription(height, weight, age) {
    const h = Number(height), w = Number(weight), a = Number(age);
    if (!h || !w || !a) return null;
    const bmi = w / ((h / 100) ** 2);
    const heightStr = h < 155 ? 'short' : h < 163 ? 'below average height' : h < 172 ? 'average height' : h < 180 ? 'tall' : 'very tall';
    const buildStr  = bmi < 17 ? 'very thin build' : bmi < 20 ? 'slim build' : bmi < 23 ? 'average build' : bmi < 25 ? 'slightly stocky build' : bmi < 28 ? 'stocky build' : 'heavy build';
    const ageStr    = a < 13 ? 'child' : a < 20 ? 'teenager' : a < 30 ? 'young adult in 20s' : a < 40 ? 'adult in 30s' : a < 50 ? 'adult in 40s' : a < 60 ? 'middle-aged' : a < 70 ? 'older adult' : 'elderly person';
    return `${ageStr}, ${heightStr}, ${h}cm tall, ${w}kg, ${buildStr}`;
}

// 전역 에러 핸들러 (multer 오류 등 미들웨어 오류 → JSON 반환)
app.use((err, _req, res, _next) => {
    console.error('[Express 오류]', err);
    res.status(err.status || 500).json({ error: err.message || '서버 오류' });
});

//서버 시작
app.listen(PORT, () => {
    console.log(`AR Vision server running on http://localhost:${PORT}`);
});
