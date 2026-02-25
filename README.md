# Missing Person AR

실종자 사진에서 배경을 자동으로 제거하고,
카메라로 AR(증강현실) 확인이 가능한 **공유 링크**를 생성하는 웹 애플리케이션입니다.

---

## 사용 흐름

```
1. 실종자 사진 업로드 (갤러리에서 선택)
2. AI가 자동으로 배경 제거 (브라우저에서 처리, 서버 전송 없음)
3. [AR로 보기] 클릭
4. 서버에 이미지 저장 → 고유 UUID 발급
5. ar.html?id=UUID 로 이동 — 이 URL 자체가 공유 링크
6. 링크 버튼으로 URL 복사 후 공유 → 누구든 카메라로 AR 확인 가능
```

---

## 기술 스택

| 영역 | 기술 | 비고 |
|------|------|------|
| 서버 | Node.js 18+, Express 5 | |
| 배경 제거 | @imgly/background-removal | CDN, 브라우저에서 실행 (서버 부하 없음) |
| AR 렌더링 | Three.js | CDN |
| 파일 업로드 | multer 2.x | |
| 고유 ID | uuid v4 | |
| 파일 저장 | 로컬 디스크 (`uploads/`) | ⚠️ 운영 환경에서는 클라우드로 교체 권장 |

---

## 설치 및 실행

### 요구사항

- Node.js 18 이상
- **HTTPS 환경 필수** — 카메라 API는 보안 컨텍스트(HTTPS)에서만 동작합니다

### 설치

```bash
npm install
```

### 실행

```bash
node server.js
# 또는
npm start
```

기본 포트: `3000`
포트 변경: `PORT=8080 node server.js`

로컬 개발 시: `http://localhost:3000`

---

## API

### `POST /api/upload`

배경 제거된 이미지를 업로드하고 공유 URL을 받습니다.

| 항목 | 내용 |
|------|------|
| Content-Type | `multipart/form-data` |
| 필드명 | `image` |
| 허용 형식 | PNG |
| 최대 크기 | 15MB |

**응답 예시**
```json
{
  "id": "a3f2c8d1-9b4e-4f2a-8c1d-123456789abc",
  "url": "https://yourdomain.com/ar.html?id=a3f2c8d1-9b4e-4f2a-8c1d-123456789abc"
}
```

### `GET /api/image/:id`

저장된 이미지를 반환합니다. (UUID 형식만 허용, path traversal 방지 처리됨)

---

## 파일 구조

```
.
├── server.js              # Express 서버 — API + 정적 파일 서빙
├── package.json
├── .env                   # 환경변수 (git 제외, 직접 생성 필요)
├── uploads/               # 업로드된 이미지 저장 (git 제외)
└── public/
    ├── index.html         # 메인 페이지 (업로드 + 배경 제거)
    ├── ar.html            # AR 뷰어 + 링크 복사 버튼
    ├── css/
    │   ├── index.css
    │   └── ar.css
    └── js/
        ├── index.js       # 배경 제거 + 서버 업로드 로직
        └── ar.js          # Three.js AR + URL 파라미터 이미지 로드
```

---

## 납품받은 회사가 해야 할 일

### ✅ 필수

#### 1. HTTPS 설정

카메라 API는 반드시 HTTPS에서만 동작합니다.

```
방법 A: nginx + Let's Encrypt SSL 인증서 적용
방법 B: Cloudflare 프록시 (무료 SSL)
방법 C: AWS ALB / Load Balancer SSL 처리
```

#### 2. 서버 상시 실행 유지

서버가 꺼지면 공유 링크가 동작하지 않습니다. PM2 등으로 항상 실행 상태를 유지하세요.

```bash
npm install -g pm2
pm2 start server.js --name missing-person-ar
pm2 save
pm2 startup   # 서버 재시작 시 자동 실행
```

#### 3. `uploads/` 디렉토리 용량 관리

이미지가 누적됩니다. 오래된 파일을 주기적으로 삭제하는 정책이 필요합니다.

```bash
# 예시: 30일 지난 PNG 파일 삭제 (cron에 등록)
find /path/to/uploads -mtime +30 -name "*.png" -delete
```

---

### ⚙️ 권장 (운영 환경)

#### 4. 파일 저장소를 클라우드로 교체

현재는 로컬 디스크(`uploads/`)에 저장합니다.
서버가 재배포되거나 여러 대로 늘어날 경우 파일이 유실될 수 있습니다.

**교체 위치**: `server.js` 내 `[납품 교체 포인트]` 주석 두 곳

```
현재: 로컬 파일시스템 (uploads/)
교체: AWS S3 / Google Cloud Storage / NCP Object Storage 등
```

교체 시 수정 범위:
- `POST /api/upload` — `multer.diskStorage` → `multer.memoryStorage` + 클라우드 SDK 업로드
- `GET /api/image/:id` — `res.sendFile` → 클라우드 URL 리다이렉트 또는 스트림

#### 5. 이미지 만료 정책 구현

현재 업로드된 이미지는 영구 보관됩니다.
DB에 업로드 시각을 저장하고 N일 후 자동 삭제하는 로직을 추가하세요.

```sql
-- 예시 테이블
CREATE TABLE uploads (
  id UUID PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 6. 환경변수 분리

`.env` 파일을 생성하여 설정값을 관리하세요. (`.gitignore`에 이미 포함되어 있음)

```bash
# .env
PORT=3000

# 향후 AI 기능 추가 시
OPENAI_API_KEY=sk-...
REPLICATE_API_TOKEN=r8_...
```

---

### 🔒 선택 (보안 강화)

#### 7. 이미지 접근 제한

현재 UUID를 알면 누구든 이미지에 접근할 수 있습니다.
내부망 전용이거나 인증이 필요한 경우 API 토큰 또는 JWT 인증을 추가하세요.

#### 8. 업로드 속도 제한

```bash
npm install express-rate-limit
```

`POST /api/upload`에 rate limiting을 적용하면 의도치 않은 대량 업로드를 방지할 수 있습니다.

---

## 현재 제한사항

| 항목 | 현재 상태 | 해결 방법 |
|------|-----------|-----------|
| 파일 저장 위치 | 로컬 디스크 | 클라우드 스토리지(S3 등)로 교체 |
| 이미지 만료 | 없음 (영구 보관) | 크론잡 + DB 기록 추가 |
| 접근 인증 | 없음 | API Key 또는 JWT 추가 |
| 스케일 아웃 | 단일 서버만 지원 | 공유 스토리지 적용 후 다중 서버 가능 |
| 이미지 크기 제한 | 15MB | `server.js` `fileSize` 값 수정 |
| AI 전신 합성 | 미구현 | OpenAI gpt-image-1 + face swap API 연동 예정 |

---

## 향후 추가 예정

- [ ] AI 전신 합성 (OpenAI gpt-image-1 — 키/몸무게 기반 체형 생성)
- [ ] Face swap (Replicate API — 실제 얼굴 보존)
- [ ] 이미지 자동 만료 및 삭제
- [ ] 관리자 대시보드 (업로드 현황 확인)
