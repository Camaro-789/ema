const fs = require('fs');
const lines = fs.readFileSync('d:/Desktop/VS/ema/frontend/index.html', 'utf8').split('\n');
lines.forEach((l, i) => {
  if (l.includes('id="app"') || l.includes("id='app'")) {
    console.log(i + ': ' + l.trim());
  }
});
