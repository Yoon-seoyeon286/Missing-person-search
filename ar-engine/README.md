# AR Vision Engine

이미지 배경 자동 제거 + AR 표시 자동화 툴입니다. 사용자가 이미지를 업로드하면 MediaPipe Selfie Segmentation으로 배경을 제거하고, AR 화면에 표시합니다.

## 주요 기능

### 1. 이미지 배경 제거 (MediaPipe Selfie Segmentation)
- **자동 인물 분리**: 업로드된 이미지에서 사람/객체 자동 감지
- **배경 마스크 생성**: MediaPipe ML 모델로 정확한 세그멘테이션
- **초록색 크로마키 배경 적용**: 분리된 배경을 초록색(#00FF00)으로 대체

### 2. 크로마키 합성 (Chroma Key)
- **실시간 배경 제거**: 초록색 배경을 투명하게 변환
- **WebGL 셰이더**: GPU 가속으로 빠른 처리
- **경계 부드럽게 처리**: smoothness 파라미터로 자연스러운 합성

### 3. AR 렌더링 (Three.js)
- **3-Layer 시스템**:
  - Layer 1: 카메라 비디오 (실제 배경)
  - Layer 2: Three.js 3D 렌더링 (투명 배경)
  - Layer 3: 실시간 합성
- **HUD 모드**: 화면에 고정된 이미지 렌더링

### 4. 제스처 지원
- **드래그**: 이미지 위치 이동
- **핀치**: 이미지 크기 조절

### 5. 센서 기반 추적 (폴백)
- **DeviceOrientation**: 자이로스코프 기반 카메라 회전
- **하이브리드 모드**: SLAM + 센서 조합 추적

## 동작 흐름

```
이미지 업로드 → MediaPipe 세그멘테이션 → 배경 초록색 대체 → 크로마키 제거 → AR 표시
```

## 기술 스택

| 구분 | 기술 |
|------|------|
| 배경 제거 | MediaPipe Selfie Segmentation |
| 프론트엔드 | JavaScript, Three.js |
| 크로마키 | WebGL Shader |
| 빌드 | Webpack |
| 서버 | Express.js |

## 프로젝트 구조

```
ar-engine/
├── src/
│   └── js/                    # JavaScript 모듈
│       ├── main.js            # 앱 진입점 (ARApp 클래스)
│       ├── CameraPoseManager.js   # 카메라 포즈 관리
│       ├── ImageProcessor.js  # MediaPipe 배경 제거 (예정)
│       ├── camera.js          # 카메라 유틸리티
│       └── SensorFusion.js    # 센서 융합
│
├── server.js                  # Express 서버
├── webpack.config.js          # Webpack 설정
└── package.json
```

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 프로덕션 빌드
npm run build
```

브라우저에서 `http://localhost:8080` 접속

## 사용법

```javascript
// AR 앱 초기화 (권한 승인 후)
window.addEventListener('permissionsGranted', () => {
    window.arApp.init();
});

// 이미지 업로드 및 배경 제거
const imageFile = document.getElementById('image-input').files[0];
window.processImage(imageFile);  // MediaPipe로 배경 제거 후 AR 표시

// 포즈 리셋
window.resetARPose();
```

## 지원 환경

- iOS 13+ Safari
- Android Chrome
- 데스크탑 Chrome/Firefox (WebRTC 카메라 지원)

## 의존성

- **@mediapipe/selfie_segmentation**: 배경 제거 ML 모델
- **three.js**: 3D 렌더링
- **gl-matrix**: 행렬 연산
- **express**: 개발 서버

## 개발 로드맵

- [x] Phase 1: 환경 구축
- [x] Phase 2: Three.js 렌더링
- [x] Phase 3: 카메라 통합
- [x] Phase 4: 크로마키 셰이더
- [x] Phase 5: MediaPipe Selfie Segmentation 통합
- [x] Phase 6: 이미지 업로드 UI
- [x] Phase 7: 자동 배경 제거 파이프라인

## 라이선스

MIT License
