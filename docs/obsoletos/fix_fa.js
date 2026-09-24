const fs = require('fs');
let html = fs.readFileSync('d:/Desktop/VS/ema/frontend/index.html', 'utf8');

// Fix the broken FontAwesome injection (has escaped quotes due to PS shell injection)
// The broken line looks like: <link rel=" stylesheet\ href=\"https://... 
html = html.replace(
  /<link rel=" stylesheet\\ href=\\https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/6\.5\.1\/css\/all\.min\.css\\><\/head>/g,
  '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">\n</head>'
);

fs.writeFileSync('d:/Desktop/VS/ema/frontend/index.html', html, 'utf8');
console.log('Fixed FontAwesome injection!');

// Verify
const html2 = fs.readFileSync('d:/Desktop/VS/ema/frontend/index.html', 'utf8');
const found = html2.indexOf('font-awesome');
if (found !== -1) {
  console.log('FontAwesome present: ' + html2.substring(found - 5, found + 100));
}
