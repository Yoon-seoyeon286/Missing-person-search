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
            const res = await fetch('/api/composite', { method: 'POST', body: formData });
            if (!res.ok) {
                const { error } = await res.json();
                throw new Error(error);
            }
            const { id } = await res.json();
            window.location.href = `ar.html?id=${id}`;
        } catch (err) {
            alert('오류: ' + err.message);
            btnComposite.disabled = false;
            btnComposite.textContent = '합성 시작';
        }
    };

});

// height: cm, weight: kg, age: 세 → 영문 프롬프트 문자열 반환
function buildBodyDescription(height, weight, age) {
    const h = Number(height), w = Number(weight), a = Number(age);
    if (!h || !w || !a) return null;

    const bmi = w / ((h / 100) ** 2);
    const heightStr = h < 155 ? 'short' : h < 163 ? 'below average height' : h < 172 ? 'average height' : h < 180 ? 'tall' : 'very tall';
    const buildStr  = bmi < 17 ? 'very thin build' : bmi < 20 ? 'slim build' : bmi < 23 ? 'average build' : bmi < 25 ? 'slightly stocky build' : bmi < 28 ? 'stocky build' : 'heavy build';
    const ageStr    = a < 13 ? 'child' : a < 20 ? 'teenager' : a < 30 ? 'young adult in 20s' : a < 40 ? 'adult in 30s' : a < 50 ? 'adult in 40s' : a < 60 ? 'middle-aged' : a < 70 ? 'older adult' : 'elderly person';

    return `${ageStr}, ${heightStr}, ${h}cm tall, ${w}kg, ${buildStr}`;
}
