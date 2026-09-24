const fs = require('fs');

// 1. Update css/diagrama.css
let css = fs.readFileSync('d:/Desktop/VS/ema/frontend/css/diagrama.css', 'utf8');

css = css.replace(
  /\.app-card\s*\{[\s\S]*?position:\s*relative;/ ,
  `.app-card {
  width: 780px;
  height: 480px;
  max-width: 75vw;
  max-height: 70vh;
  background: #ffffff;
  border-radius: 16px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.15);
  display: flex;
  overflow: hidden;
  position: relative;`
);

fs.writeFileSync('d:/Desktop/VS/ema/frontend/css/diagrama.css', css, 'utf8');
console.log('Updated app-card size in diagrama.css');

// 2. Update modal overlay background in index.html to be transparent/light backdrop
let html = fs.readFileSync('d:/Desktop/VS/ema/frontend/index.html', 'utf8');

html = html.replace(
  /<div id="ftth-diagrama-modal" class="ftth-modal-overlay hidden" style="[^"]*">/,
  `<div id="ftth-diagrama-modal" class="ftth-modal-overlay hidden" style="display:flex; align-items:center; justify-content:center; flex-direction:column; z-index:99999; background:rgba(0,0,0,0.25); pointer-events:auto;">`
);

fs.writeFileSync('d:/Desktop/VS/ema/frontend/index.html', html, 'utf8');
console.log('Updated modal overlay style in index.html');
