const fs = require('fs');
let css = fs.readFileSync('d:/Desktop/VS/ema/frontend/css/diagrama.css', 'utf8');

const regex = /\.diag-error\s*\{\s*margin: 16px;\s*padding: 12px;\s*border-radius: 8px;\s*ba\s*\/\* ======== NEW APPLE STYLE DIAGRAMA ======== \*\//;

const replacement = `.diag-error {
    margin: 16px;
    padding: 12px;
    border-radius: 8px;
    background: #fdeceb;
    color: #ff3b30;
}

/* ======== NEW APPLE STYLE DIAGRAMA ======== */`;

if (regex.test(css)) {
  css = css.replace(regex, replacement);
  fs.writeFileSync('d:/Desktop/VS/ema/frontend/css/diagrama.css', css, 'utf8');
  console.log('Fixed using regex!');
} else {
  console.log('Regex still not found.');
}
