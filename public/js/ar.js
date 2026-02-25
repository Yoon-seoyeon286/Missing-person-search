// === State ===
        let video = null;
        let scene = null;
        let camera = null;
        let renderer = null;
        let hudMesh = null;
        let hudTexture = null;
        let hudMeshBaseScale = 1.0;
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

        // === URL 파라미터에서 이미지 ID 읽기 ===
        function getImageId() {
            return new URLSearchParams(window.location.search).get('id');
        }

        // === 서버에서 이미지 Blob 로드 ===
        async function fetchImageBlob(id) {
            const res = await fetch(`/api/image/${id}`);
            if (!res.ok) throw new Error(`이미지 로드 실패 (${res.status})`);
            return res.blob();
        }

        // === 초기화 ===
        async function init() {
            console.log('[AR] 초기화 시작');
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

                updateLoading('3D 엔진 초기화...');
                initThreeJS();

                updateLoading('이미지 로딩...');
                await loadImageFromBlob(imageBlob);

                initEvents();
                hideLoading();
                showHint();

                isRunning = true;
                animate();

                console.log('[AR] 초기화 완료');

            } catch (error) {
                console.error('[AR] 초기화 실패:', error);
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
                    console.warn('[AR] 후면 카메라 실패, 기본 카메라 시도:', envErr.message);
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

                console.log('[AR] 카메라 연결됨:', video.videoWidth, 'x', video.videoHeight);

            } catch (e) {
                if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
                    throw new Error('카메라 권한이 거부되었습니다. 설정에서 카메라를 허용해 주세요.');
                }
                throw new Error('카메라 연결 실패: ' + (e.message || e.name));
            }
        }

        // === Three.js 초기화 ===
        function initThreeJS() {
            const container = document.getElementById('canvas-container');

            scene = new THREE.Scene();
            scene.background = null;

            camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
            camera.position.set(0, 0, 0);
            scene.add(camera);

            renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                premultipliedAlpha: false,
                preserveDrawingBuffer: true,
            });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setClearColor(0x000000, 0);
            renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;z-index:1;pointer-events:none;';
            container.appendChild(renderer.domElement);

            scene.add(new THREE.AmbientLight(0xffffff, 1.0));

            console.log('[AR] Three.js 초기화 완료');
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
                    hudTexture = new THREE.Texture(img);
                    hudTexture.colorSpace = THREE.SRGBColorSpace;
                    hudTexture.minFilter = THREE.LinearFilter;
                    hudTexture.magFilter = THREE.LinearFilter;
                    hudTexture.needsUpdate = true;

                    const material = new THREE.MeshBasicMaterial({
                        map: hudTexture,
                        transparent: true,
                        side: THREE.DoubleSide,
                        depthWrite: false,
                    });

                    const aspect = img.width / img.height;
                    const height = 0.5;
                    const geometry = new THREE.PlaneGeometry(height * aspect, height);
                    hudMesh = new THREE.Mesh(geometry, material);
                    hudMesh.position.set(0, 0, -1.5);
                    hudMesh.scale.set(1, 1, 1);
                    camera.add(hudMesh);

                    console.log('[AR] 이미지 로딩 완료:', img.width, 'x', img.height);
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
                if (!hudMesh) return;
                if (e.touches.length === 1) {
                    gesture.isDragging = true;
                    gesture.isPinching = false;
                    gesture.dragStartX = e.touches[0].clientX;
                    gesture.dragStartY = e.touches[0].clientY;
                    gesture.objStartX = hudMesh.position.x;
                    gesture.objStartY = hudMesh.position.y;
                } else if (e.touches.length === 2) {
                    gesture.isDragging = false;
                    gesture.isPinching = true;
                    gesture.pinchStartDist = getTouchDistance(e.touches);
                    gesture.pinchStartScale = hudMeshBaseScale;
                }
            }, { passive: false });

            touchArea.addEventListener('touchmove', (e) => {
                e.preventDefault();
                if (!hudMesh) return;
                if (gesture.isDragging && e.touches.length === 1) {
                    const dx = e.touches[0].clientX - gesture.dragStartX;
                    const dy = e.touches[0].clientY - gesture.dragStartY;
                    const s = screenPixelToLocal();
                    hudMesh.position.x = gesture.objStartX + dx * s;
                    hudMesh.position.y = gesture.objStartY - dy * s;
                } else if (gesture.isPinching && e.touches.length === 2) {
                    const ratio = getTouchDistance(e.touches) / gesture.pinchStartDist;
                    hudMeshBaseScale = Math.max(0.3, Math.min(5.0, gesture.pinchStartScale * ratio));
                    hudMesh.scale.set(hudMeshBaseScale, hudMeshBaseScale, hudMeshBaseScale);
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
                    gesture.objStartX = hudMesh ? hudMesh.position.x : 0;
                    gesture.objStartY = hudMesh ? hudMesh.position.y : 0;
                }
            });

            // 마우스 이벤트 (데스크탑)
            let mouseDown = false;
            touchArea.addEventListener('mousedown', (e) => {
                if (!hudMesh) return;
                mouseDown = true;
                gesture.dragStartX = e.clientX;
                gesture.dragStartY = e.clientY;
                gesture.objStartX = hudMesh.position.x;
                gesture.objStartY = hudMesh.position.y;
            });
            touchArea.addEventListener('mousemove', (e) => {
                if (!mouseDown || !hudMesh) return;
                const s = screenPixelToLocal();
                hudMesh.position.x = gesture.objStartX + (e.clientX - gesture.dragStartX) * s;
                hudMesh.position.y = gesture.objStartY - (e.clientY - gesture.dragStartY) * s;
            });
            touchArea.addEventListener('mouseup', () => { mouseDown = false; });
            touchArea.addEventListener('mouseleave', () => { mouseDown = false; });

            // 마우스 휠
            touchArea.addEventListener('wheel', (e) => {
                if (!hudMesh) return;
                e.preventDefault();
                hudMeshBaseScale = Math.max(0.3, Math.min(5.0, hudMeshBaseScale * (e.deltaY > 0 ? 0.9 : 1.1)));
                hudMesh.scale.set(hudMeshBaseScale, hudMeshBaseScale, hudMeshBaseScale);
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

            console.log('[AR] 이벤트 설정 완료');
        }

        // === 유틸리티 ===
        function getTouchDistance(touches) {
            const dx = touches[0].clientX - touches[1].clientX;
            const dy = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function screenPixelToLocal() {
            const fovRad = THREE.MathUtils.degToRad(camera.fov);
            return (2 * 1.5 * Math.tan(fovRad / 2)) / window.innerHeight;
        }

        function onResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
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
            renderer.render(scene, camera);
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
