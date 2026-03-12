require('dotenv').config();
const express = require('express'); // Node.js 런타임 환경에서 구동되는 웹 프레임워크
const path = require('path');
const fs = require('fs'); //파일을 만들거나 읽는 도구
const multer = require('multer'); // 사용자가 보낸 이미지 파일을 해석해서 저장
const { v4: uuidv4 } = require('uuid'); //랜덤한 이름 만들기
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
if (!globalThis.File) globalThis.File = require('node:buffer').File;
const { fal } = require('@fal-ai/client');
fal.config({ credentials: process.env.FAL_KEY });
const Replicate = require('replicate');
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const sharp = require('sharp');

const app = express(); //서버 객체
const PORT = process.env.PORT || 3000;

// [저장소 준비]
// 로컬 파일 시스템
// 이 경로를 S3 / 클라우드 스토리지로 교체.
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// [자동 삭제]
const EXPIRE_MS = 24 * 60 * 60 * 1000; // 24시간

function scheduleDelete(filePath) {
    setTimeout(() => {
        fs.unlink(filePath, (err) => {
            if (!err) console.log('[Auto-delete]', path.basename(filePath));
        });
    }, EXPIRE_MS);
}

// 서버 시작 시 24시간 이상 된 파일 정리
(function cleanupOldFiles() {
    const now = Date.now();
    fs.readdirSync(UPLOADS_DIR).forEach(file => {
        const filePath = path.join(UPLOADS_DIR, file);
        const { mtimeMs } = fs.statSync(filePath);
        if (now - mtimeMs > EXPIRE_MS) {
            fs.unlink(filePath, () => {});
        } else {
            scheduleDelete(filePath);
        }
    });
})();

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
    scheduleDelete(req.file.path);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
        id,
        url: `${baseUrl}/ar.html?id=${id}`,
    });
});

