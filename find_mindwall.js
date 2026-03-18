const fs = require('fs');
const path = require('path');

function walk(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        let isDirectory = fs.statSync(dirPath).isDirectory();
        if (isDirectory) {
            if (f !== 'node_modules' && f !== '.git' && f !== 'dist' && f !== 'build' && f !== 'logs' && f !== '.vscode' && !f.startsWith('2026') && f !== 'migrations') {
                walk(dirPath, callback);
            }
        } else {
            callback(path.join(dir, f));
        }
    });
}

const found = [];
function checkFile(filePath) {
    const ext = path.extname(filePath);
    if (!['.ts', '.vue', '.html', '.md', '.json', '.sh', '.yml'].includes(ext)) return;
    if (filePath.includes('package-lock.json') || filePath.includes('pnpm-lock.yaml') || filePath.includes('find_mindwall')) return;
    
    let content = fs.readFileSync(filePath, 'utf8');
    if (/Mindwall|mindwall/i.test(content)) {
        found.push(filePath);
    }
}

['e:/Privy/MindWall/apps', 'e:/Privy/MindWall/docs', 'e:/Privy/MindWall/scripts', 'e:/Privy/MindWall/README.md', 'e:/Privy/MindWall/deploy.sh', 'e:/Privy/MindWall/update.sh', 'e:/Privy/MindWall/uninstall.sh'].forEach(item => {
    if (fs.existsSync(item)) {
        if (fs.statSync(item).isDirectory()) {
            walk(item, checkFile);
        } else {
            checkFile(item);
        }
    }
});
console.log('Found files:', found);
