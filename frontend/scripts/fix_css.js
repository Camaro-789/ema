const fs = require('fs');
let css = fs.readFileSync('d:/Desktop/VS/ema/frontend/css/diagrama.css', 'utf8');

const searchStr = `    border-radius: 8px;
    ba
/* ======== NEW APPLE STYLE DIAGRAMA ======== */`;

const replacement = `    border-radius: 8px;
    background: #fdeceb;
    color: #ff3b30;
}

/* ======== NEW APPLE STYLE DIAGRAMA ======== */`;

if (css.includes(searchStr)) {
  css = css.replace(searchStr, replacement);
  fs.writeFileSync('d:/Desktop/VS/ema/frontend/css/diagrama.css', css, 'utf8');
  console.log('Fixed CSS syntax error successfully!');
} else {
  console.log('Search string not found.');
}
