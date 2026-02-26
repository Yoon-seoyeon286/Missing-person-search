// 상태
        let video = null;
        let canvas = null;
        let ctx = null;
        let overlayImg = null;
        let imgX = 0;       // 이미지 중심 X (화면 픽셀)
        let imgY = 0;       // 이미지 중심 Y (화면 픽셀)
        let imgScale = 1.0;
        let isRunning = false;

        // 제스처 상태
        const gesture = {
            isDragging: false,
            isPinching: false,
            dragStartX: 0,
            dragStartY: 0,
            objStartX: 0,
            objStartY: 0,
            pinchStartDist: 0,
            pinchStartScale: 1.0,
        };

        // URL 파라미터에서 이미지 ID 읽기
        function getImageId() {
            return new URLSearchParams(window.location.search).get('id');
        }

        // 이미지 Blob 로드
        async function fetchImageBlob(id) {
            const res = await fetch(`/api/image/${id}`);
            if (!res.ok) throw new Error(`이미지 로드 실패 (${res.status})`);
            return res.blob();
        }

        // 초기화
        async function init() {
            console.log('초기화 시작');
            document.getElementById('loading-screen').classList.remove('hidden');

            const id = getImageId();
            let imageBlob = null;
            try {
                imageBlob = await fetchImageBlob(id);
            } catch (e) {
                showError('이미지를 불러올 수 없습니다: ' + e.message);
                return;
            }

            try {
                updateLoading('카메라 연결 중...');
                await initCamera();

                updateLoading('캔버스 초기화...');
                initCanvas();

                updateLoading('이미지 로딩...');
                await loadImageFromBlob(imageBlob);

                initEvents();
                hideLoading();
                showHint();

                isRunning = true;
                animate();

                console.log('초기화 완료');

            } catch (error) {
                console.error('초기화 실패:', error);
                showError('초기화 실패: ' + error.message);
            }
        }

        // === 카메라 초기화 (후면 고정) ===
        async function initCamera() {
            video = document.getElementById('video-background');
            if (!video) throw new Error('비디오 요소를 찾을 수 없습니다.');

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('이 브라우저에서는 카메라를 사용할 수 없습니다.');
            }

            video.muted = true;
            video.setAttribute('playsinline', '');
            video.setAttribute('webkit-playsinline', '');

            try {
                let stream;
                try {
                    stream = await navigator.mediaDevices.getUserMedia({
                        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
                    });
                } catch (envErr) {
                    console.warn('후면 카메라 실패, 기본 카메라 시도:', envErr.message);
                    stream = await navigator.mediaDevices.getUserMedia({ video: true });
                }

                video.srcObject = stream;

                await new Promise((resolve, reject) => {
                    let done = false;
                    const doneWith = (err) => {
                        if (done) return;
                        done = true;
                        clearTimeout(tid);
                        video.removeEventListener('loadedmetadata', onReady);
                        video.removeEventListener('error', onErr);
                        err ? reject(err) : resolve();
                    };
                    const onReady = () => doneWith(null);
                    const onErr = (e) => doneWith(new Error(e.message || '비디오 로드 실패'));
                    video.addEventListener('loadedmetadata', onReady);
                    video.addEventListener('error', onErr);
                    if (video.readyState >= 1) { doneWith(null); return; }
                    const tid = setTimeout(() => {
                        video.readyState >= 1 ? doneWith(null) : doneWith(new Error('비디오 스트림 준비 시간 초과'));
                    }, 3000);
                });

                const playPromise = video.play();
                if (playPromise !== undefined) await playPromise;

                console.log('카메라 연결됨:', video.videoWidth, 'x', video.videoHeight);

            } catch (e) {
                if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                    throw new Error('카메라 권한이 거부되었습니다. 설정에서 카메라를 허용해 주세요.');
                }
                throw new Error('카메라 연결 실패: ' + (e.message || e.name));
            }
        }

        // === 캔버스 초기화 ===
        function initCanvas() {
            canvas = document.getElementById('overlay-canvas');
            ctx = canvas.getContext('2d');
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            // 이미지 초기 위치: 화면 중앙
            imgX = window.innerWidth / 2;
            imgY = window.innerHeight / 2;

            console.log('캔버스 초기화 완료');
        }

        // === 이미지 로딩 ===
        async function loadImageFromBlob(blob) {
            const objectURL = URL.createObjectURL(blob);
            try {
                await loadImage(objectURL);
            } finally {
                URL.revokeObjectURL(objectURL);
            }
        }

        async function loadImage(imageURL) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    overlayImg = img;
                    // 초기 크기: 화면 높이의 40%
                    imgScale = (window.innerHeight * 0.4) / img.naturalHeight;
                    console.log('이미지 로딩 완료:', img.naturalWidth, 'x', img.naturalHeight);
                    resolve();
                };
                img.onerror = () => reject(new Error('이미지 로딩 실패'));
                img.src = imageURL;
            });
        }

        // === 이벤트 설정 ===
        function initEvents() {
            const touchArea = document.getElementById('touch-area');

            // 터치 이벤트
            touchArea.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (!overlayImg) return;
                if (e.touches.length === 1) {
                    gesture.isDragging = true;
                    gesture.isPinching = false;
                    gesture.dragStartX = e.touches[0].clientX;
                    gesture.dragStartY = e.touches[0].clientY;
                    gesture.objStartX = imgX;
                    gesture.objStartY = imgY;
                } else if (e.touches.length === 2) {
                    gesture.isDragging = false;
                    gesture.isPinching = true;
                    gesture.pinchStartDist = getTouchDistance(e.touches);
                    gesture.pinchStartScale = imgScale;
                }
            }, { passive: false });

            touchArea.addEventListener('touchmove', (e) => {
                e.preventDefault();
                if (!overlayImg) return;
                if (gesture.isDragging && e.touches.length === 1) {
                    imgX = gesture.objStartX + (e.touches[0].clientX - gesture.dragStartX);
                    imgY = gesture.objStartY + (e.touches[0].clientY - gesture.dragStartY);
                } else if (gesture.isPinching && e.touches.length === 2) {
                    const ratio = getTouchDistance(e.touches) / gesture.pinchStartDist;
                    imgScale = Math.max(0.1, Math.min(5.0, gesture.pinchStartScale * ratio));
                }
            }, { passive: false });

            touchArea.addEventListener('touchend', (e) => {
                if (e.touches.length === 0) {
                    gesture.isDragging = false;
                    gesture.isPinching = false;
                } else if (e.touches.length === 1) {
                    gesture.isPinching = false;
                    gesture.isDragging = true;
                    gesture.dragStartX = e.touches[0].clientX;
                    gesture.dragStartY = e.touches[0].clientY;
                    gesture.objStartX = imgX;
                    gesture.objStartY = imgY;
                }
            });

            // 마우스 이벤트 (데스크탑)
            let mouseDown = false;
            touchArea.addEventListener('mousedown', (e) => {
                if (!overlayImg) return;
                mouseDown = true;
                gesture.dragStartX = e.clientX;
                gesture.dragStartY = e.clientY;
                gesture.objStartX = imgX;
                gesture.objStartY = imgY;
            });
            touchArea.addEventListener('mousemove', (e) => {
                if (!mouseDown || !overlayImg) return;
                imgX = gesture.objStartX + (e.clientX - gesture.dragStartX);
                imgY = gesture.objStartY + (e.clientY - gesture.dragStartY);
            });
            touchArea.addEventListener('mouseup', () => { mouseDown = false; });
            touchArea.addEventListener('mouseleave', () => { mouseDown = false; });

            // 마우스 휠
            touchArea.addEventListener('wheel', (e) => {
                if (!overlayImg) return;
                e.preventDefault();
                imgScale = Math.max(0.1, Math.min(5.0, imgScale * (e.deltaY > 0 ? 0.9 : 1.1)));
            }, { passive: false });

            // 버튼 이벤트
            document.getElementById('btn-back').addEventListener('click', () => {
                window.location.href = 'index.html';
            });

            document.getElementById('btn-new-image').addEventListener('click', () => {
                window.location.href = 'index.html';
            });

            // 링크 복사
            document.getElementById('btn-copy-link').addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(window.location.href);
                } catch {
                    // clipboard API 미지원 폴백
                    const input = document.createElement('input');
                    input.value = window.location.href;
                    document.body.appendChild(input);
                    input.select();
                    document.execCommand('copy');
                    document.body.removeChild(input);
                }
                showToast('링크가 복사되었습니다');
            });

            // 안내 오버레이
            document.getElementById('hint-overlay').addEventListener('click', () => {
                document.getElementById('hint-overlay').classList.remove('visible');
            });

            window.addEventListener('resize', onResize);

            console.log('이벤트 설정 완료');
        }

        // === 유틸리티 ===
        function getTouchDistance(touches) {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function onResize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }

        // === UI 함수 ===
        function updateLoading(text) {
            document.getElementById('loading-text').textContent = text;
        }
        function hideLoading() {
            document.getElementById('loading-screen').classList.add('hidden');
        }
        function showError(message) {
            document.getElementById('loading-screen').classList.add('hidden');
            document.getElementById('error-message').textContent = message;
            document.getElementById('error-screen').classList.add('visible');
        }
        function showHint() {
            document.getElementById('hint-overlay').classList.add('visible');
        }
        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.classList.add('visible');
            setTimeout(() => toast.classList.remove('visible'), 2000);
        }

        // === 렌더 루프 ===
        function animate() {
            if (!isRunning) return;
            requestAnimationFrame(animate);

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (!overlayImg) return;

            const w = overlayImg.naturalWidth * imgScale;
            const h = overlayImg.naturalHeight * imgScale;
            ctx.drawImage(overlayImg, imgX - w / 2, imgY - h / 2, w, h);
        }

        // === 시작 (iOS: 사용자 탭 후 init) ===
        (function start() {
            const id = getImageId();
            if (!id) {
                showError('이미지가 없습니다. 먼저 이미지를 업로드해주세요.');
                return;
            }
            const tapEl = document.getElementById('tap-to-start');
            tapEl.addEventListener('click', function onTap() {
                tapEl.classList.add('hidden');
                init();
            }, { once: true });
        })();