// [메뉴 1-2: 합성 이미지 생성]

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
    const faceFile  = req.files?.face?.[0];
    const outfitFile = req.files?.outfit?.[0];

    if (!faceFile) return res.status(400).json({ error: '얼굴 사진이 없습니다' });

    const bodyDesc = buildBodyDescription(height, weight, age);
    if (!bodyDesc) return res.status(400).json({ error: '신체 정보를 입력해주세요' });

    try {
        // 옷차림 결정: 텍스트 > 사진 묘사 > 기본값
        let outfit = outfitText?.trim();
        if (outfit) {
            // 한국어 영어로 번역
            const transRes = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: `Translate this clothing description to English in one short sentence (only the clothes): "${outfit}"` }],
                max_tokens: 60,
            });
            outfit = transRes.choices[0].message.content;
            console.log('[Composite] 옷차림 영어 번역:', outfit);
        }
        if (!outfit && outfitFile) {
            console.log('[Composite] 옷차림 사진 분석 중...');
            const outfitBase64 = `data:${outfitFile.mimetype};base64,${outfitFile.buffer.toString('base64')}`;
            const visionRes = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: [
                    { type: 'image_url', image_url: { url: outfitBase64 } },
                    { type: 'text', text: 'Describe the clothing/outfit in this image in 1 short sentence in English. Only describe the clothes, not the person.' },
                ]}],
                max_tokens: 60,
            });
            outfit = visionRes.choices[0].message.content;
            console.log('[Composite] 옷차림 묘사:', outfit);
        }
        if (!outfit) outfit = 'casual clothes';

        // [1단계] Sharp 2x: 얼굴 사진 업스케일 (로컬, 무료)
        console.log('[Composite] 얼굴 사진 업스케일 중...');
        const { width: faceW, height: faceH } = await sharp(faceFile.buffer).metadata();
        const upscaledFaceBuffer = await sharp(faceFile.buffer)
            .resize(faceW * 2, faceH * 2, { kernel: sharp.kernel.lanczos3 })
            .sharpen()
            .toBuffer();
        console.log('[Composite] 얼굴 업스케일 완료');

        // 얼굴 사진 fal.ai 스토리지 업로드
        //교체: S3/R2 presigned URL 또는 직접 업로드 후 공개 URL 반환
        console.log('[Composite] 얼굴 사진 업로드 중...');
        const { Blob } = require('node:buffer');
        const faceUrl = await fal.storage.upload(new Blob([upscaledFaceBuffer], { type: faceFile.mimetype }));
        console.log('[Composite] 업로드 완료:', faceUrl);

        // [2단계] zsxkib/flux-pulid: 얼굴 보존하면서 전신 생성
        console.log('[Composite] flux-pulid 전신 생성 중...');
        let replicateOutput;
        try {
            replicateOutput = await replicate.run('zsxkib/flux-pulid', {
                input: {
                    main_face_image: faceUrl,
                    prompt: `RAW photo, full body shot of a ${bodyDesc} person, wearing ${outfit}, standing upright, entire body visible from head to toe including feet and shoes, full length, wide shot, feet on ground, neutral gray background, studio lighting, photorealistic, 8k.`,
                    negative_prompt: 'cartoon, illustration, anime, drawing, painting, digital art, CGI, 3D render, cropped body, cut off feet, cut off legs, partial body, headshot, portrait, close-up, waist up, half body, missing feet, floating, bad anatomy, deformed, ugly, blurry, low quality, worst quality, nsfw',
                    width: 768,
                    height: 1280,
                    num_steps: 30,
                    id_weight: 1.0,
                    guidance_scale: 3.5,
                    true_cfg: 1.5,
                },
            });
        } catch (e) {
            console.error('[Composite] flux-pulid 오류:', e);
            return res.status(500).json({ error: '이미지 생성 실패: ' + (e?.message || String(e)) });
        }
        console.log('[Composite] flux-pulid 완료:', replicateOutput);

        const outputFile = Array.isArray(replicateOutput) ? replicateOutput[0] : replicateOutput;
        if (!outputFile) throw new Error('결과 없음');

        const blob = await (typeof outputFile.blob === 'function' ? outputFile.blob() : fetch(String(outputFile)).then(r => r.blob()));
        const downloadedBuffer = Buffer.from(await blob.arrayBuffer());

        // [3단계] Sharp 2x: 결과 이미지 업스케일 (로컬, 무료)
        console.log('[Composite] 결과 이미지 업스케일 중...');
        const { width: outW, height: outH } = await sharp(downloadedBuffer).metadata();
        const finalBuffer = await sharp(downloadedBuffer)
            .resize(outW * 2, outH * 2, { kernel: sharp.kernel.lanczos3 })
            .sharpen()
            .png()
            .toBuffer();
        console.log('[Composite] 출력 업스케일 완료');

        const id = uuidv4();
        const savedPath = path.join(UPLOADS_DIR, id + '.png');
        fs.writeFileSync(savedPath, finalBuffer);
        scheduleDelete(savedPath);

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


// [관리: 이미지 목록 조회]
// GET /api/images
app.get('/api/images', (_req, res) => {
    const files = fs.readdirSync(UPLOADS_DIR)
        .filter(f => f.endsWith('.png'))
        .map(f => {
            const { mtimeMs } = fs.statSync(path.join(UPLOADS_DIR, f));
            return { id: path.basename(f, '.png'), createdAt: mtimeMs };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
    res.json(files);
});

// [관리: 이미지 수동 삭제]
// DELETE /api/image/:id
app.delete('/api/image/:id', (req, res) => {
    const raw = req.params.id;
    if (!/^[0-9a-f-]{36}$/.test(raw)) {
        return res.status(400).json({ error: '잘못된 ID 형식입니다' });
    }
    const filePath = path.join(UPLOADS_DIR, raw + '.png');
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '이미지를 찾을 수 없습니다' });
    }
    fs.unlink(filePath, (err) => {
        if (err) return res.status(500).json({ error: '삭제 실패' });
        res.json({ ok: true });
    });
});


app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => setPermissionHeaders(res),
}));


app.get('{*path}', (_req, res) => {
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
