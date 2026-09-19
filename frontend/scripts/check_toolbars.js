const fs = require('fs');
const html = fs.readFileSync('d:/Desktop/VS/ema/frontend/index.html', 'utf8');
const start = html.indexOf('class="top-toolbar"');
const end = html.indexOf('id="sidebarDrawer"');
console.log(html.substring(start, end));
