import { removeBackground } from 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.1/+esm';

document.addEventListener('DOMContentLoaded', () => {

    // 뒤로 가기
    document.getElementById('btn-back').onclick = () => {
        window.location.href = 'index.html';
    };

    // 얼굴 사진 업로드
    const faceInput = document.getElementById('face-input');
    const facePlaceholder = document.getElementById('face-placeholder');
    const facePreview = document.getElementById('face-preview');

    faceInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        facePreview.src = url;
        facePreview.classList.add('visible');
        facePlaceholder.style.display = 'none';
    };

    // 옷차림 사진 업로드
    const outfitInput = document.getElementById('outfit-input');
    const outfitPlaceholder = document.getElementById('outfit-placeholder');
    const outfitPreview = document.getElementById('outfit-preview');

    outfitInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        outfitPreview.src = url;
        outfitPreview.classList.add('visible');
        outfitPlaceholder.style.display = 'none';
    };

    // 옷차림 텍스트 / 사진 토글
    const outfitTextBtn = document.getElementById('outfit-text-btn');
    const outfitPhotoBtn = document.getElementById('outfit-photo-btn');
    const outfitTextPanel = document.getElementById('outfit-text-panel');
    const outfitPhotoPanel = document.getElementById('outfit-photo-panel');

    outfitTextBtn.onclick = () => {
        outfitTextBtn.classList.add('active');
        outfitPhotoBtn.classList.remove('active');
        outfitTextPanel.classList.remove('hidden');
        outfitPhotoPanel.classList.add('hidden');
    };

    outfitPhotoBtn.onclick = () => {
        outfitPhotoBtn.classList.add('active');
        outfitTextBtn.classList.remove('active');
        outfitPhotoPanel.classList.remove('hidden');
        outfitTextPanel.classList.add('hidden');
    };

    // 합성 시작
    const btnComposite = document.getElementById('btn-composite');
    btnComposite.removeAttribute('disabled');

    btnComposite.onclick = async () => {
        const height = document.getElementById('height').value;
        const weight = document.getElementById('weight').value;
        const age    = document.getElementById('age').value;
        const faceFile = document.getElementById('face-input').files[0];

        if (!height || !weight || !age) { alert('키, 몸무게, 나이를 입력해주세요'); return; }
        if (!faceFile) { alert('얼굴 사진을 올려주세요'); return; }

        const isTextOutfit = document.getElementById('outfit-text-btn').classList.contains('active');
        const outfitText   = document.getElementById('outfit-text').value;
        const outfitFile   = document.getElementById('outfit-input').files[0];

        if (isTextOutfit && !outfitText.trim()) { alert('옷차림을 입력해주세요'); return; }
        if (!isTextOutfit && !outfitFile) { alert('옷차림 사진을 올려주세요'); return; }

        const formData = new FormData();
        formData.append('height', height);
        formData.append('weight', weight);
        formData.append('age', age);
        formData.append('face', faceFile);
        if (isTextOutfit) {
            formData.append('outfitText', outfitText);
        } else {
            formData.append('outfit', outfitFile);
        }

        btnComposite.disabled = true;
        btnComposite.textContent = '합성 중... (약 30~60초)';

        try {
            // 1단계: AI 합성 (InstantID)
            btnComposite.textContent = '얼굴 분석 및 합성 중... (약 30~60초)';
            const res = await fetch('/api/composite', { method: 'POST', body: formData });
            if (!res.ok) {
                const { error } = await res.json();
                const isNoCredit = error && (error.includes('402') || error.includes('Insufficient credit') || error.includes('insufficient credit'));
                if (isNoCredit) {
                    throw new Error('AI 크레딧이 부족합니다.\nReplicate 계정에 크레딧을 충전해주세요.\nhttps://replicate.com/account/billing');
                }
                throw new Error(error);
            }
            const { id: compositeId } = await res.json();

            // 2단계: 누끼 따기
            btnComposite.textContent = '누끼 따는 중...';
            const imgRes = await fetch(`/api/image/${compositeId}`);
            const rawBlob = await imgRes.blob();
            const removedBlob = await removeBackground(rawBlob, {
                model: 'medium',
                output: { format: 'image/png', quality: 0.9 },
            });

            // 3단계: 업로드 → 링크 생성
            btnComposite.textContent = '링크 생성 중...';
            const uploadForm = new FormData();
            uploadForm.append('image', removedBlob, 'image.png');
            const uploadRes = await fetch('/api/upload', { method: 'POST', body: uploadForm });
            if (!uploadRes.ok) throw new Error(`업로드 오류 (${uploadRes.status})`);
            const { id } = await uploadRes.json();

            const arUrl = `${location.origin}/ar.html?id=${id}`;

            // 결과 화면 표시
            document.getElementById('result-img').src = `/api/image/${id}`;
            document.getElementById('btn-ar').href = arUrl;
            document.getElementById('btn-copy-link').onclick = () => {
                navigator.clipboard.writeText(arUrl).then(() => {
                    const toast = document.getElementById('toast');
                    toast.classList.add('show');
                    setTimeout(() => toast.classList.remove('show'), 2000);
                });
            };
            document.getElementById('result-section').classList.add('visible');
            btnComposite.disabled = false;
            btnComposite.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>다시 합성`;

        } catch (err) {
            alert('오류: ' + err.message);
            btnComposite.disabled = false;
            btnComposite.innerHTML = `<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>합성 시작`;
        }
    };

});

