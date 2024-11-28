const audioList = document.getElementById('audio-list');

let isDragging = false;
let startY;
let scrollTop;

audioList.addEventListener('mousedown', e => {
    isDragging = true;
    startY = e.pageY - audioList.offsetTop;
    scrollTop = audioList.scrollTop;
    audioList.style.cursor = 'grabbing';
});

audioList.addEventListener('mouseleave', () => {
    isDragging = false; 
    audioList.style.cursor = 'grab'; 
});

audioList.addEventListener('mouseup', () => {
    isDragging = false; 
    audioList.style.cursor = 'grab'; 
});

audioList.addEventListener('mousemove', e => {
    if (!isDragging) return; 
    e.preventDefault();
    const y = e.pageY - audioList.offsetTop; 
    const walk = (y - startY) * 1; 
    audioList.scrollTop = scrollTop - walk; 
});
